"""Resume a private, native-motion film specification on the local ComfyUI service."""
import argparse
import copy
import json
import os
import subprocess
import sys
import time
import uuid
from pathlib import Path

import av
import numpy as np
import requests
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def write_json(path, value):
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    for attempt in range(30):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt == 29:
                raise
            time.sleep(.1)


def read_json(path, fallback):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return fallback


def video_metrics(path):
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        duration = float(container.duration / av.time_base) if container.duration else 0
        if duration <= 0:
            raise ValueError('Video duration is unavailable')
        times = np.linspace(.15, max(.15, duration - .15), 5)
        pictures = []
        for timestamp in times:
            container.seek(int(timestamp * av.time_base), backward=True)
            for frame in container.decode(stream):
                if frame.time is not None and frame.time >= timestamp - .1:
                    pictures.append(np.asarray(frame.to_image().resize((48, 48))).astype('float32'))
                    break
        if len(pictures) < 3:
            raise ValueError('Not enough decodable frames')
        changes = [float(np.mean(np.abs(b - a))) for a, b in zip(pictures, pictures[1:])]
        fractions = [float(np.mean(np.mean(np.abs(b - a), axis=2) > 10)) for a, b in zip(pictures, pictures[1:])]
        return {'seconds': duration, 'width': stream.width, 'height': stream.height,
                'fps': float(stream.average_rate), 'frame_change': max(changes), 'changed_fraction': max(fractions),
                'median_change': float(np.median(changes)), 'frame_changes': changes,
                'not_frozen': float(np.median(changes)) >= 1.0 and float(np.median(fractions)) >= .02}


def last_frame(source, target):
    with av.open(str(source)) as container:
        duration = float(container.duration / av.time_base)
        at = max(0, duration - .12)
        container.seek(int(at * av.time_base), backward=True)
        image = None
        for frame in container.decode(video=0):
            image = frame.to_image()
            if frame.time is not None and frame.time >= at:
                break
        if image is None:
            raise ValueError('The previous shot has no decodable final frame')
        image.save(target)


