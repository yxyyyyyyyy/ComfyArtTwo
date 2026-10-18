Stop-ScheduledTask -TaskName 'ComfyArt-Models' -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'python.exe' -and ($_.CommandLine -like '*F:\ComfyArt\scripts\download_models.py*' -or $_.CommandLine -like '*F:\ComfyArt\scripts\pull-agent.py*')
} | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
