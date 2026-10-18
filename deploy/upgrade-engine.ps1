$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = 'F:\ComfyArt'
$engine = "$root\ComfyUI"
$revision = '98cc0bf84b7cb1383654c5b402e7612d875d6d22'
$bundle = "$root\comfyart-engine-041.bundle"
if (Test-Path $bundle) {
    git -C $engine fetch $bundle refs/tags/v0.41.0
} else {
    git -C $engine fetch https://github.com/Comfy-Org/ComfyUI.git tag v0.41.0 --depth=1
}
if ($LASTEXITCODE -ne 0) { throw 'Cannot import pinned engine bundle' }
& "$root\scripts\stop.ps1"
git -C $engine checkout --detach $revision
if ($LASTEXITCODE -ne 0) { throw 'Cannot check out pinned engine' }
& "$root\ComfyUI\custom_nodes\ComfyArt\deploy\apply-engine-patches.ps1"
$env:PIP_CACHE_DIR = "$root\cache\pip"
& "$root\.venv\Scripts\python.exe" -m pip install -r "$engine\requirements.txt" --index-url https://pypi.tuna.tsinghua.edu.cn/simple --disable-pip-version-check
if ($LASTEXITCODE -ne 0) {
    & "$root\.venv\Scripts\python.exe" -m pip install -r "$engine\requirements.txt" --index-url https://pypi.org/simple --disable-pip-version-check
}
if ($LASTEXITCODE -ne 0) { throw 'Engine dependency installation failed' }
$inpaint = "$engine\custom_nodes\comfyui-inpaint-nodes"
New-Item -ItemType Directory -Force $inpaint | Out-Null
tar -xzf "$root\inpaint-source.tar.gz" -C $inpaint
if ($LASTEXITCODE -ne 0) { throw 'Inpaint node extraction failed' }
& "$root\.venv\Scripts\python.exe" -m pip freeze | Set-Content -Encoding UTF8 "$root\artifacts\requirements-resolved.txt"
git -C $engine rev-parse HEAD | Set-Content -Encoding UTF8 "$root\artifacts\comfyui-commit.txt"
& "$root\scripts\start.ps1"
