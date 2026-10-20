param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-z0-9][a-z0-9-]{0,63}$')][string]$Id,
    [string]$Root = 'F:\ComfyArt',
    [switch]$RegisterOnly
)
$source = "$Root\ComfyUI\custom_nodes\ComfyArt"
if (!(Test-Path "$source\productions\$Id\episode.json")) { throw 'Local film specification not found' }
New-Item -ItemType Directory -Force "$Root\ComfyUI\output\comfyart\$Id" | Out-Null
$name = "ComfyArt-Episode-$Id"
$existing = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
if ($existing.State -eq 'Running') { throw 'This film is already running' }
$arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $source + '\deploy\run-directed-film.ps1" -Id ' + $Id + ' -Root "' + $Root + '"'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $source
$principal = New-ScheduledTaskPrincipal -UserId Administrator -LogonType S4U -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $name -Action $action -Principal $principal -Settings $settings -Force | Out-Null
if (!$RegisterOnly) { Start-ScheduledTask -TaskName $name }
Write-Output "Native film task configured: $Id"
