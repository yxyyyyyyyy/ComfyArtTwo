"""Fetch the pinned official Qwen3-TTS checkpoint with verified mirror hashes."""
import hashlib,json,os,time
from pathlib import Path
os.environ.setdefault('COMFYART_DOWNLOAD_WORKERS','2')
import download_models as download
# Large checkpoint downloads and GPU model initialization can exceed Windows commit limits.
try:
    queue=download.SESSION.get('http://127.0.0.1:8188/queue',timeout=5).json()
except (download.requests.RequestException,ValueError):
    queue={}
if queue.get('queue_running') or queue.get('queue_pending'):
    raise RuntimeError('Wait for the ComfyUI GPU queue to become idle before installing speech models')
manifest=json.loads(Path(__file__).with_name('speech-model.json').read_text())
download.REPO=manifest['repository']
root=download.ROOT/'speech';target=root/'models'/'Qwen3-TTS-12Hz-1.7B-CustomVoice'
records=[]
for f in manifest['files']:
 meta,mirror=f['metadata'],f['mirror'];name=meta['rfilename'];p=target/name;p.parent.mkdir(parents=True,exist_ok=True)
 if meta.get('lfs'):
  records.append(download.download(name,manifest['revision'],meta,mirror,destination=p));continue
 url=f"https://modelscope.cn/models/{download.REPO}/resolve/{mirror['Revision']}/{name}"
 if not p.exists():
  for i in range(4):
   try:r=download.SESSION.get(url,timeout=60);r.raise_for_status();data=r.content;break
   except Exception:
    if i==3:raise
    time.sleep(2+i)
 else:data=p.read_bytes()
 assert len(data)==mirror['Size'],name
 sha=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
 assert sha==meta['blobId'],f'Git blob mismatch: {name}'
 p.write_bytes(data);print('Verified',name,flush=True)
 records.append({'path':name,'bytes':len(data),'git_blob':sha,'repository':manifest['repository'],'revision':manifest['revision']})
(root/'model-verified.json').write_text(json.dumps(records,indent=2))
print('Qwen3-TTS checkpoint verified on F:',flush=True)
