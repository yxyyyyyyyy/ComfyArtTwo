"""Local video resource handoff and resumable, cue-aligned assembly jobs."""
import asyncio
import hashlib
import json
import os
import re
import shutil
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import aiohttp
import av
import folder_paths
from aiohttp import web
from server import PromptServer

from ._common import app_path, error, json_body, read_json, request_user, routes, write_json

_TASKS = {}
_VOICE_LOCK = asyncio.Lock()


def clip_path(src: str) -> Path:
    u = urlsplit(src)
    if u.netloc or u.scheme or u.path not in ('/api/view', '/view'):
        raise ValueError('只接受本地 ComfyUI 视频文件。')
    q = parse_qs(u.query)
    if q.get('type', ['output'])[0] != 'output':
        raise ValueError('只接受已生成的 output 视频。')
    root = Path(folder_paths.get_output_directory()).resolve()
    path = (root / q.get('subfolder', [''])[0] / q.get('filename', [''])[0]).resolve()
    if root not in path.parents or path.suffix.lower() not in ('.mp4', '.webm', '.mov') or not path.is_file():
        raise ValueError('视频文件不存在或路径无效。')
    return path


def job_file(user: str, jid: str) -> Path:
    if not re.fullmatch(r'[a-f0-9]{32}', jid):
        raise ValueError('invalid job id')
    return Path(app_path('video-jobs', hashlib.sha256(user.encode()).hexdigest(), jid + '.json'))


async def prepare_resources() -> bool:
    """Only release this instance's idle cache and its managed Agent, never other processes."""
    from .bot_turns import ACTIVE_TURNS, provider_model
    from .settings import get_setting
    from ..bot.local_llm import LocalLlmProvider
    if PromptServer.instance.prompt_queue.get_tasks_remaining():
        return False
    async with aiohttp.ClientSession() as session:
        provider = LocalLlmProvider(base_url=lambda: str(get_setting('bot-local-llm-url') or ''))
        if provider._managed_ollama() and not ACTIVE_TURNS:
            model = provider_model('local-llm')
            if model:
                await provider._release_ollama(session, model)
        port = PromptServer.instance.port
        async with session.post(f'http://127.0.0.1:{port}/free', json={'unload_models': True, 'free_memory': True}) as response:
            response.raise_for_status()
        await asyncio.sleep(1)  # Let the idle execution worker process its free flags before submission.
    return True


@routes.post('/comfyart/video/prepare')
async def prepare_video(request):
    request_user(request)
    if _VOICE_LOCK.locked():
        return error('正在合成本项目的旁白，请完成后再提交视频。', 409)
    try:
        return web.json_response({'released_idle_cache': await prepare_resources()})
    except (OSError, RuntimeError, aiohttp.ClientError, asyncio.TimeoutError) as e:
        return error('视频资源准备失败：' + str(e), 503)



def render_status(prompt_id, queue, registry):
    history = queue.get_history(prompt_id=prompt_id).get(prompt_id)
    if history:
        failure = next((m for m in history.get('status', {}).get('messages', []) if m[0] in ('execution_error', 'execution_interrupted')), None)
        if failure:
            message = failure[1].get('exception_message') or '此镜头生成已中止；已完成镜头保留。'
            if 'Fault failed: 2' in message:
                message = '模型权重调入显存失败，此镜头未完成。已完成镜头保留；可以重试此镜头。'
            return {'status': 'error', 'error': message}
        output = history.get('outputs', {}).get('92', {})
        refs = output.get('images') or output.get('videos') or output.get('gifs')
        if refs:
            return {'status': 'done', 'outputs': refs}
        return {'status': 'error', 'error': '任务结束但没有输出视频，请重试此镜头。'}
    running, pending = queue.get_current_queue_volatile()
    for position, item in enumerate(sorted(pending), 1):
        if item[1] == prompt_id:
            return {'status': 'queued', 'stage': '排队等待', 'position': position}
    item = next((item for item in running if item[1] == prompt_id), None)
    if item is None:
        return {'status': 'missing', 'error': '服务中没有此任务记录，可能因服务重启而中断。已完成镜头保留，可从此镜头重试。'}
    result = {'status': 'running', 'stage': '准备模型', 'started': item[3].get('create_time')}
    if registry.prompt_id == prompt_id:
        for node_id, state in list(registry.nodes.items()):
            if state['state'].value != 'running':
                continue
            kind = registry.dynprompt.get_node(node_id)['class_type']
            stage = ('声音解码' if kind == 'VAEDecodeAudio' else '视频解码' if 'VAEDecode' in kind else '保存视频' if 'SaveVideo' in kind else
                     '文本编码 / 加载文本模型' if 'CLIP' in kind or kind in ('MiniMaxH3ImageToVideo', 'MiniMaxH3ReferenceToVideo') else '加载视频模型 / 采样' if 'Sampler' in kind else '准备模型与画面')
            result.update(node=node_id, node_type=kind, stage=stage, value=state['value'], max=state['max'])
            if 'Sampler' in kind and state['value'] > 0:
                result['stage'] = '视频采样'
    return result


