$root = 'F:\ComfyArt'
New-Item -ItemType Directory -Force $root, "$root\logs", "$root\cache", "$root\artifacts", "$root\scripts" | Out-Null
if (!(Test-Path "$root\ComfyUI\main.py")) {
    git clone --no-hardlinks D:\ComfyUI "$root\ComfyUI"
    if ($LASTEXITCODE -ne 0) { throw 'ComfyUI clone failed' }
    git -C "$root\ComfyUI" fetch https://github.com/Comfy-Org/ComfyUI.git tag v0.41.0 --depth=1
    if ($LASTEXITCODE -ne 0) { throw 'Pinned ComfyUI release fetch failed' }
    git -C "$root\ComfyUI" checkout --detach 98cc0bf84b7cb1383654c5b402e7612d875d6d22
    if ($LASTEXITCODE -ne 0) { throw 'Pinned ComfyUI commit is unavailable' }
}
New-Item -ItemType Directory -Force "$root\ComfyUI\custom_nodes\ComfyArt" | Out-Null
Expand-Archive -Force "$root\source.zip" "$root\ComfyUI\custom_nodes\ComfyArt"
& "$root\ComfyUI\custom_nodes\ComfyArt\deploy\apply-engine-patches.ps1"
Copy-Item "$root\ComfyUI\custom_nodes\ComfyArt\deploy\*.ps1" "$root\scripts" -Force
Copy-Item "$root\ComfyUI\custom_nodes\ComfyArt\deploy\download_models.py", "$root\ComfyUI\custom_nodes\ComfyArt\deploy\pull-agent.py", "$root\ComfyUI\custom_nodes\ComfyArt\deploy\download-video-lora.py" "$root\scripts" -Force
Copy-Item "$root\ComfyUI\custom_nodes\ComfyArt\deploy\install-features.py", "$root\ComfyUI\custom_nodes\ComfyArt\deploy\feature-models.json" "$root\scripts" -Force
Copy-Item "$root\ComfyUI\custom_nodes\ComfyArt\deploy\download-runtime.py", "$root\ComfyUI\custom_nodes\ComfyArt\deploy\runtime-wheels.json" "$root\scripts" -Force
New-Item -ItemType Directory -Force "$root\ComfyUI\custom_nodes\comfyui-inpaint-nodes" | Out-Null
tar -xzf "$root\inpaint-source.tar.gz" -C "$root\ComfyUI\custom_nodes\comfyui-inpaint-nodes"
if ($LASTEXITCODE -ne 0) { throw 'Inpaint node extraction failed' }
if (!(Test-Path "$root\.venv\Scripts\python.exe")) {
    & 'C:\Program Files\Python312\python.exe' -m venv --system-site-packages "$root\.venv"
    if ($LASTEXITCODE -ne 0) { throw 'venv failed' }
}
$env:HF_HOME = "$root\cache\huggingface"
$env:PIP_CACHE_DIR = "$root\cache\pip"
$python = "$root\.venv\Scripts\python.exe"
& $python -m pip install -r "$root\ComfyUI\requirements.txt" -r "$root\ComfyUI\custom_nodes\ComfyArt\requirements.txt" --disable-pip-version-check --index-url https://pypi.tuna.tsinghua.edu.cn/simple
if ($LASTEXITCODE -ne 0) {
    & $python -m pip install -r "$root\ComfyUI\requirements.txt" -r "$root\ComfyUI\custom_nodes\ComfyArt\requirements.txt" --disable-pip-version-check --index-url https://pypi.org/simple
}
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed' }
& $python -m pip freeze | Set-Content -Encoding UTF8 "$root\artifacts\requirements-resolved.txt"
git -C "$root\ComfyUI" rev-parse HEAD | Set-Content -Encoding UTF8 "$root\artifacts\comfyui-commit.txt"
