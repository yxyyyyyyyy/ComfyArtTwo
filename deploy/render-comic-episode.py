"""Render one local comic episode, preserving files across ComfyUI restarts."""
import argparse
import copy
import json
import os
import subprocess
import sys
import time
import uuid
from pathlib import Path

import requests
import av
from PIL import Image

p = argparse.ArgumentParser()
p.add_argument('--spec', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
p.add_argument('--phase', choices=['images', 'all'], default='all')
a = p.parse_args()
a.output.mkdir(parents=True, exist_ok=True)
lock = open(a.output / 'worker.lock', 'a+b')
if not lock.tell(): lock.write(b'0'); lock.flush()
lock.seek(0)
if os.name == 'nt':
    import msvcrt
    msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
else:
    import fcntl
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)

ROOT = Path(__file__).resolve().parents[1]
SPEC = json.loads(a.spec.read_text(encoding='utf-8'))
PROGRESS = a.output / 'progress.json'
BASE = 'http://127.0.0.1:8188'
SESSION = requests.Session(); SESSION.trust_env = False
state = json.loads(PROGRESS.read_text(encoding='utf-8')) if PROGRESS.exists() else {}
state.pop('render', None)
state.pop('result', None)
state.update(id=SPEC['id'], title=SPEC['title'], target_seconds=SPEC['target_seconds'], scenes=state.get('scenes') or [{'id': s['id'], 'title': s['title'], 'panels': []} for s in SPEC['scenes']])
PREFIX = 'comfyart/' + SPEC['id']


def update(**values):
    state.update(values, heartbeat=time.time())
    tmp = PROGRESS.with_suffix('.tmp')
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')
    for attempt in range(20):
        try:
            os.replace(tmp, PROGRESS); return
        except PermissionError:
            if attempt == 19: raise
            time.sleep(.1)


def request(method, path, **kwargs):
    r = SESSION.request(method, BASE + path, timeout=30, **kwargs)
    r.raise_for_status()
    return r.json()


def control():
    path = a.output / 'control.json'
    try: return json.loads(path.read_text(encoding='utf-8')).get('pause') is True
    except (OSError, ValueError): return False


_VALID = set()
def files(pattern):
    result = []
    for path in sorted(a.output.glob(pattern)):
        try:
            stat = path.stat(); key = (str(path), stat.st_size, stat.st_mtime_ns)
            if key not in _VALID:
                if stat.st_size < 1000: continue
                if path.suffix == '.png':
                    with Image.open(path) as image: image.verify()
                else:
                    with av.open(str(path)) as media:
                        if not media.streams.video or not media.duration: continue
                _VALID.add(key)
            result.append(path)
        except (OSError, ValueError, av.FFmpegError):
            continue
    return result

def scan():
    images = clips = 0
    for scene in state['scenes']:
        panels = []
        for suffix in ['a', 'b']:
            found = files('panel-' + scene['id'] + suffix + '_*.png')
            if found:
                panels.append({'filename': found[-1].name, 'subfolder': PREFIX, 'type': 'output'})
        scene['panels'] = panels; images += len(panels)
        found = files('clip-' + scene['id'] + '_*.mp4')
        if found:
            scene['clip'] = {'filename': found[-1].name, 'subfolder': PREFIX, 'type': 'output'}; clips += 1
        else:
            scene.pop('clip', None)
    return images, clips


