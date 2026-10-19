$ErrorActionPreference='Stop'
$root='F:\ComfyArt\speech'
New-Item -ItemType Directory -Force -Path $root,"$root\models","$root\output" | Out-Null
$py="$root\.venv\Scripts\python.exe"
if (!(Test-Path $py)) { & 'F:\ComfyArt\.venv\Scripts\python.exe' -m venv "$root\.venv" }
if ($LASTEXITCODE) { throw 'Speech venv creation failed' }
# Reuse the existing CUDA 13 Torch installation; speech dependencies remain isolated.
Set-Content -Encoding ascii -Path "$root\.venv\Lib\site-packages\comfyart-runtime.pth" -Value 'F:\ComfyArt\.venv\Lib\site-packages'
$env:HF_HOME="$root\cache"
$env:MODELSCOPE_CACHE="$root\modelscope-cache"
$env:PIP_CACHE_DIR="$root\pip-cache"
& 'F:\ComfyArt\.venv\Scripts\python.exe' 'F:\ComfyArt\scripts\install-speech-runtime.py'
if ($LASTEXITCODE) { throw 'Speech dependencies failed; see speech install logs' }
$ErrorActionPreference='Continue'
& $py -c "import torch,qwen_tts,transformers; print('Speech runtime:',torch.__version__,transformers.__version__)"
$code=$LASTEXITCODE
$ErrorActionPreference='Stop'
if ($code) {throw 'Speech import check failed'}
