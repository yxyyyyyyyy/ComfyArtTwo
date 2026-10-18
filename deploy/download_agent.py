"""Fetch the official Ollama vision model on Mac and verify every content digest."""
import concurrent.futures
import hashlib
import json
import time
from pathlib import Path

import requests

ROOT = Path('/tmp/comfyart-agent-model')
REPO = 'library/qwen3-vl'
TAG = '4b-instruct'
REGISTRY = 'https://registry.ollama.ai/v2/'
ROOT.mkdir(exist_ok=True)
response = requests.get(f'{REGISTRY}{REPO}/manifests/{TAG}', timeout=30)
response.raise_for_status()
manifest = response.json()


def fetch_blob(item):
    digest = item['digest'].split(':')[1]
    target = ROOT / ('sha256-' + digest)
    if not target.exists():
        url = f'{REGISTRY}{REPO}/blobs/sha256:{digest}'
        if item['size'] < 1024 * 1024:
            response = requests.get(url, timeout=60)
            response.raise_for_status()
            target.write_bytes(response.content)
        else:
            chunks = ROOT / (digest + '.chunks')
            chunks.mkdir(exist_ok=True)
            chunk_size = 16 * 1024 * 1024
            count = (item['size'] + chunk_size - 1) // chunk_size

            def fetch(index):
                start = index * chunk_size
                end = min(item['size'], start + chunk_size) - 1
                saved = chunks / str(index)
                if saved.exists() and saved.stat().st_size == end - start + 1:
                    return saved
                for attempt in range(6):
                    try:
                        with requests.get(url, headers={'Range': f'bytes={start}-{end}'}, stream=True, timeout=(20, 90)) as response:
                            response.raise_for_status()
                            if response.status_code != 206 or not response.headers.get('Content-Range', '').startswith(f'bytes {start}-{end}/'):
                                raise RuntimeError('Invalid Content-Range')
                            with saved.with_suffix('.tmp').open('wb') as output:
                                for block in response.iter_content(1024 * 1024):
                                    output.write(block)
                        saved.with_suffix('.tmp').replace(saved)
                        if saved.stat().st_size != end - start + 1:
                            raise RuntimeError('Incomplete chunk')
                        return saved
                    except (requests.RequestException, RuntimeError):
                        if attempt == 5:
                            raise
                        time.sleep(2)

            with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
                parts = []
                last = 0
                for part in pool.map(fetch, range(count)):
                    parts.append(part)
                    if time.monotonic() - last > 20:
                        print(f'Qwen3-VL: {len(parts)*chunk_size/1e9:.2f}/{item["size"]/1e9:.2f} GB', flush=True)
                        last = time.monotonic()
            with target.open('wb') as output:
                for part in parts:
                    output.write(part.read_bytes())
            for part in chunks.iterdir():
                part.unlink()
            chunks.rmdir()
    hasher = hashlib.sha256()
    with target.open('rb') as source:
        while block := source.read(8 * 1024 * 1024):
            hasher.update(block)
    if hasher.hexdigest() != digest or target.stat().st_size != item['size']:
        raise RuntimeError('Ollama blob failed SHA256/size verification: ' + digest)
    print('Verified ' + target.name, flush=True)


for item in {item['digest']: item for item in [manifest['config'], *manifest['layers']]}.values():
    fetch_blob(item)
(ROOT / TAG).write_text(json.dumps(manifest))
print('Official Ollama manifest and blobs verified', flush=True)
