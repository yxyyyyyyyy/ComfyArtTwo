"""Install only the headless TTS runtime; capture native stderr without PowerShell 5 traps."""
import subprocess,sys
from pathlib import Path
root=Path(r'F:\ComfyArt\speech');py=root/'.venv/Scripts/python.exe'
steps=[
 ['qwen-tts==0.1.1','transformers==4.57.3','accelerate==1.12.0','--no-deps'],
 ['huggingface-hub>=0.34,<1','tokenizers>=0.22,<0.23','numpy>=1.26,<2.4','librosa>=0.11,<0.12','soundfile','sox','einops','onnxruntime','psutil','safetensors','packaging','pyyaml']
]
with (root/'install-headless.log').open('w',encoding='utf-8') as log:
 for args in steps:
  r=subprocess.run([str(py),'-m','pip','install',*args],stdout=log,stderr=subprocess.STDOUT)
  log.flush()
  if r.returncode:sys.exit(r.returncode)
print('Headless Qwen TTS dependencies installed',flush=True)
