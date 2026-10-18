$root = 'F:\ComfyArt'
Stop-ScheduledTask -TaskName 'ComfyArt-Server' -ErrorAction SilentlyContinue
$processes = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'python.exe' -and $_.CommandLine -like '*F:\ComfyArt\ComfyUI\main.py*'
}
foreach ($process in $processes) {
    $live = Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
    if (!$live) { continue }
    Stop-Process -InputObject $live -Force
    if (!$live.WaitForExit(60000)) { throw "ComfyArt PID $($process.ProcessId) has not exited; do not start a duplicate server" }
    Write-Output "Stopped ComfyArt PID $($process.ProcessId)"
}
