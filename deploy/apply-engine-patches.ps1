$ErrorActionPreference = 'Stop'
$root = 'F:\ComfyArt'
& 'C:\Program Files\Python312\python.exe' "$root\ComfyUI\custom_nodes\ComfyArt\deploy\apply-engine-patches.py" "$root\ComfyUI"
if ($LASTEXITCODE -ne 0) { throw 'Engine patch failed; source does not match the pinned baseline' }
