$python = 'F:\ComfyArt\.venv\Scripts\python.exe'
& $python -m pip install pytest pytest-asyncio --index-url https://pypi.tuna.tsinghua.edu.cn/simple --disable-pip-version-check
if ($LASTEXITCODE -ne 0) { throw 'Test dependency installation failed' }
Set-Location F:\ComfyArt\ComfyUI\custom_nodes\ComfyArt
& $python -m pytest -q tests
if ($LASTEXITCODE -ne 0) { throw 'ComfyArt tests failed' }
& $python -m pip freeze | Set-Content -Encoding UTF8 F:\ComfyArt\artifacts\requirements-resolved.txt