@routes.get('/comfyart/video/render/{pid}')
async def render_progress(request):
    request_user(request)
    from comfy_execution.progress import get_progress_state
    return web.json_response(render_status(request.match_info['pid'], PromptServer.instance.prompt_queue, get_progress_state()))


def validate_clips(body):
    clips = body.get('clips')
    if not isinstance(clips, list) or not 1 <= len(clips) <= 60:
        raise ValueError('需要 1–60 个已生成镜头。')
    out = []
    for clip in clips:
        if not isinstance(clip, dict) or not isinstance(clip.get('src'), str):
            raise ValueError('镜头缺少视频地址。')
        narration = str(clip.get('narration') or '').strip()
        if len(narration) > 150:
            raise ValueError('单镜头旁白最多 150 字，请拆分。')
        out.append({'path': str(clip_path(clip['src'])), 'narration': narration})
    return out


def seconds(path):
    with av.open(str(path)) as container:
        return float(container.duration / av.time_base) if container.duration else 0


def stamp(t):
    ms = round(t * 1000)
    return f'{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}'


def subtitle_filter(path):
    # Paths are generated locally; text lives in SRT, never inside a shell/filter expression.
    escaped = str(path).replace('\\', '/').replace(':', '\\:').replace("'", "'\\''")
    return f"subtitles=filename='{escaped}':force_style='FontName=Microsoft YaHei,FontSize=18,Outline=1,MarginV=24'"


async def command(args, cwd, logfile):
    with open(logfile, 'ab') as log:
        proc = await asyncio.create_subprocess_exec(*map(str, args), cwd=str(cwd), stdout=log, stderr=log)
        try:
            code = await asyncio.wait_for(proc.wait(), 2400)
        except asyncio.CancelledError:
            if proc.returncode is None:
                proc.kill(); await proc.wait()
            raise
        except asyncio.TimeoutError:
            proc.kill(); await proc.wait()
            raise RuntimeError('本项目合成进程超时，已停止；已生成镜头仍保留。')
    if code:
        tail = Path(logfile).read_text(encoding='utf-8', errors='replace')[-1500:]
        raise RuntimeError(f'合成失败（退出码 {code}）：{tail}')


