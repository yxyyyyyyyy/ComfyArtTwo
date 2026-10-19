$root = 'F:\ComfyArt'
$env:HF_HOME = "$root\cache\huggingface"
$env:TORCH_HOME = "$root\cache\torch"
$env:HF_HUB_DISABLE_TELEMETRY = '1'
$env:PYTHONUTF8 = '1'
$env:PYTHONUNBUFFERED = '1'
Set-Location "$root\ComfyUI"
$videoCacheArgs = @()
if (Test-Path "$root\comfyart-video-cache.yaml") { $videoCacheArgs = @('--extra-model-paths-config', "$root\comfyart-video-cache.yaml") }
& "$root\.venv\Scripts\python.exe" -u "$root\ComfyUI\main.py" @videoCacheArgs --listen 127.0.0.1 --port 8188 --reserve-vram 4 --disable-fast-disk --disable-pinned-memory --disable-async-offload --disable-cuda-malloc --cache-none --disable-auto-launch --disable-api-nodes 1> "$root\logs\comfyui.out.log" 2> "$root\logs\comfyui.err.log"
exit $LASTEXITCODE
