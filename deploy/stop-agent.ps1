$listener = Get-NetTCPConnection -State Listen -LocalPort 11435 -ErrorAction SilentlyContinue
Stop-ScheduledTask -TaskName 'ComfyArt-Agent' -ErrorAction SilentlyContinue
if ($listener) { Stop-Process -Id $listener[0].OwningProcess -ErrorAction SilentlyContinue }
