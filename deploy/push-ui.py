#!/usr/bin/env python3
"""Publish built static UI without restarting ComfyUI or touching projects/models."""
import base64
import subprocess
import tempfile
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
dist = root / 'dist'
if not (dist / 'index.html').is_file():
    raise SystemExit('Run npm run build before publishing the UI')
with tempfile.TemporaryDirectory() as temp:
    archive = Path(temp) / 'ui.zip'
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as bundle:
        for path in dist.rglob('*'):
            if path.is_file():
                bundle.write(path, path.relative_to(dist))
    subprocess.run(['scp', str(archive), '5090:F:/ComfyArt/ui.zip'], check=True)
    script = r'''
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$target = 'F:\ComfyArt\ComfyUI\custom_nodes\ComfyArt\dist'
$staging = 'F:\ComfyArt\ui-staging'
$backup = 'F:\ComfyArt\ui-index-backups'
New-Item -ItemType Directory -Force $staging,$backup | Out-Null
Expand-Archive -Force 'F:\ComfyArt\ui.zip' $staging
if (!(Test-Path "$staging\index.html")) { throw 'Missing built index' }
if (Test-Path "$target\index.html") {
    Copy-Item "$target\index.html" "$backup\index-$(Get-Date -Format yyyyMMdd-HHmmss).html"
}
# Keep older hashed chunks available for already-open tabs. Publish the index last.
Get-ChildItem $staging | Where-Object { $_.Name -ne 'index.html' } | ForEach-Object {
    Copy-Item $_.FullName $target -Recurse -Force
}
Copy-Item "$staging\index.html" "$target\index.next.html" -Force
Move-Item "$target\index.next.html" "$target\index.html" -Force
Write-Output 'Static UI published; services, projects and models preserved.'
'''
    command = 'powershell -NoProfile -EncodedCommand ' + base64.b64encode(script.encode('utf-16le')).decode()
    subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '5090', command], check=True)
