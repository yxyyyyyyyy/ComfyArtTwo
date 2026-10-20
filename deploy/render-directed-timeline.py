"""Compose only native video shots, cue-aligned speech, subtitles and original sound."""
import argparse
import hashlib
import json
import math
import os
import re
import subprocess
from pathlib import Path

for key in ['OPENBLAS_NUM_THREADS', 'OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'NUMEXPR_NUM_THREADS']:
    os.environ.setdefault(key, '1')

import av
import imageio_ffmpeg
import numpy as np
import scipy.signal as signal
import soundfile as sf

SR = 24000
FPS = 24


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def stamp(seconds):
    cs = max(0, round(seconds * 100))
    return f'{cs // 360000}:{cs // 6000 % 60:02}:{cs // 100 % 60:02}.{cs % 100:02}'


def safe_text(text):
    return str(text).replace('\\', '＼').replace('{', '｛').replace('}', '｝').replace('\n', ' ')


def cue_layout(cues, durations, beats, max_speed=1.18):
    """Fit speech inside story beats without retiming or freezing the video track."""
    result = []
    for beat in beats:
        group = [c for c in cues if c['beat'] == beat['id']]
        raw = sum(durations[c['id']] for c in group)
        span = beat['end'] - beat['start']
        available = span - 1.0 - max(0, len(group) - 1) * .18
        if available <= 0:
            raise ValueError('Story beat is too short for narration')
        speed = max(1.0, raw / available)
        if speed > max_speed:
            raise ValueError(f'段落 {beat["title"]} 的配音有 {raw:.1f} 秒，超过自然语速预算；请精简旁白。')
        gap = max(.18, (span - 1.0 - raw / speed) / max(1, len(group)))
        cursor = beat['start'] + .5
        for cue in group:
            length = durations[cue['id']] / speed
            result.append({**cue, 'start': cursor, 'duration': length, 'speed': speed})
            cursor += length + gap
        if result and group and result[-1]['start'] + result[-1]['duration'] > beat['end'] - .3:
            raise ValueError('Voice scheduling exceeded the story beat')
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--spec', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    spec = read_json(args.spec)
    output = args.output.resolve()
    total = float(spec['target_seconds'])
    width, height = spec['width'], spec['height']
    manifest = read_json(output / 'voice/voice-manifest.json')
    fingerprint = hashlib.sha256(json.dumps([spec, manifest], ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:12]
    render = output / ('render-' + fingerprint)
    render.mkdir(exist_ok=True)
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()

    def progress(done, stage):
        target = output / 'render-progress.json'
        temp = target.with_suffix('.tmp')
        temp.write_text(json.dumps({'done': done, 'total': len(spec['scenes']), 'stage': stage}, ensure_ascii=False), encoding='utf-8')
        os.replace(temp, target)

    def ff(arguments, capture=False):
        result = subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', *map(str, arguments)], cwd=render, capture_output=True)
        if result.returncode:
            raise RuntimeError(result.stderr.decode(errors='replace')[-2500:])
        return result.stdout if capture else None

    audio = {}
    for cue in spec['narration']:
        x, rate = sf.read(output / 'voice' / ('voice-' + cue['id'] + '.wav'), dtype='float32')
        if x.ndim > 1:
            x = x.mean(axis=1)
        nonzero = np.flatnonzero(np.abs(x) > max(.001, float(np.max(np.abs(x))) * .012))
        if len(nonzero):
            x = x[max(0, nonzero[0] - round(rate * .06)):min(len(x), nonzero[-1] + round(rate * .14))]
        if rate != SR:
            x = signal.resample_poly(x, SR, rate).astype('float32')
        audio[cue['id']] = x
    timeline = cue_layout(spec['narration'], {key: len(value) / SR for key, value in audio.items()}, spec['beats'])
    count = round(total * SR)
    narration = np.zeros((count, 2), dtype='float32')
    for cue in timeline:
        x = audio[cue['id']]
        if cue['speed'] > 1.001:
            sf.write(render / ('raw-' + cue['id'] + '.wav'), x, SR)
            ff(['-i', 'raw-' + cue['id'] + '.wav', '-af', f'atempo={cue["speed"]:.7f}', 'spoken-' + cue['id'] + '.wav'])
            x = sf.read(render / ('spoken-' + cue['id'] + '.wav'), dtype='float32')[0]
        cue['duration'] = len(x) / SR
        rms = float(np.sqrt(np.mean(x * x)))
        x = x * min(3.0, .11 / max(.001, rms))
        fade = min(180, len(x) // 4)
        x[:fade] *= np.linspace(0, 1, fade)
        x[-fade:] *= np.linspace(1, 0, fade)
        start = round(cue['start'] * SR)
        if start + len(x) > count:
            raise ValueError('Narration would exceed the film; refusing to truncate speech')
        narration[start:start + len(x)] += x[:, None]

    rng = np.random.default_rng(20261020)
    time_axis = np.arange(count, dtype='float32') / SR
    noise = rng.standard_normal(count, dtype='float32')
    air = signal.sosfilt(signal.butter(2, [120, 1900], btype='bandpass', fs=SR, output='sos'), noise).astype('float32')
    drone = .0028 * np.sin(2 * np.pi * 55 * time_axis) + .0015 * np.sin(2 * np.pi * 82.43 * time_axis)
    bed = np.column_stack((drone + .004 * air, drone + .004 * np.roll(air, 703))).astype('float32')

    def effect(at, kind, level=.06):
        length = .4 if kind in ['step', 'latch', 'phone'] else .7
        n = round(length * SR)
        t = np.arange(n, dtype='float32') / SR
        z = rng.standard_normal(n, dtype='float32')
        if kind == 'step':
            sound = (np.sin(2 * np.pi * 88 * t) + .7 * signal.sosfilt(signal.butter(2, 700, fs=SR, output='sos'), z)) * np.exp(-t * 24)
        elif kind == 'latch':
            sound = (.5 * np.sin(2 * np.pi * 1600 * t) + .4 * np.sin(2 * np.pi * 2300 * t) + z * .2) * np.exp(-t * 45)
        elif kind == 'door':
            sound = (np.sin(2 * np.pi * 77 * t) + .6 * signal.sosfilt(signal.butter(2, 1300, fs=SR, output='sos'), z)) * np.exp(-t * 12)
        elif kind in ['paper', 'cloth']:
            sound = signal.sosfilt(signal.butter(2, [800, 4500] if kind == 'paper' else [150, 1600], btype='bandpass', fs=SR, output='sos'), z) * np.sin(np.pi * t / length) ** 2
        else:
            return
        sound = sound.astype('float32') * (level / max(.01, float(np.max(np.abs(sound)))))
        start = round(at * SR)
        usable = min(len(sound), count - start)
        if usable > 0:
            bed[start:start + usable] += sound[:usable, None] * np.array([[.7, .65]], dtype='float32')

    clips = []
    cursor = 0.0
    for shot in spec['scenes']:
        accepted = read_json(output / ('clip-' + shot['id'] + '-accepted.json'))
        src = output / accepted['filename']
        with av.open(str(src)) as container:
            native = float(container.duration / av.time_base)
            video = container.streams.video[0]
            if not accepted.get('not_frozen') or native < shot['native_seconds']:
                raise ValueError('Incomplete or frozen native source: ' + shot['id'])
            if (video.width, video.height) != (spec['native_width'], spec['native_height']):
                raise ValueError('Unexpected native video dimensions: ' + shot['id'])
            if container.streams.audio and spec.get('use_native_audio', True):
                raw = ff(['-i', src, '-t', shot['native_seconds'], '-vn', '-ac', 2, '-ar', SR, '-f', 'f32le', 'pipe:1'], True)
                ambience = np.frombuffer(raw, dtype='<f4').reshape(-1, 2)
                start = round(cursor * SR)
                n = min(len(ambience), count - start)
                bed[start:start + n] += ambience[:n] * .045
        duration = min(shot['native_seconds'], total - cursor)
        clips.append({'id': shot['id'], 'path': str(src), 'start': cursor, 'duration': duration, 'native_seconds': native, 'speed': 1.0})
        if shot['sfx'] == 'walk':
            for offset in [.8, 2.1, 3.5]:
                effect(cursor + offset, 'step', .055)
        else:
            effect(cursor + (3.4 if shot['sfx'] == 'latch' else 1.4), shot['sfx'], .07 if shot['sfx'] == 'latch' else .035)
        cursor += duration
    if abs(cursor - total) > .01:
        raise ValueError('Native videos do not cover the target duration; no still-frame padding is permitted')

    envelope = np.sqrt(signal.lfilter(np.ones(480, dtype='float32') / 480, [1], np.mean(narration * narration, axis=1))).astype('float32')
    bed *= (1 / (1 + envelope * 14))[:, None]
    mix = narration + bed
    peak = float(np.max(np.abs(mix)))
    if peak > .94:
        mix *= .94 / peak
    fade = round(.65 * SR)
    mix[:fade] *= np.linspace(0, 1, fade)[:, None]
    mix[-fade:] *= np.linspace(1, 0, fade)[:, None]
    sf.write(render / 'mix.wav', mix, SR, subtype='FLOAT')
    ff(['-i', 'mix.wav', '-af', 'highpass=f=65,loudnorm=I=-16:TP=-1.5:LRA=10', '-ar', 48000, '-c:a', 'pcm_s16le', 'master.wav'])

    header = f'''[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
ScaledBorderAndShadow: yes
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Body,Microsoft YaHei,36,&H00F5F1EA,&H000000FF,&H00101920,&H80000000,0,0,0,0,100,100,0,0,1,3,1,2,48,48,74,1
Style: Title,Microsoft YaHei,64,&H00E9E3D7,&H000000FF,&H00101920,&H80000000,-1,0,0,0,100,100,5,0,1,2,1,8,48,48,120,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''
    events = [(0.2, 3.5, 'Title', r'{\fad(400,600)}' + safe_text(spec['title']))]
    for cue in timeline:
        text = (cue['role'] + '：' if cue['role'] != '旁白' else '') + safe_text(cue['text'])
        units = re.findall(r'.{1,28}', text)
        pos = cue['start']
        for unit in units:
            length = cue['duration'] * len(unit) / len(text)
            wrapped = unit if len(unit) <= 18 else unit[:len(unit) // 2] + r'\N' + unit[len(unit) // 2:]
            events.append((pos, pos + length, 'Body', r'{\fad(45,60)}' + wrapped))
            pos += length
    (output / 'subtitles.ass').write_text(header + '\n'.join(f'Dialogue: 0,{stamp(a)},{stamp(b)},{style},,0,0,0,,{text}' for a, b, style, text in events) + '\n', encoding='utf-8')

    for index, clip in enumerate(clips):
        progress(index, f'合成动态镜头 {index + 1}/{len(clips)}')
        dst = render / f'shot-{index:03}.mp4'
        if dst.is_file():
            with av.open(str(dst)) as container:
                if abs(float(container.duration / av.time_base) - clip['duration']) < .03:
                    continue
        start, end = clip['start'], clip['start'] + clip['duration']
        rows = [f'Dialogue: 0,{stamp(max(a, start) - start)},{stamp(min(b, end) - start)},{style},,0,0,0,,{text}' for a, b, style, text in events if a < end and b > start]
        (render / f'captions-{index:03}.ass').write_text(header + '\n'.join(rows) + '\n', encoding='utf-8')
        offset = .08 if clip['native_seconds'] >= clip['duration'] + .1 else 0
        vf = f'trim=start={offset}:duration={clip["duration"]},setpts=PTS-STARTPTS,fps={FPS},scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},setsar=1,ass=filename=captions-{index:03}.ass'
        if index == 0:
            vf += ',fade=t=in:st=0:d=0.3'
        if index == len(clips) - 1:
            vf += f',fade=t=out:st={clip["duration"] - .65}:d=0.65'
        ff(['-i', clip['path'], '-vf', vf, '-frames:v', round(clip['duration'] * FPS), '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', 18, '-pix_fmt', 'yuv420p', '-threads', 4, dst])

    (render / 'shots.txt').write_text(''.join(f"file 'shot-{i:03}.mp4'\n" for i in range(len(clips))), encoding='utf-8')
    progress(len(clips), '导出完整动态视频')
    target = output / spec['output_filename']
    if Path(spec['output_filename']).name != spec['output_filename']:
        raise ValueError('Output filename must not include a directory')
    ff(['-f', 'concat', '-safe', 1, '-i', 'shots.txt', '-i', 'master.wav', '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', 48000, '-t', total, '-movflags', '+faststart', target])
    with av.open(str(target)) as container:
        video = container.streams.video[0]
        duration = float(container.duration / av.time_base)
        if abs(duration - total) > .12 or (video.width, video.height) != (width, height) or not container.streams.audio:
            raise ValueError('Final film verification failed')
        proof = {'status': 'verified', 'seconds': duration, 'width': width, 'height': height, 'fps': float(video.average_rate),
                 'shots': len(clips), 'voices': len(timeline), 'native_video_seconds': total, 'still_frame_padding_seconds': 0,
                 'max_video_speed_change': 0, 'voice_max_speed': max((c['speed'] for c in timeline), default=1.0)}
    (output / 'timeline.json').write_text(json.dumps({'clips': clips, 'narration': timeline, 'verification': proof}, ensure_ascii=False, indent=2), encoding='utf-8')
    (output / 'verification.json').write_text(json.dumps(proof, ensure_ascii=False, indent=2), encoding='utf-8')
    progress(len(clips), '完整动态视频已完成')
    print(json.dumps(proof, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
