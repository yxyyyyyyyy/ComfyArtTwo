$root = 'F:\ComfyArt'
& "$root\scripts\stop.ps1"
Expand-Archive -Force "$root\source.zip" "$root\ComfyUI\custom_nodes\ComfyArt"
Copy-Item "$root\ComfyUI\custom_nodes\ComfyArt\deploy\*.ps1" "$root\scripts" -Force
Copy-Item "$root\ComfyUI\custom_nodes\ComfyArt\deploy\download_models.py", "$root\ComfyUI\custom_nodes\ComfyArt\deploy\download-video-lora.py", "$root\ComfyUI\custom_nodes\ComfyArt\deploy\pull-agent.py" "$root\scripts" -Force
& "$root\scripts\start.ps1"
