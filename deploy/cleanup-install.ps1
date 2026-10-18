$root = 'F:\ComfyArt'
foreach ($required in @('models-verified.json','agent-verified.json','video-lora-verified.json')) {
    if (!(Test-Path "$root\artifacts\$required")) { throw "Missing verification record: $required" }
}
$queue = Invoke-RestMethod http://127.0.0.1:8188/queue
if ($queue.queue_running.Count -or $queue.queue_pending.Count) { throw 'Wait for the ComfyArt queue to finish before cleanup' }
Stop-ScheduledTask -TaskName 'ComfyArt-Models' -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName 'ComfyArt-Models' -Confirm:$false -ErrorAction SilentlyContinue
foreach ($directory in @('D:\ComfyArt-download-cache','D:\ComfyArt-upload-cache')) {
    if (Test-Path $directory) { Remove-Item $directory -Recurse -Force }
}
foreach ($relative in @(
    'scripts\accelerate-install.ps1', 'scripts\move-download-cache.ps1', 'scripts\probe.ps1',
    'scripts\install-templates.ps1', 'scripts\comfyui_pread.py', 'scripts\apply-pread.ps1',
    'scripts\unload-agent.ps1', 'scripts\restore-engine.ps1',
    'ComfyUI\custom_nodes\ComfyArt\README.local.md',
    'artifacts\transfer-check.tar.gz','artifacts\transfer-check-legacy.tar.gz','requirements-runtime.txt',
    'ComfyUI\models\diffusion_models\z_image_turbo_bf16.safetensors.part',
    'ComfyUI\models\text_encoders\qwen_3_4b.safetensors.part',
    'ComfyUI\models\vae\ae.safetensors.part'
)) {
    $path = Join-Path $root $relative
    if (Test-Path $path) { Remove-Item $path -Force }
}
Write-Output 'Removed only temporary ComfyArt installation files; models and user projects remain on F'