async def assemble(user, jid, clips, voice):
    path = job_file(user, jid)
    state = read_json(str(path), {})
    def update(**values):
        state.update(values); write_json(str(path), state)
    root = Path(folder_paths.get_output_directory()) / 'comfyart' / 'stories' / jid
    root.mkdir(parents=True, exist_ok=True)
    log = root / 'assembly.log'
    try:
        import imageio_ffmpeg
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        async with _VOICE_LOCK:
            cues = [{'id': str(i), 'text': c['narration'], 'tone': '低沉克制的悬疑故事旁白，清晰自然，不夸张。'} for i, c in enumerate(clips) if voice and c['narration']]
            if cues:
                if PromptServer.instance.prompt_queue.get_tasks_remaining():
                    raise RuntimeError('视频队列仍有任务，请等待完成后重试合成。')
                await prepare_resources()
                speech = Path(os.getenv('COMFYART_SPEECH_ROOT', r'F:\ComfyArt\speech'))
                python = speech / '.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
                script = Path(__file__).resolve().parents[1] / 'deploy' / 'story-speech.py'
                if not python.is_file():
                    raise RuntimeError('尚未安装本地 Qwen3-TTS 语音环境；可关闭旁白后合成环境声版本。')
                (root / 'story.json').write_text(json.dumps({'narration': cues}, ensure_ascii=False), encoding='utf-8')
                update(status='voicing', progress=0)
                await command([python, script, '--story', root / 'story.json', '--output', root, '--model', speech / 'models/Qwen3-TTS-12Hz-1.7B-CustomVoice'], root, log)
            update(status='assembling', progress=0, stage='逐镜混音与时长对齐')
            with av.open(clips[0]['path']) as container:
                target_w, target_h = container.streams.video[0].width, container.streams.video[0].height
            timeline = []; cursor = 0
            for i, clip in enumerate(clips):
                src = Path(clip['path']); native = await asyncio.to_thread(seconds, src)
                if not native:
                    raise RuntimeError(f'镜头 {i + 1} 没有可读的视频时长。')
                wav = root / f'voice-{i}.wav'
                spoken = bool(voice and clip['narration'])
                length = max(native, await asyncio.to_thread(seconds, wav) + 0.3) if spoken else native
                args = [ffmpeg, '-y', '-i', src]
                if spoken:
                    args += ['-i', wav]
                with av.open(str(src)) as container:
                    has_audio = bool(container.streams.audio)
                vf = f'setpts={length / native:.7f}*PTS,scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p'
                audio = f'[0:a]volume=0.18,apad,atrim=duration={length}[bg];[1:a]apad,atrim=duration={length}[v];[bg][v]amix=inputs=2:normalize=0[a]' if spoken and has_audio else f'[1:a]apad,atrim=duration={length}[a]' if spoken else f'[0:a]apad,atrim=duration={length}[a]' if has_audio else f'anullsrc=r=24000:cl=mono,atrim=duration={length}[a]'
                args += ['-vf', vf, '-filter_complex', audio, '-map', '0:v:0', '-map', '[a]', '-t', str(length), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', root / f'clip-{i:03}.mp4']
                await command(args, root, log)
                if spoken:
                    text = clip['narration'].replace('\r', '').replace('\n', ' ')
                    timeline.append(f'{len(timeline)+1}\n{stamp(cursor)} --> {stamp(cursor+length)}\n{text}\n')
                cursor += length
                update(progress=i+1)
            update(stage='拼接全部镜头')
            (root / 'concat.txt').write_text(''.join(f"file 'clip-{i:03}.mp4'\n" for i in range(len(clips))), encoding='utf-8')
            await command([ffmpeg, '-y', '-f', 'concat', '-safe', '1', '-i', 'concat.txt', '-c', 'copy', '-movflags', '+faststart', 'joined.mp4'], root, log)
            if timeline:
                update(stage='压制中文字幕 / 导出成片')
                (root / 'subtitles.srt').write_text('\n'.join(timeline), encoding='utf-8')
                # Relative generated filename avoids drive-letter escaping in libass.
                await command([ffmpeg, '-y', '-i', 'joined.mp4', '-vf', subtitle_filter('subtitles.srt'), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'copy', '-movflags', '+faststart', 'final.mp4'], root, log)
            else:
                shutil.copyfile(root / 'joined.mp4', root / 'final.mp4')
            update(status='done', seconds=round(cursor, 3), narrated=bool(cues), native_seconds=round(sum(await asyncio.gather(*(asyncio.to_thread(seconds, c['path']) for c in clips))), 3), result={'filename':'final.mp4','subfolder':f'comfyart/stories/{jid}','type':'output'})
    except Exception as exc:
        update(status='error', error=str(exc))


@routes.post('/comfyart/video/assemble')
async def start_assembly(request):
    user = request_user(request)
    body = await json_body(request)
    try:
        clips = validate_clips(body)
    except (ValueError, OSError) as exc:
        return error(str(exc), 400)
    jid = body.get('id') or uuid.uuid4().hex
    try:
        path = job_file(user, jid)
    except (ValueError, TypeError) as exc:
        return error(str(exc), 400)
    fingerprint = hashlib.sha256(json.dumps([clips, body.get('voice', True) is True], sort_keys=True).encode()).hexdigest()
    existing = read_json(str(path), None)
    if existing:
        if existing.get('fingerprint') != fingerprint:
            return error('此合成编号对应其他内容，请重新提交。', 409)
        return web.json_response({'id': jid}, status=202)
    write_json(str(path), {'id': jid, 'status': 'queued', 'total': len(clips), 'progress': 0, 'fingerprint': fingerprint})
    task = asyncio.create_task(assemble(user, jid, clips, body.get('voice', True) is True))
    _TASKS[jid] = task; task.add_done_callback(lambda _: _TASKS.pop(jid, None))
    return web.json_response({'id': jid}, status=202)


@routes.get('/comfyart/video/assemble/{jid}')
async def assembly_status(request):
    try:
        path = job_file(request_user(request), request.match_info['jid'])
    except ValueError as exc:
        return error(str(exc), 400)
    state = read_json(str(path), None)
    if state is None:
        return error('job not found', 404)
    if state.get('status') not in ('done', 'error') and request.match_info['jid'] not in _TASKS:
        state.update(status='error', error='服务已重启，合成中断。已生成镜头保留，可重新合成。')
        write_json(str(path), state)
    if state.get('status') == 'voicing':
        root = Path(folder_paths.get_output_directory()) / 'comfyart' / 'stories' / state['id']
        records = read_json(str(root / 'voice-manifest.json'), [])
        cues = read_json(str(root / 'story.json'), {}).get('narration', [])
        state.update(progress=len(records), total=len(cues), stage='生成中文旁白' if records else '加载本地语音模型')
    return web.json_response(state)


@routes.post('/comfyart/video/production/{pid}/control')
async def production_control(request):
    request_user(request)
    pid = request.match_info['pid']
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}', pid):
        return error('invalid production id', 400)
    spec = Path(__file__).resolve().parents[1] / 'productions' / pid / 'episode.json'
    if not spec.is_file():
        return error('production not found', 404)
    body = await json_body(request)
    if not isinstance(body.get('pause'), bool):
        return error('pause must be a boolean', 400)
    root = Path(folder_paths.get_output_directory()) / 'comfyart' / pid
    write_json(str(root / 'control.json'), {'pause': body['pause']})
    if not body['pause']:
        if os.name != 'nt':
            return error('此制作任务需要在已配置的 Windows 5090 上启动。', 503)
        proc = await asyncio.create_subprocess_exec('schtasks.exe', '/Run', '/TN', 'ComfyArt-Episode-' + pid, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        out, err = await proc.communicate()
        if proc.returncode:
            return error('无法启动本集制作任务：' + (err or out).decode(errors='replace')[-500:], 503)
    return web.json_response({'paused': body['pause']})
