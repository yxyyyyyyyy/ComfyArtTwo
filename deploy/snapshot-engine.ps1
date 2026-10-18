git -C F:\ComfyArt\ComfyUI archive --format=tar.gz -o F:\ComfyArt\artifacts\comfyui-source.tar.gz HEAD
if ($LASTEXITCODE -ne 0) { throw 'Engine source archive failed' }
