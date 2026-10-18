$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = 'F:\ComfyArt'
$queue = Invoke-RestMethod http://127.0.0.1:8188/queue
if ($queue.queue_running.Count -or $queue.queue_pending.Count) { throw 'Wait for the ComfyArt queue to become idle before upgrading' }
$catalog = Get-Content "$root\scripts\runtime-wheels.json" -Raw | ConvertFrom-Json
$wheels = @($catalog | ForEach-Object {
    $path = Join-Path "$root\cache\runtime-wheels" $_.name
    if (!(Test-Path $path)) { throw "Missing wheel: $path" }
    if ((Get-FileHash $path -Algorithm SHA256).Hash.ToLower() -ne $_.sha256) { throw "Invalid wheel: $path" }
    $path
})
& "$root\scripts\stop.ps1"
& "$root\.venv\Scripts\python.exe" -m pip install --no-deps @wheels --disable-pip-version-check
if ($LASTEXITCODE -ne 0) { throw 'CUDA runtime installation failed' }
& "$root\.venv\Scripts\python.exe" -m pip check
if ($LASTEXITCODE -ne 0) { throw 'CUDA runtime dependency check failed' }
& "$root\.venv\Scripts\python.exe" -c "import torch, torchvision, torchaudio; print(torch.__version__, torch.version.cuda, torch.cuda.get_device_name(0)); assert torch.version.cuda == '13.0'; assert torch.cuda.is_available()"
if ($LASTEXITCODE -ne 0) { throw 'CUDA 13 GPU check failed' }
$catalog | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 "$root\artifacts\runtime-wheels-verified.json"
& "$root\.venv\Scripts\python.exe" -m pip freeze | Set-Content -Encoding UTF8 "$root\artifacts\requirements-resolved.txt"
& "$root\scripts\start.ps1"
