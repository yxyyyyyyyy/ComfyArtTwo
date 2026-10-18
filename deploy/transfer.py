"""Transfer large models in resumable chunks, then verify and assemble on Windows."""
import base64
import concurrent.futures
import hashlib
import json
import subprocess
import tempfile
import time
from pathlib import Path

CHUNK = 32 * 1024 * 1024


def upload(source: Path, destination: str):
    if source.stat().st_size <= 100 * 1024 * 1024:
        subprocess.run(['scp', str(source), '5090:' + destination], check=True)
        return
    hasher = hashlib.sha256()
    with source.open('rb') as data:
        while block := data.read(8 * 1024 * 1024):
            hasher.update(block)
    digest = hasher.hexdigest()
    remote_dir = 'D:/ComfyArt-upload-cache/' + digest
    escaped = destination.replace("'", "''")
    original_cache = ('D:/ComfyArt-download-cache/' + source.name + '.chunks').replace("'", "''")
    script = f"""$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'
New-Item -ItemType Directory -Force '{remote_dir}' | Out-Null
if (Test-Path '{original_cache}') {{
    Get-ChildItem '{original_cache}' -File | Where-Object {{$_.Name -match '^\\d+$'}} | ForEach-Object {{
        $index = [long]$_.Name
        $expected = [math]::Min([long]{CHUNK}, [long]{source.stat().st_size} - $index * {CHUNK})
        $link = Join-Path '{remote_dir}' $_.Name
        if ($_.Length -eq $expected -and !(Test-Path $link)) {{ New-Item -ItemType HardLink -Path $link -Value $_.FullName | Out-Null }}
    }}
}}
$length=0; if (Test-Path '{escaped}') {{$length=(Get-Item '{escaped}').Length}}
$parts = @(Get-ChildItem '{remote_dir}' -File | Where-Object {{$_.Name -match '^\\d+$' -and $_.Length -eq [math]::Min([long]{CHUNK}, [long]{source.stat().st_size} - [long]$_.Name * {CHUNK})}} | ForEach-Object {{[int]$_.Name}})
@{{size=$length;parts=$parts}} | ConvertTo-Json -Compress
"""
    encoded = base64.b64encode(script.encode('utf-16le')).decode()
    prepared = subprocess.run(['ssh', '5090', 'powershell -NoProfile -EncodedCommand ' + encoded], text=True, capture_output=True)
    if prepared.returncode:
        raise RuntimeError('Remote upload preparation failed: ' + prepared.stderr[-2500:])
    state = json.loads(prepared.stdout.strip())
    size = state['size']
    prefix = min(size // CHUNK * CHUNK, source.stat().st_size // CHUNK * CHUNK)
    count = (source.stat().st_size + CHUNK - 1) // CHUNK
    first = prefix // CHUNK
    pending = [index for index in range(first, count) if index not in state['parts']]
    print(f'{source.name}: reuse {len(state["parts"])} cached chunks and {prefix/1e9:.2f} GB prefix; upload {len(pending)} chunks', flush=True)
    with tempfile.TemporaryDirectory(prefix='comfyart-upload-') as directory:
        cache = Path(directory)

        def send(index):
            part = cache / str(index)
            with source.open('rb') as data:
                data.seek(index * CHUNK)
                part.write_bytes(data.read(CHUNK))
            for attempt in range(4):
                result = subprocess.run(['scp', '-c', 'aes128-gcm@openssh.com', '-o', 'ServerAliveInterval=15',
                                         '-o', 'ServerAliveCountMax=3', str(part), f'5090:{remote_dir}/{index}'])
                if result.returncode == 0:
                    part.unlink()
                    return index
                time.sleep(2)
            raise RuntimeError(f'Upload failed: chunk {index}')

        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            for done, _ in enumerate(pool.map(send, pending), 1):
                if done % 8 == 0 or done == len(pending):
                    print(f'{source.name}: {done}/{len(pending)} upload chunks complete', flush=True)
        manifest = {'destination': destination, 'sha256': digest, 'size': source.stat().st_size,
                    'chunk_size': CHUNK, 'prefix': prefix, 'count': count, 'directory': remote_dir}
        path = cache / 'upload.json'
        path.write_text(json.dumps(manifest))
        remote_manifest = f'F:/ComfyArt/cache/upload-{digest}.json'
        subprocess.run(['scp', str(path), '5090:' + remote_manifest], check=True)
        subprocess.run(['scp', str(Path(__file__).with_name('assemble_upload.py')), '5090:F:/ComfyArt/scripts/assemble_upload.py'], check=True)
        subprocess.run(['ssh', '5090', 'python F:/ComfyArt/scripts/assemble_upload.py ' + remote_manifest], check=True)
