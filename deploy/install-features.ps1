param([string[]]$Features = @('cutout', 'upscale', 'qwen-edit', 'erase', 'angles'))
$ErrorActionPreference = 'Stop'
$root = 'F:\ComfyArt'
$env:HF_ENDPOINT = 'https://hf-mirror.com'
$env:PYTHONUNBUFFERED = '1'
$env:COMFYART_DOWNLOAD_WORKERS = '8'
& "$root\.venv\Scripts\python.exe" -u "$root\scripts\install-features.py" @Features 1> "$root\logs\features.log" 2> "$root\logs\features.err.log"
exit $LASTEXITCODE
