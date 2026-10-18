$root = 'F:\ComfyArt'
New-Item -ItemType Directory -Force "$root\ollama\models" | Out-Null
if (Get-NetTCPConnection -State Listen -LocalPort 11435 -ErrorAction SilentlyContinue) {
    Write-Output 'ComfyArt local agent endpoint is already running'
    exit 0
}
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File F:\ComfyArt\scripts\serve-agent.ps1'
$principal = New-ScheduledTaskPrincipal -UserId 'Administrator' -LogonType S4U -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName 'ComfyArt-Agent' -Action $action -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName 'ComfyArt-Agent'
for ($attempt=0; $attempt -lt 30; $attempt++) {
    try {
        $response = Invoke-WebRequest http://127.0.0.1:11435/api/tags -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -eq 200) {
            Write-Output 'Started independent local agent endpoint on 11435'
            exit 0
        }
    } catch { Start-Sleep -Seconds 1 }
}
throw 'Local agent endpoint did not become ready; inspect F:\ComfyArt\logs\ollama.err.log'
