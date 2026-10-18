import json
import os
from pathlib import Path

if os.name != 'nt':
    os.environ.setdefault('COMFYART_DOWNLOAD_ROOT', '/tmp/comfyart-video-models')
    os.environ.setdefault('COMFYART_DOWNLOAD_CACHE', '/tmp/comfyart-video-chunks')
os.environ.setdefault('COMFYART_DOWNLOAD_WORKERS', '8')
import download_models as download

download.REPO = 'Comfy-Org/MiniMax-H3'
path = 'loras/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors'
response = download.SESSION.get(f'{download.ENDPOINT}/api/models/{download.REPO}?blobs=true', timeout=45)
response.raise_for_status()
official = response.json()
metadata = next(item for item in official['siblings'] if item['rfilename'] == path)
response = download.SESSION.get(f'https://www.modelscope.cn/api/v1/models/{download.REPO}/repo/files?Revision=master&Recursive=true', timeout=45)
response.raise_for_status()
mirror = next(item for item in response.json()['Data']['Files'] if item['Path'] == path)
record = download.download(path, official['sha'], metadata, mirror)
artifact = download.ROOT / 'artifacts'
artifact.mkdir(parents=True, exist_ok=True)
(artifact / 'video-lora-verified.json').write_text(json.dumps(record, indent=2))
print('MiniMax H3 video LoRA verified', flush=True)
