Stop-ScheduledTask -TaskName 'ComfyArt-Models'
Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'python.exe' -and $_.CommandLine -like '*F:\ComfyArt\scripts\download_models.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId }
Start-ScheduledTask -TaskName 'ComfyArt-Models'
