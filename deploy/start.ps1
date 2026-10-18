$root = 'F:\ComfyArt'
$port = 8188
$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($listener) {
    $ownerProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener[0].OwningProcess)"
    $live = Get-Process -Id $listener[0].OwningProcess -ErrorAction SilentlyContinue
    if ($live -and !$live.HasExited) {
        if ($ownerProcess.CommandLine -notlike '*F:\ComfyArt*') { throw "Port $port belongs to another service" }
        $response = Invoke-WebRequest "http://127.0.0.1:$port/comfyart/" -UseBasicParsing -TimeoutSec 5
        if ($response.StatusCode -ne 200) { throw 'Existing ComfyArt process is not ready' }
        Write-Output "ComfyArt already running on $port"
        exit 0
    }
}
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File F:\ComfyArt\scripts\serve.ps1' -WorkingDirectory "$root\ComfyUI"
$principal = New-ScheduledTaskPrincipal -UserId 'Administrator' -LogonType S4U -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'ComfyArt-Server' -Action $action -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName 'ComfyArt-Server'
Write-Output 'Starting ComfyArt background task'
for ($attempt=0; $attempt -lt 60; $attempt++) {
    try {
        $response = Invoke-WebRequest "http://127.0.0.1:$port/comfyart/" -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -eq 200) {
            Write-Output "ComfyArt ready at http://127.0.0.1:$port/comfyart/"
            exit 0
        }
    } catch { Start-Sleep -Seconds 1 }
}
throw 'ComfyArt did not become ready; inspect F:\ComfyArt\logs\comfyui.err.log'