def run_graph(phase, builder):
    missing_since = None
    retries = 0
    while True:
        graph = builder()
        if not graph:
            state.pop('job', None); update(); return
        job = state.get('job')
        if not job or job['phase'] != phase:
            while True:
                if control(): raise InterruptedError('已暂停，已完成素材保留。')
                try:
                    queue = request('GET', '/queue')
                    if not queue['queue_running'] and not queue['queue_pending']: break
                    update(stage='等待现有 GPU 任务完成', status='running'); time.sleep(5)
                except requests.RequestException:
                    update(stage='等待 ComfyUI 恢复连接', status='reconnecting'); time.sleep(5)
            request('POST', '/comfyart/video/prepare')
            job = {'phase': phase, 'id': str(uuid.uuid4()), 'submitted': time.time()}
            update(job=job, phase=phase, stage='提交本地生成任务', status='running')
            (a.output / f'{phase}-{job["id"]}-graph.json').write_text(json.dumps(graph, ensure_ascii=False, indent=2), encoding='utf-8')
            try: request('POST', '/prompt', json={'prompt_id': job['id'], 'client_id': 'comic-' + SPEC['id'], 'prompt': graph})
            except requests.RequestException:
                update(stage='提交响应中断，先核对任务编号', status='reconnecting')
        while True:
            if control():
                try: request('POST', '/api/jobs/' + job['id'] + '/cancel', json={})
                except requests.RequestException: pass
                raise InterruptedError('已请求停止本集任务；已完成素材保留。')
            image_count, clip_count = scan()
            update(images_done=image_count, clips_done=clip_count)
            try:
                history = request('GET', '/history/' + job['id']).get(job['id'])
                if history:
                    (a.output / f'{phase}-{job["id"]}-history.json').write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding='utf-8')
                    state.pop('job', None)
                    if history['status']['status_str'] != 'success':
                        errors = [m[1].get('exception_message', '生成中断') for m in history['status'].get('messages', []) if m[0] in ('execution_error', 'execution_interrupted')]
                        if retries >= 1: raise RuntimeError('; '.join(errors))
                        retries += 1; update(stage='本段失败，保留成功素材并重试一次'); break
                    scan(); update(); retries = 0; break
                progress = request('GET', '/comfyart/video/render/' + job['id'])
                if progress['status'] == 'missing':
                    missing_since = missing_since or time.time()
                    if time.time() - missing_since > 30:
                        state.pop('job', None)
                        if retries >= 1: raise RuntimeError('服务重启后本批次再次中断；成功素材已保存，可继续。')
                        retries += 1; update(stage='服务已恢复，继续缺失素材'); break
                else:
                    missing_since = None
                    stage = progress.get('stage', '生成中')
                    if phase == 'images' and 'Sampler' in progress.get('node_type', ''):
                        stage = '漫画画面采样' if progress.get('value', 0) > 0 else '加载漫画模型 / 采样'
                    update(status='running', stage=stage, value=progress.get('value', 0), maximum=progress.get('max', 1), node=progress.get('node'))
            except requests.RequestException:
                update(status='reconnecting', stage='ComfyUI 连接中断，等待自动恢复')
            time.sleep(3)


def image_graph():
    base = json.loads((ROOT / 'workflows/z-image-turbo-t2i.api.json').read_text(encoding='utf-8'))
    graph = {k: copy.deepcopy(base[k]) for k in ['1', '2', '3', '4']}
    count = 0
    for scene in SPEC['scenes']:
        for panel in scene['panels']:
            if files('panel-' + panel['id'] + '_*.png'): continue
            n = lambda j: 'p' + panel['id'] + '-' + str(j)
            graph[n(1)] = {'class_type': 'EmptySD3LatentImage', 'inputs': {'width': 768, 'height': 1344, 'batch_size': 1}}
            graph[n(2)] = {'class_type': 'CLIPTextEncode', 'inputs': {'text': panel['prompt'], 'clip': ['2', 0]}}
            graph[n(3)] = {'class_type': 'ConditioningZeroOut', 'inputs': {'conditioning': [n(2), 0]}}
            values = copy.deepcopy(base['7']['inputs']); values.update(seed=2026101900 + count, model=['4', 0], positive=[n(2), 0], negative=[n(3), 0], latent_image=[n(1), 0])
            graph[n(4)] = {'class_type': 'KSampler', 'inputs': values}
            graph[n(5)] = {'class_type': 'VAEDecode', 'inputs': {'samples': [n(4), 0], 'vae': ['3', 0]}}
            graph[n(6)] = {'class_type': 'SaveImage', 'inputs': {'images': [n(5), 0], 'filename_prefix': PREFIX + '/panel-' + panel['id'] + ('_r' + str(panel['revision']) if panel.get('revision') else '')}}
            count += 1
    return graph if count else {}


