"""Generate a cue-aligned Chinese voice track with the verified local checkpoint."""
import argparse,json,os,time
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--story',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--model',type=Path,default=Path(r'F:\ComfyArt\speech\models\Qwen3-TTS-12Hz-1.7B-CustomVoice'));p.add_argument('--only',nargs='*');a=p.parse_args()
os.environ.setdefault('HF_HUB_OFFLINE','1');os.environ.setdefault('TRANSFORMERS_OFFLINE','1')
for key,value in {'OPENBLAS_NUM_THREADS':'1','OMP_NUM_THREADS':'4','MKL_NUM_THREADS':'4','NUMEXPR_NUM_THREADS':'1','TOKENIZERS_PARALLELISM':'false'}.items():os.environ[key]=value
import numpy as np
import soundfile as sf
a.output.mkdir(parents=True,exist_ok=True)
story=json.loads(a.story.read_text(encoding='utf-8'));cues=[v for v in story['narration'] if not a.only or v['id'] in a.only]
model=None
previous_path=a.output/'voice-manifest.json'
previous={r['id']:r for r in json.loads(previous_path.read_text(encoding='utf-8'))} if previous_path.exists() else {}
records=[];started=time.time()
for cue in cues:
 path=a.output/('voice-'+cue['id']+'.wav');t=time.time()
 old=previous.get(cue['id'],{})
 reuse=path.exists() and old.get('text')==cue['text'] and old.get('instruct')==cue['tone'] and old.get('speaker','').lower()==cue.get('speaker','Uncle_Fu').lower() and old.get('language','Chinese')==cue.get('language','Chinese')
 if not reuse:
  if model is None:
   import torch
   from qwen_tts import Qwen3TTSModel
   torch.set_num_threads(4)
   print('Loading local Qwen3-TTS CustomVoice with PyTorch SDPA',flush=True)
   model=Qwen3TTSModel.from_pretrained(str(a.model),device_map='cuda:0',dtype=torch.bfloat16,attn_implementation='sdpa')
   print('Speakers',model.get_supported_speakers(),flush=True)
  torch.manual_seed(20261020+int(cue['id']))
  with torch.inference_mode():
   wavs,sr=model.generate_custom_voice(text=cue['text'],language=cue.get('language','Chinese'),speaker=cue.get('speaker','Uncle_Fu'),instruct=cue['tone'],max_new_tokens=1024,do_sample=True,temperature=0.7,top_p=0.9,repetition_penalty=1.05)
  wav=np.asarray(wavs[0],dtype=np.float32);sf.write(path,wav,sr,subtype='PCM_16')
 wav,sr=sf.read(path);duration=len(wav)/sr
 if not 1<duration<45 or float(np.max(np.abs(wav)))<0.01:raise RuntimeError(f'Invalid voice duration/energy: {cue["id"]} {duration}')
 records.append({'id':cue['id'],'text':cue['text'],'instruct':cue['tone'],'speaker':cue.get('speaker','Uncle_Fu'),'role':cue.get('role','旁白'),'language':cue.get('language','Chinese'),'path':str(path),'sample_rate':sr,'duration':round(duration,4),'seconds':round(time.time()-t,2)})
 (a.output/'voice-manifest.json').write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf-8')
 print('VOICE DONE',cue['id'],round(duration,2),'sec',flush=True)
print('ALL VOICES DONE',round(time.time()-started,2),'seconds, audio duration',sum(x['duration'] for x in records),flush=True)
