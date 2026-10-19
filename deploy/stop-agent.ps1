$listener = Get-NetTCPConnection -State Listen -LocalPort 11435 -ErrorAction SilentlyContinue
if ($listener) {
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener[0].OwningProcess)"
    if ($owner -and $owner.CommandLine -notmatch 'ollama(?:\.exe)?[" ]+serve') { throw 'Port 11435 belongs to another service' }
}
Stop-ScheduledTask -TaskName 'ComfyArt-Agent' -ErrorAction SilentlyContinue
if ($listener) {
    $live = Get-Process -Id $listener[0].OwningProcess -ErrorAction SilentlyContinue
    if ($live) {
        Stop-Process -InputObject $live -Force
        if (!$live.WaitForExit(30000)) { throw 'ComfyArt Agent did not stop; do not start a duplicate' }
    }
}
