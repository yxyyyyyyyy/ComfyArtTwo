$root = 'F:\ComfyArt'
$installers = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'python.exe' -and $_.CommandLine -match 'F:\\ComfyArt\\scripts\\(install-features|download-runtime|download_models)\.py'
}
if ($installers) { throw 'Wait for ComfyArt model installation to finish before replacing deployment scripts' }
if (Get-NetTCPConnection -LocalPort 8188 -State Listen -ErrorAction SilentlyContinue) {
    $queue = Invoke-RestMethod http://127.0.0.1:8188/queue -TimeoutSec 10
    if ($queue.queue_running.Count -or $queue.queue_pending.Count) { throw 'Wait for the ComfyArt generation queue to finish before updating' }
}
& "$root\scripts\stop.ps1"
Expand-Archive -Force "$root\source.zip" "$root\ComfyUI\custom_nodes\ComfyArt"
& "$root\ComfyUI\custom_nodes\ComfyArt\deploy\apply-engine-patches.ps1"
Copy-Item "$root\ComfyUI\custom_nodes\ComfyArt\deploy\*.ps1" "$root\scripts" -Force
Copy-Item "$root\ComfyUI\custom_nodes\ComfyArt\deploy\download_models.py", "$root\ComfyUI\custom_nodes\ComfyArt\deploy\download-video-lora.py", "$root\ComfyUI\custom_nodes\ComfyArt\deploy\pull-agent.py" "$root\scripts" -Force
Copy-Item "$root\ComfyUI\custom_nodes\ComfyArt\deploy\install-features.py", "$root\ComfyUI\custom_nodes\ComfyArt\deploy\feature-models.json" "$root\scripts" -Force
Copy-Item "$root\ComfyUI\custom_nodes\ComfyArt\deploy\download-runtime.py", "$root\ComfyUI\custom_nodes\ComfyArt\deploy\runtime-wheels.json" "$root\scripts" -Force
& "$root\scripts\start.ps1"
