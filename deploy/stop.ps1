$root = 'F:\ComfyArt'
Stop-ScheduledTask -TaskName 'ComfyArt-Server' -ErrorAction SilentlyContinue
$processes = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'python.exe' -and $_.CommandLine -like '*F:\ComfyArt\ComfyUI\main.py*'
}
foreach ($process in $processes) {
    Stop-Process -Id $process.ProcessId
    Write-Output "Stopped ComfyArt PID $($process.ProcessId)"
}
