$root = 'F:\ComfyArt'
New-Item -ItemType Directory -Force $root, "$root\logs", "$root\cache", "$root\artifacts", "$root\scripts" | Out-Null
if (!(Test-Path "$root\ComfyUI\main.py")) {
    git clone --no-hardlinks D:\ComfyUI "$root\ComfyUI"
    if ($LASTEXITCODE -ne 0) { throw 'ComfyUI clone failed' }
    git -C "$root\ComfyUI" checkout --detach 14b05228cef127ce529bc0c08660770d4af3e9a8
    if ($LASTEXITCODE -ne 0) { throw 'Pinned ComfyUI commit is unavailable' }
}
New-Item -ItemType Directory -Force "$root\ComfyUI\custom_nodes\ComfyArt" | Out-Null
Expand-Archive -Force "$root\source.zip" "$root\ComfyUI\custom_nodes\ComfyArt"
Copy-Item "$root\ComfyUI\custom_nodes\ComfyArt\deploy\*.ps1" "$root\scripts" -Force
Copy-Item "$root\ComfyUI\custom_nodes\ComfyArt\deploy\download_models.py", "$root\ComfyUI\custom_nodes\ComfyArt\deploy\pull-agent.py", "$root\ComfyUI\custom_nodes\ComfyArt\deploy\download-video-lora.py" "$root\scripts" -Force
if (!(Test-Path "$root\.venv\Scripts\python.exe")) {
    & 'C:\Program Files\Python312\python.exe' -m venv --system-site-packages "$root\.venv"
    if ($LASTEXITCODE -ne 0) { throw 'venv failed' }
}
$env:HF_HOME = "$root\cache\huggingface"
$env:PIP_CACHE_DIR = "$root\cache\pip"
$python = "$root\.venv\Scripts\python.exe"
& $python -m pip install -r "$root\ComfyUI\requirements.txt" -r "$root\ComfyUI\custom_nodes\ComfyArt\requirements.txt" --disable-pip-version-check --index-url https://pypi.tuna.tsinghua.edu.cn/simple
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed' }
& $python -m pip freeze | Set-Content -Encoding UTF8 "$root\artifacts\requirements-resolved.txt"
git -C "$root\ComfyUI" rev-parse HEAD | Set-Content -Encoding UTF8 "$root\artifacts\comfyui-commit.txt"
