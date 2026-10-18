$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = 'F:\ComfyArt'
$task = Get-ScheduledTask -TaskName 'ComfyArt-Features' -ErrorAction SilentlyContinue
if ($task -and $task.State -eq 'Running') {
    Write-Output 'Feature installation is already running; its resume cache is preserved'
    exit 0
}
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File F:\ComfyArt\scripts\install-features.ps1'
$principal = New-ScheduledTaskPrincipal -UserId 'Administrator' -LogonType S4U -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'ComfyArt-Features' -Action $action -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName 'ComfyArt-Features'
Write-Output "Started resumable feature installation; logs: $root\logs\features.log"
