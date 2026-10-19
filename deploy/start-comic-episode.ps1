param(
    [ValidatePattern('^[a-z0-9][a-z0-9-]{0,63}$')][string]$Id = 'cellar-episode-01',
    [ValidateSet('images','all')][string]$Phase = 'all',
    [switch]$RegisterOnly
)
$root = 'F:\ComfyArt'
$source = "$root\ComfyUI\custom_nodes\ComfyArt"
$spec = "$source\productions\$Id\episode.json"
if (!(Test-Path $spec)) { throw 'Production specification not found' }
$dir = "$root\ComfyUI\output\comfyart\$Id"
New-Item -ItemType Directory -Force $dir | Out-Null
$name = "ComfyArt-Episode-$Id"
$existing = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
if ($existing.State -eq 'Running' -and !$RegisterOnly) { throw 'This episode is already running' }
$arguments = '-u "' + $source + '\deploy\render-comic-episode.py" --spec "' + $spec + '" --output "' + $dir + '" --phase ' + $Phase
$action = New-ScheduledTaskAction -Execute "$root\.venv\Scripts\python.exe" -Argument $arguments -WorkingDirectory $source
if ($existing) {
    Set-ScheduledTask -TaskName $name -Action $action | Out-Null
} else {
    $principal = New-ScheduledTaskPrincipal -UserId Administrator -LogonType S4U -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $name -Action $action -Principal $principal -Settings $settings | Out-Null
}
if (!$RegisterOnly) { Start-ScheduledTask -TaskName $name }
Write-Output "Episode task configured: $Id / $Phase"