class FilmWorker:
    def __init__(self, spec, output, base):
        self.spec = read_json(spec, None)
        if not self.spec or not self.spec.get('native_only') or not self.spec.get('scenes'):
            raise ValueError('A native-only film specification with shots is required')
        self.spec_path = spec
        self.output = output
        self.output.mkdir(parents=True, exist_ok=True)
        self.base = base.rstrip('/')
        self.http = requests.Session()
        self.http.trust_env = False
        self.progress = output / 'progress.json'
        self.state = read_json(self.progress, {})
        self.prefix = 'comfyart/' + self.spec['id']
        self.state.update(id=self.spec['id'], title=self.spec['title'], target_seconds=self.spec['target_seconds'],
                          clips_total=len(self.spec['scenes']), images_total=len(self.spec.get('anchors', [])) + sum(not s.get('continue_previous') for s in self.spec['scenes']),
                          voices_total=len(self.spec['narration']),
                          scenes=self.state.get('scenes') or [{'id': s['id'], 'title': s['title'], 'panels': []} for s in self.spec['scenes']])
        self.model_info = {}

    def update(self, **values):
        self.state.update(values, heartbeat=time.time())
        write_json(self.progress, self.state)

    def request(self, method, route, **kwargs):
        response = self.http.request(method, self.base + route, timeout=30, **kwargs)
        if not response.ok:
            raise RuntimeError(f'{route}: {response.status_code}: {response.text[-1200:]}')
        return response.json()

    def check_pause(self):
        if read_json(self.output / 'control.json', {}).get('pause') is True:
            job = self.state.get('job')
            if job:
                try:
                    self.request('POST', '/api/jobs/' + job['id'] + '/cancel', json={})
                except (requests.RequestException, RuntimeError):
                    pass
            raise InterruptedError('制作已暂停，任务编号与成功素材已保留。')

    def ref(self, path):
        return {'filename': path.name, 'subfolder': self.prefix, 'type': 'output'}

    def find(self, prefix, video=False):
        for path in reversed(sorted(self.output.glob(prefix + '_*' + ('.mp4' if video else '.png')))):
            try:
                if video:
                    metric = video_metrics(path)
                    if metric['seconds'] < 4.9 or not metric['not_frozen']:
                        continue
                else:
                    with Image.open(path) as image:
                        image.verify()
                return path
            except (OSError, ValueError, av.FFmpegError):
                continue
        return None

    def scan(self):
        images = sum(bool(self.find('anchor-' + s['id'])) for s in self.spec.get('anchors', []))
        clips = 0
        for shot, row in zip(self.spec['scenes'], self.state['scenes']):
            keyframe = self.find('key-' + shot['id'])
            row['panels'] = [self.ref(keyframe)] if keyframe else []
            images += bool(keyframe) and not shot.get('continue_previous')
            # Saved acceptance records avoid decoding every completed video on each heartbeat.
            approved = read_json(self.output / ('clip-' + shot['id'] + '-accepted.json'), {})
            clip = self.output / approved.get('filename', '_missing')
            if clip.is_file() and approved.get('not_frozen'):
                row['clip'] = self.ref(clip)
                clips += 1
            else:
                row.pop('clip', None)
        voices = read_json(self.output / 'voice' / 'voice-manifest.json', [])
        self.update(images_done=images, clips_done=clips, voices_done=len(voices))

    def wait_idle(self):
        while True:
            self.check_pause()
            try:
                q = self.request('GET', '/queue')
                if not q['queue_running'] and not q['queue_pending']:
                    return
                self.update(stage='等待生成队列中的现有任务完成')
            except (requests.RequestException, RuntimeError):
                self.update(status='reconnecting', stage='等待生成服务恢复连接')
            time.sleep(3)

    def prepare(self):
        self.wait_idle()
        self.request('POST', '/comfyart/video/prepare')

    def graph(self, key, graph):
        # Resolve nested model folders using the server's advertised choices.
        for node in graph.values():
            cls = node['class_type']
            fields = {'UNETLoader': 'unet_name', 'CLIPLoader': 'clip_name', 'VAELoader': 'vae_name', 'LoraLoaderModelOnly': 'lora_name'}
            if cls not in fields:
                continue
            field = fields[cls]
            if cls not in self.model_info:
                self.model_info[cls] = self.request('GET', '/object_info/' + cls)[cls]['input']['required']
            choices = self.model_info[cls][field][0]
            current = node['inputs'][field]
            if current not in choices:
                matches = [p for p in choices if p.replace('\\', '/').split('/')[-1] == current]
                if not matches:
                    raise RuntimeError('Required model is unavailable: ' + current)
                node['inputs'][field] = matches[0]
        job = self.state.get('job')
        if not job or job.get('key') != key:
            self.wait_idle()
        if job and job.get('key') != key:
            history = self.request('GET', '/history/' + job['id']).get(job['id'])
            if not history:
                # The idle queue has no record of this older job. Its generated files remain reusable.
                self.state.pop('job', None)
            else:
                self.state.pop('job', None)
            job = None
        for retry in range(2):
            if not job:
                job = {'id': str(uuid.uuid4()), 'key': key, 'submitted': time.time()}
                self.update(job=job, stage='提交镜头素材任务', value=0, maximum=1)
                write_json(self.output / (key + '-graph.json'), graph)
                try:
                    self.request('POST', '/prompt', json={'prompt_id': job['id'], 'client_id': 'film-' + self.spec['id'], 'prompt': graph})
                except requests.RequestException:
                    self.update(status='reconnecting', stage='提交响应中断，核对已保存的任务编号')
            missing = None
            while True:
                self.check_pause()
                try:
                    history = self.request('GET', '/history/' + job['id']).get(job['id'])
                    if history:
                        write_json(self.output / (key + '-history.json'), history)
                        self.state.pop('job', None)
                        self.update(value=0, maximum=1)
                        if history['status']['status_str'] == 'success':
                            return history.get('outputs', {})
                        errors = [m[1].get('exception_message', m[0]) for m in history['status'].get('messages', []) if m[0] in ('execution_error', 'execution_interrupted')]
                        if retry:
                            raise RuntimeError('; '.join(errors) or 'Generation failed twice')
                        job = None
                        self.update(stage='此镜头失败，保留已有素材并重试一次')
                        break
                    progress = self.request('GET', '/comfyart/video/render/' + job['id'])
                    if progress.get('status') == 'missing':
                        missing = missing or time.time()
                        if time.time() - missing > 30:
                            self.state.pop('job', None)
                            job = None
                            if retry:
                                raise RuntimeError('生成服务已丢失此任务记录，请恢复服务后继续。')
                            break
                    else:
                        missing = None
                        label = progress.get('stage', '生成中')
                        if self.state.get('phase') == 'images' and 'Sampler' in progress.get('node_type', ''):
                            label = '画面采样' if progress.get('value', 0) > 0 else '加载图像模型 / 采样'
                        self.update(status='running', stage=label, value=progress.get('value', 0), maximum=progress.get('max', 1))
                except requests.RequestException:
                    self.update(status='reconnecting', stage='连接中断，保留任务编号并等待重连')
                time.sleep(3)
        raise RuntimeError('任务未完成，已保留素材与进度。')

    def load(self, filename):
        return json.loads((ROOT / 'workflows' / filename).read_text(encoding='utf-8'))

    def anchors(self):
        for index, anchor in enumerate(self.spec.get('anchors', [])):
            if self.find('anchor-' + anchor['id']):
                continue
            graph = self.load('z-image-turbo-t2i.api.json')
            graph['5']['inputs'].update(width=self.spec['keyframe_width'], height=self.spec['keyframe_height'])
            graph['6']['inputs']['text'] = anchor['prompt']
            graph['7']['inputs']['seed'] = 2026102000 + index
            graph['9']['inputs']['filename_prefix'] = self.prefix + '/anchor-' + anchor['id']
            self.update(stage='生成角色与场景参考 · ' + anchor['id'])
            self.graph('anchor-' + anchor['id'], graph)
            self.scan()

    def keyframes(self):
        for index, shot in enumerate(self.spec['scenes']):
            self.check_pause()
            if shot.get('continue_previous'):
                continue
            if self.find('key-' + shot['id']):
                continue
            if shot.get('keyframe_mode') == 't2i':
                graph = self.load('z-image-turbo-t2i.api.json')
                graph['5']['inputs'].update(width=self.spec['keyframe_width'], height=self.spec['keyframe_height'])
                graph['6']['inputs']['text'] = shot['keyframe']
                graph['7']['inputs']['seed'] = shot.get('keyframe_seed', 2026102100 + index)
                graph['9']['inputs']['filename_prefix'] = self.prefix + '/key-' + shot['id']
                self.update(stage=f'生成新场景关键帧 {index + 1}/{len(self.spec["scenes"])} · {shot["title"]}', active_shot=index)
                self.graph('key-' + shot['id'], graph)
                self.scan()
                continue
            graph = self.load('edit-qwen-image-2.1.api.json')
            refs = shot['references']
            for ref_index, name in enumerate(refs):
                path = self.find('anchor-' + name)
                if not path:
                    raise RuntimeError('Missing reference: ' + name)
                node = '11' if not ref_index else 'ref-' + str(ref_index)
                graph[node] = {'class_type': 'LoadImage', 'inputs': {'image': self.prefix + '/' + path.name + ' [output]'}}
                graph['6']['inputs']['images.image_' + str(ref_index + 1)] = [node, 0]
            graph['6']['inputs']['prompt'] = shot['keyframe']
            graph['7']['inputs'].update(seed=2026102100 + index, steps=self.spec.get('image_steps', 20))
            graph['9']['inputs']['filename_prefix'] = self.prefix + '/key-' + shot['id']
            self.update(stage=f'生成动作关键帧 {index + 1}/{len(self.spec["scenes"])} · {shot["title"]}', active_shot=index)
            self.graph('key-' + shot['id'], graph)
            self.scan()

    def videos(self):
        for index, shot in enumerate(self.spec['scenes']):
            approved = self.output / ('clip-' + shot['id'] + '-accepted.json')
            if approved.is_file() and (self.output / read_json(approved, {}).get('filename', '_missing')).is_file():
                continue
            existing = self.find('clip-' + shot['id'], video=True) or self.find('clip-' + shot['id'] + '-retry', video=True)
            if existing:
                metric = video_metrics(existing)
                if metric['seconds'] >= shot['native_seconds']:
                    write_json(approved, {**metric, 'filename': existing.name})
                    self.scan()
                    continue
            keyframe = self.find('key-' + shot['id'])
            if shot.get('continue_previous') and not keyframe:
                if index == 0 or self.spec['scenes'][index - 1].get('location') != shot.get('location'):
                    raise ValueError('A continuous shot must have a preceding shot in the same location')
                previous = self.spec['scenes'][index - 1]
                previous_ref = read_json(self.output / ('clip-' + previous['id'] + '-accepted.json'), {})
                source = self.output / previous_ref.get('filename', '_missing')
                if not source.is_file():
                    raise ValueError('Previous native video is required for continuity')
                keyframe = self.output / ('key-' + shot['id'] + '_from-video.png')
                self.update(stage='提取上一镜头实际画面 · ' + shot['title'])
                last_frame(source, keyframe)
                self.scan()
            if not keyframe:
                raise RuntimeError('Missing keyframe: ' + shot['id'])
            for attempt in range(2):
                self.check_pause()
                graph = self.load('i2v-minimax-h3.api.json')
                graph['114']['inputs']['image'] = self.prefix + '/' + keyframe.name + ' [output]'
                graph['105:104']['inputs'].update(prompt=shot['motion'], width=self.spec['native_width'], height=self.spec['native_height'])
                graph['105:111']['inputs']['value'] = shot['native_seconds']
                graph['105:126']['inputs']['value'] = True
                graph['105:15']['inputs']['noise_seed'] = 2026103000 + index + 1000 * attempt
                prefix = 'clip-' + shot['id'] + ('-retry' if attempt else '')
                graph['92']['inputs']['filename_prefix'] = self.prefix + '/' + prefix
                self.update(stage=f'生成动态镜头 {index + 1}/{len(self.spec["scenes"])} · {shot["title"]}', active_shot=index)
                outputs = self.graph(prefix, graph)
                result = outputs.get('92', {})
                refs = result.get('images') or result.get('videos') or result.get('gifs') or []
                if not refs:
                    raise RuntimeError('No video returned for shot ' + shot['id'])
                path = self.output / refs[0]['filename']
                metric = video_metrics(path)
                write_json(self.output / (prefix + '-quality.json'), metric)
                if metric['seconds'] >= shot['native_seconds'] and metric['not_frozen']:
                    write_json(approved, {**metric, 'filename': path.name})
                    self.scan()
                    break
                if attempt:
                    raise RuntimeError('镜头 ' + shot['id'] + ' 的视频变化不足；已保留候选文件，需检查后重试。')
                self.update(stage='检测到近似静帧，自动重试此镜头一次')

    def child(self, args, phase):
        self.update(phase=phase, status='running', stage='中文角色配音' if phase == 'voices' else '混音、字幕与剪辑')
        logfile = self.output / (phase + '.log')
        with logfile.open('ab') as log:
            proc = subprocess.Popen(list(map(str, args)), stdout=log, stderr=log, cwd=self.output)
            try:
                while proc.poll() is None:
                    self.check_pause()
                    self.scan()
                    render = read_json(self.output / 'render-progress.json', None)
                    if phase == 'render' and render:
                        self.update(render=render, stage=render.get('stage', '合成中'))
                    time.sleep(3)
            except InterruptedError:
                proc.terminate()
                proc.wait()
                raise
        if proc.returncode:
            raise RuntimeError(logfile.read_text(encoding='utf-8', errors='replace')[-1800:])

    def run(self):
        self.update(status='running', error=None)
        self.prepare()
        speech = Path(os.environ.get('COMFYART_SPEECH_ROOT', r'F:\ComfyArt\speech'))
        python = speech / '.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
        self.child([python, ROOT / 'deploy/story-speech.py', '--story', self.spec_path, '--output', self.output / 'voice'], 'voices')
        self.prepare()
        self.update(phase='images', stage='准备角色与场景参考')
        self.anchors()
        self.keyframes()
        self.prepare()
        self.update(phase='videos', stage='准备原生动态镜头')
        self.videos()
        self.prepare()
        self.child([sys.executable, ROOT / 'deploy/render-directed-timeline.py', '--spec', self.spec_path, '--output', self.output], 'render')
        self.update(status='done', phase='done', stage='完整动态成片已完成', seconds=self.spec['target_seconds'],
                    result={'filename': self.spec['output_filename'], 'subfolder': self.prefix, 'type': 'output'})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--spec', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--base', default='http://127.0.0.1:8188')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    lock = (args.output / 'worker.lock').open('a+b')
    lock.write(b'0'); lock.flush(); lock.seek(0)
    if os.name == 'nt':
        import msvcrt
        msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
    else:
        import fcntl
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    worker = FilmWorker(args.spec.resolve(), args.output.resolve(), args.base)
    try:
        worker.run()
    except InterruptedError as exc:
        worker.update(status='paused', stage=str(exc))
    except Exception as exc:
        worker.update(status='error', stage='制作中断，已完成素材已保留', error=str(exc))
        raise
    finally:
        lock.close()


if __name__ == '__main__':
    main()
