$env:HF_ENDPOINT = 'https://hf-mirror.com'
$env:PYTHONUNBUFFERED = '1'
$env:COMFYART_DOWNLOAD_WORKERS = '8'
& 'C:\Program Files\Python312\python.exe' -u F:\ComfyArt\scripts\download_models.py 1> F:\ComfyArt\logs\download.log 2> F:\ComfyArt\logs\download.err.log
exit $LASTEXITCODE
