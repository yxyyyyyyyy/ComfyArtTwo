"""Finish a six-scene, six-minute vertical comic from verified local assets and voices."""
import argparse
import json
import math
import re
import subprocess
import os
from pathlib import Path

for key,value in {'OPENBLAS_NUM_THREADS':'1','OMP_NUM_THREADS':'4','MKL_NUM_THREADS':'4','NUMEXPR_NUM_THREADS':'1'}.items():os.environ[key]=value

import av
import imageio_ffmpeg
import numpy as np
import scipy.signal as signal
import soundfile as sf

p = argparse.ArgumentParser()
p.add_argument('--spec', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
p.add_argument('--illustrated-only', action='store_true', help='Produce an explicit camera-motion comic edition without native model clips')
a = p.parse_args()
SPEC = json.loads(a.spec.read_text(encoding='utf-8'))
D = a.output.resolve(); edition = 'illustrated' if a.illustrated_only else 'final'
R = D / ('render-illustrated' if a.illustrated_only else 'render'); R.mkdir(exist_ok=True)
TARGET = D / ('illustrated.mp4' if a.illustrated_only else SPEC.get('output_filename', 'final.mp4'))
FF = imageio_ffmpeg.get_ffmpeg_exe()
SR = 24000; FPS = 24; W = 720; H = 1280; TOTAL = 360


def state(**data):
    path = D / ('illustrated-progress.json' if a.illustrated_only else 'render-progress.json'); tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8'); tmp.replace(path)


def ff(args, capture=False):
    r = subprocess.run([FF, '-hide_banner', '-loglevel', 'error', '-y', *map(str, args)], cwd=R, capture_output=True)
    if r.returncode: raise RuntimeError(r.stderr.decode(errors='replace')[-2500:])
    return r.stdout if capture else None


def stamp(t):
    cs = max(0, round(t * 100)); return f'{cs//360000}:{cs//6000%60:02}:{cs//100%60:02}.{cs%100:02}'


def voice(cue):
    x, rate = sf.read(D / 'voice' / ('voice-' + cue['id'] + '.wav'), dtype='float32')
    if x.ndim > 1: x = x.mean(axis=1)
    active = np.flatnonzero(np.abs(x) > max(.001, float(np.max(np.abs(x))) * .012))
    if len(active): x = x[max(0, active[0]-int(.07*rate)):min(len(x),active[-1]+int(.16*rate))]
    if rate != SR: x = signal.resample_poly(x, SR, rate).astype('float32')
    return x


voices = {cue['id']: voice(cue) for cue in SPEC['narration']}
gaps = sum(cue.get('pause_after', .45) for cue in SPEC['narration'])
raw_seconds = sum(len(v) / SR for v in voices.values())
# Reserve atmosphere and scene transitions. Never stretch a short native clip to the episode length.
speed = max(1.0, raw_seconds / (TOTAL - gaps - 28))
if speed > 1.28: raise RuntimeError(f'配音共 {raw_seconds:.1f} 秒，无法在自然语速下放入六分钟；需要修订扩写台词。')
if speed > 1.001:
    for cue in SPEC['narration']:
        src = R / ('raw-' + cue['id'] + '.wav'); dst = R / ('spoken-' + cue['id'] + '.wav')
        sf.write(src, voices[cue['id']], SR)
        ff(['-i',src,'-af',f'atempo={speed:.7f}',dst]); voices[cue['id']] = sf.read(dst,dtype='float32')[0]

mins = [sum(len(voices[c['id']])/SR + c.get('pause_after',.45) for c in scene['narration']) + 3 for scene in SPEC['scenes']]
left = TOTAL - sum(mins)
if left < 0: raise RuntimeError('配音时间仍超过一集时长。')
durations = [m + left / 6 for m in mins]
bounds = [0]
for t in durations[:-1]: bounds.append(round((bounds[-1]+t)*FPS)/FPS)
bounds.append(TOTAL)
segments = []; timeline = []; cursor = 0
for i, scene in enumerate(SPEC['scenes']):
    start, end = bounds[i], bounds[i+1]; length = end-start
    speech_length = sum(len(voices[c['id']])/SR + c.get('pause_after',.45) for c in scene['narration'])
    spare = max(0, length-speech_length-2)
    pos = start + 1.2
    for cue in scene['narration']:
        duration = len(voices[cue['id']])/SR
        timeline.append({**cue, 'scene':scene['id'], 'start':pos, 'duration':duration})
        pos += duration + cue.get('pause_after',.45) + spare / max(1,len(scene['narration']))
    native = float(scene.get("native_seconds", 15))
    edit = scene.get('edit', {})
    # Keep visual reveals on their spoken beats, especially the final empty tunnel.
    end_cue = next((c for c in timeline if c['scene']==scene['id'] and c['id']==edit.get('end_cue')), None)
    cut = round(end_cue['start']*FPS)/FPS if end_cue else start+native+round((length-native)*.58*FPS)/FPS
    cut = min(end-1, max(start+native+1, cut))
    action = next((c for c in timeline if c['scene']==scene['id'] and c['id']==edit.get('native_cue')), None)
    if action:
        at = round(action['start']*FPS)/FPS
        assert start < at and at+native < end
        segments += [
            {'scene':scene['id'],'start':start,'duration':at-start,'kind':'comic','panel':'a'},
            {'scene':scene['id'],'start':at,'duration':native,'kind':'comic' if a.illustrated_only else 'native','panel':'a'},
            {'scene':scene['id'],'start':at+native,'duration':end-at-native,'kind':'comic','panel':'b'},
        ]
        continue
    segments += [
        {'scene':scene['id'],'start':start,'duration':native,'kind':'comic' if a.illustrated_only else 'native','panel':'a'},
        {'scene':scene['id'],'start':start+native,'duration':cut-start-native,'kind':'comic','panel':edit.get('middle_panel','b')},
        {'scene':scene['id'],'start':cut,'duration':end-cut,'kind':'comic','panel':edit.get('end_panel','b' if i==5 else 'a')},
    ]

N = TOTAL * SR
narration = np.zeros((N,2),dtype='float32')
for cue in timeline:
    x = voices[cue['id']].copy()
    rms = float(np.sqrt(np.mean(x*x))); gain = min(3, .11/max(rms,.001)); x *= gain
    fade = min(200,len(x)//4); x[:fade] *= np.linspace(0,1,fade); x[-fade:] *= np.linspace(1,0,fade)
    pos = round(cue['start']*SR); n = min(len(x),N-pos)
    narration[pos:pos+n] += x[:n,None]

rng = np.random.default_rng(20261019)
t = np.arange(N,dtype='float32')/SR
noise = rng.standard_normal(N,dtype='float32')
air = signal.sosfilt(signal.butter(2,[130,2400],btype='bandpass',fs=SR,output='sos'),noise).astype('float32')
pad = (.003*np.sin(2*np.pi*55*t)+.002*np.sin(2*np.pi*58.27*t)+.0018*np.sin(2*np.pi*110*t))
bed = np.column_stack((pad+air*.007,pad+np.roll(air,731)*.007)).astype('float32')
# Retain the generated ambience at scene openings; illustrated dialogue sections use a continuous original bed.
for i, scene in enumerate(SPEC['scenes']):
    if a.illustrated_only: continue
    path = sorted(D.glob('clip-'+scene['id']+'_*.mp4'))[-1]
    raw = ff(['-i',path,'-t',scene.get('native_seconds',15),'-vn','-ac','2','-ar',SR,'-f','f32le','pipe:1'],True)
    env = np.frombuffer(raw,dtype='<f4').reshape(-1,2).copy(); env *= .13
    k = round(bounds[i]*SR); m=min(len(env),N-k); bed[k:k+m] += env[:m]


def effect(at,duration,kind,level=.18,pan=0):
    m=round(duration*SR); tt=np.arange(m,dtype='float32')/SR; nn=rng.standard_normal(m,dtype='float32')
    if kind=='step': x=(np.sin(2*np.pi*82*tt)+signal.sosfilt(signal.butter(2,800,fs=SR,output='sos'),nn))*np.exp(-tt*22)
    elif kind=='phone': x=(np.sin(2*np.pi*210*tt)+.35*np.sin(2*np.pi*420*tt))*np.sin(np.pi*np.minimum(tt/duration,1))**2
    elif kind=='door': x=(.5*np.sin(2*np.pi*67*tt)+signal.sosfilt(signal.butter(2,1500,fs=SR,output='sos'),nn))*np.exp(-tt*6)
    else: x=signal.sosfilt(signal.butter(2,[700,3500],btype='bandpass',fs=SR,output='sos'),nn)*np.exp(-tt*8)
    x=x.astype('float32');x*=level/max(float(np.max(np.abs(x))),.01)
    k=round(at*SR); m=min(m,N-k)
    if m>0:bed[k:k+m] += x[:m,None]*np.array([[math.sqrt((1-pan)/2),math.sqrt((1+pan)/2)]],dtype='float32')

for i in [0,2]:
    for offset in [2.2,3.8,5.4]:effect(bounds[i]+offset,.6,'phone',.08,-.2)
effect(bounds[1]+3,.6,'door',.16,.2)
for off in [.5,2.4,4.4,8.2,11.4]:effect(bounds[5]+off,.4,'step',.13,-.2)
effect(bounds[2]+14.5,.7,'door',.2,.4)
effect(bounds[2]+1.4,.18,'click',.14,.25)
# An original non-lyrical Japanese vocal cue, not a quotation from an existing song.
hum_path = D / 'voice/voice-1000.wav'
if hum_path.exists():
    x = voice({'id':'1000'}); x=signal.sosfilt(signal.butter(2,[300,2500],btype='bandpass',fs=SR,output='sos'),x).astype('float32')
    trigger = next(c for c in timeline if c['id']=='53'); at=trigger['start']+trigger['duration']+.15
    x=x[:round(4.4*SR)]; peak=max(float(np.max(np.abs(x))),.01);x*=.07/peak
    for delay,gain in [(0,1),(.37,.45),(.83,.25),(1.26,.13)]:
        k=round((at+delay)*SR);m=min(len(x),N-k)
        bed[k:k+m,0]+=x[:m]*gain*.72;bed[k:k+m,1]+=x[:m]*gain
# Give the final empty-corner reveal a short, deliberate silence.
last=timeline[-1]; cut=round((last['start']+.25)*SR);bed[cut:min(N,cut+round(.55*SR))]*=.03
envelope=np.sqrt(signal.lfilter(np.ones(600,dtype='float32')/600,[1],np.mean(narration*narration,axis=1))).astype('float32')
bed*= (1/(1+envelope*13))[:,None]
mix=narration+bed; peak=float(np.max(np.abs(mix)))
if peak>.94:mix*=.94/peak
fade=round(1.5*SR);mix[:fade]*=np.linspace(0,1,fade)[:,None];mix[-fade:]*=np.linspace(1,0,fade)[:,None]
sf.write(R/'mix.wav',mix,SR,subtype='FLOAT')
ff(['-i','mix.wav','-af','highpass=f=65,loudnorm=I=-16:TP=-1.5:LRA=10','-ar','48000','-c:a','pcm_s16le','master.wav'])

HEADER='''[Script Info]
ScriptType: v4.00+
PlayResX: 720
PlayResY: 1280
ScaledBorderAndShadow: yes
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Body,Microsoft YaHei,32,&H00F5F1EA,&H000000FF,&H00131921,&H99000000,0,0,0,0,100,100,1,0,1,2,1,2,36,36,90,1
Style: Chapter,Microsoft YaHei,29,&H009DB8D1,&H000000FF,&H00131921,&H99000000,0,0,0,0,100,100,2,0,1,1,0,7,34,34,47,1
Style: Title,Microsoft YaHei,58,&H00F0EAE0,&H000000FF,&H00131921,&H99000000,-1,0,0,0,100,100,4,0,1,2,1,5,38,38,70,1
Style: Small,Microsoft YaHei,25,&H00A2B2BF,&H000000FF,&H00131921,&H99000000,0,0,0,0,100,100,2,0,1,1,0,5,38,38,70,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''
events=[]
def caption(start,end,style,text): events.append((start,end,style,text))
caption(0,5.8,'Title',r'{\fad(700,700)\pos(360,525)}'+SPEC.get('series_title', SPEC.get('title', '')))
caption(.8,5.8,'Small',r'{\fad(700,700)\pos(360,620)}'+SPEC.get('episode_title', ''))
for i,scene in enumerate(SPEC['scenes']):
    caption(bounds[i]+.25,bounds[i]+4.5,'Chapter',r'{\fad(200,450)}'+scene['id']+' / '+scene['title'])
for cue in timeline:
    units=[]; chunk=''
    for phrase in [u for u in re.split(r'(?<=[，。！？：])',cue['text']) if u]:
        if len(chunk)+len(phrase)>30 and chunk: units.append(chunk);chunk=''
        while len(phrase)>30:
            if chunk: units.append(chunk);chunk=''
            units.append(phrase[:30]);phrase=phrase[30:]
        chunk+=phrase
    if chunk:units.append(chunk)
    weights=[len(u) for u in units];pos=cue['start']
    for u,w in zip(units,weights):
        length=cue['duration']*w/sum(weights)
        prefix='' if cue['role']=='旁白' else cue['role']+'：'
        text=prefix+u
        if len(text)>19:
            # Two short lines remain inside portrait safe margins.
            split=min(range(max(5,len(text)//2-5),min(len(text)-4,len(text)//2+6)),key=lambda j:abs(j-len(text)/2)+(0 if text[j-1] in '，：' else 4))
            text=text[:split]+r'\N'+text[split:]
        caption(pos,pos+length,'Body',r'{\fad(65,70)}'+text);pos+=length
caption(355,360,'Title',r'{\fad(600,700)\pos(360,650)}未完待续')

for i,segment in enumerate(segments):
    dst=R/f'segment-{i:02}.mp4'; ass=R/f'captions-{i:02}.ass';start=segment['start'];end=start+segment['duration']
    lines=[]
    for a0,a1,style,text in events:
        if a0<end and a1>start:lines.append(f'Dialogue: 0,{stamp(max(a0,start)-start)},{stamp(min(a1,end)-start)},{style},,0,0,0,,{text}')
    ass.write_text(HEADER+'\n'.join(lines)+'\n',encoding='utf-8')
    state(done=i,total=len(segments),stage=f'合成场景 {segment["scene"]} · 第 {i+1}/{len(segments)} 段')
    if dst.exists():continue
    duration=segment['duration'];num=round(duration*FPS)
    if segment['kind']=='native':
        src=sorted(D.glob('clip-'+segment['scene']+'_*.mp4'))[-1]
        args=['-i',src];vf=f'trim=duration={duration},setpts=PTS-STARTPTS,fps={FPS},scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1'
    else:
        src=sorted(D.glob('panel-'+segment['scene']+segment['panel']+'_*.png'))[-1]
        direction=1 if i%2 else -1
        zoom=f'1.015+0.055*on/{max(1,num-1)}' if direction>0 else f'1.07-0.055*on/{max(1,num-1)}'
        vf=f"scale=1440:2560:force_original_aspect_ratio=increase,crop=1440:2560,zoompan=z='{zoom}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d={num}:s={W}x{H}:fps={FPS},setsar=1"
        args=['-i',src]
    vf+=f",drawbox=x=0:y=ih-180:w=iw:h=180:color=black@0.22:t=fill,ass=filename='{ass.name}'"
    if i==0:vf+=',fade=t=in:st=0:d=0.5'
    if i==len(segments)-1:vf+=f',fade=t=out:st={duration-1.0}:d=1.0'
    ff([*args,'-vf',vf,'-frames:v',num,'-an','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-threads','4',dst])

(R/'segments.txt').write_text(''.join(f"file 'segment-{i:02}.mp4'\n" for i in range(len(segments))),encoding='utf-8')
state(done=len(segments),total=len(segments),stage='导出完整六分钟第一集')
ff(['-f','concat','-safe','1','-i','segments.txt','-i','master.wav','-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-t',TOTAL,'-movflags','+faststart',TARGET])
with av.open(str(TARGET)) as c:
    v=c.streams.video[0]; duration=float(c.duration/av.time_base)
    assert (v.width,v.height)==(W,H) and abs(duration-TOTAL)<.2 and len(c.streams.audio)>0
    verification={'seconds':duration,'width':W,'height':H,'fps':float(v.average_rate),'edition':edition,'native_video_seconds':0 if a.illustrated_only else sum(s.get('native_seconds',15) for s in SPEC['scenes']),'comic_motion_seconds':TOTAL if a.illustrated_only else TOTAL-sum(s.get('native_seconds',15) for s in SPEC['scenes']),'voice_speed':speed,'voices':len(timeline),'scenes':6,'status':'verified'}
(D/('illustrated-timeline.json' if a.illustrated_only else 'timeline.json')).write_text(json.dumps({'bounds':bounds,'cues':timeline,'segments':segments,'verification':verification},ensure_ascii=False,indent=2),encoding='utf-8')
(D/('illustrated-verification.json' if a.illustrated_only else 'verification.json')).write_text(json.dumps(verification,ensure_ascii=False,indent=2),encoding='utf-8')
state(done=len(segments),total=len(segments),stage='成片已完成并通过时长与音轨检查')
print(json.dumps(verification,ensure_ascii=False),flush=True)