def video_graph():
    base = json.loads((ROOT / 'workflows/i2v-minimax-h3.api.json').read_text(encoding='utf-8'))
    shared = ['105:11','105:24','105:13','105:6','105:17','105:9','105:121','105:122','105:123','105:124','105:125','105:126','105:107','105:111']
    graph = {k: copy.deepcopy(base[k]) for k in shared}
    graph['105:111']['inputs']['value'] = SPEC['scenes'][0]['native_seconds']; graph['105:126']['inputs']['value'] = True
    count = 0
    for scene in SPEC['scenes']:
        if files('clip-' + scene['id'] + '_*.mp4'): continue
        first = files('panel-' + scene['id'] + 'a_*.png')[-1]
        n = lambda j: 's' + scene['id'] + '-' + str(j)
        graph[n(114)] = {'class_type': 'LoadImage', 'inputs': {'image': PREFIX + '/' + first.name + ' [output]'}}
        graph[n(104)] = copy.deepcopy(base['105:104']); graph[n(104)]['inputs'].update(first_frame=[n(114), 0], width=512, height=896, prompt=scene['motion'])
        graph[n(16)] = copy.deepcopy(base['105:16']); graph[n(16)]['inputs']['conditioning'] = [n(104), 0]
        graph[n(15)] = {'class_type': 'RandomNoise', 'inputs': {'noise_seed': 2026101960 + int(scene['id']) + 1000 * (scene.get('motion_revision', 1) - 1)}}
        graph[n(14)] = copy.deepcopy(base['105:14']); graph[n(14)]['inputs'].update(noise=[n(15), 0], guider=[n(16), 0], latent_image=[n(104), 1])
        graph[n(10)] = copy.deepcopy(base['105:10']); graph[n(10)]['inputs']['samples'] = [n(14), 0]
        graph[n(23)] = copy.deepcopy(base['105:23']); graph[n(23)]['inputs']['samples'] = [n(14), 0]
        graph[n(91)] = copy.deepcopy(base['105:91']); graph[n(91)]['inputs'].update(images=[n(10), 0], audio=[n(23), 0])
        graph[n(92)] = copy.deepcopy(base['92']); graph[n(92)]['inputs'].update(video=[n(91), 0], filename_prefix=PREFIX + '/clip-' + scene['id'] + ('_r' + str(scene['motion_revision']) if scene.get('motion_revision', 1) > 1 else ''))
        count += 1
        break  # One native clip per prompt keeps conditioning and model memory bounded.
    return graph if count else {}


def child(args, phase, stage):
    update(phase=phase, stage=stage, status='running', value=0, maximum=1)
    with (a.output / (phase + '.log')).open('ab') as log:
        proc = subprocess.Popen(list(map(str, args)), cwd=a.output, stdout=log, stderr=log)
        while proc.poll() is None:
            if control():
                proc.terminate(); proc.wait(); raise InterruptedError('制作已暂停；已完成素材保留。')
            manifest = a.output / 'voice/voice-manifest.json'
            if phase == 'voices' and manifest.exists():
                try: update(voices_done=len(json.loads(manifest.read_text(encoding='utf-8'))), voices_total=len(SPEC['narration']) + 1)
                except ValueError: pass
            if phase == 'render':
                render = a.output / 'render-progress.json'
                try: update(render=json.loads(render.read_text(encoding='utf-8')))
                except (OSError, ValueError): pass
            update(); time.sleep(3)
        if proc.returncode:
            tail = (a.output / (phase + '.log')).read_text(encoding='utf-8', errors='replace')[-3500:]
            raise RuntimeError(f'{stage}失败，详情：' + '\n'.join(dict.fromkeys(tail.splitlines()))[-1200:])


try:
    (a.output / 'control.json').write_text('{"pause":false}', encoding='utf-8')
    update(status='running', phase='images', stage='生成与剧情对应的漫画画面', error=None)
    run_graph('images', image_graph)
    if a.phase == 'images':
        update(status='review', phase='images', stage='漫画画面已生成，正在核对人物与剧情')
    else:
        update(phase='voices', stage='释放本项目的空闲视频模型')
        request('POST', '/comfyart/video/prepare')
        voice_spec = copy.deepcopy(SPEC)
        voice_spec['narration'].append({'id': '1000', 'role': '远处哼唱', 'text': 'ああ……ああ……', 'language': 'Japanese', 'speaker': 'Ono_Anna', 'tone': 'Very soft slow distant female humming, airy and restrained, no spoken words.'})
        (a.output / 'voice-spec.json').write_text(json.dumps(voice_spec, ensure_ascii=False), encoding='utf-8')
        child([r'F:\ComfyArt\speech\.venv\Scripts\python.exe', ROOT / 'deploy/story-speech.py', '--story', a.output / 'voice-spec.json', '--output', a.output / 'voice'], 'voices', '本地分角色中文配音')
        run_graph('videos', video_graph)
        child([sys.executable, ROOT / 'deploy/render-comic-timeline.py', '--spec', a.spec, '--output', a.output], 'render', '漫画动画、声音和字幕合成')
        update(status='done', phase='done', stage='第一集成片已完成', result={'filename': SPEC.get('output_filename', 'final.mp4'), 'subfolder': PREFIX, 'type': 'output'}, seconds=360)
except InterruptedError as e:
    update(status='paused', stage=str(e))
except Exception as e:
    update(status='error', stage='本集制作中断，成功素材已保留', error=str(e))
    raise
finally:
    lock.close()
