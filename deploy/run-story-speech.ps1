$ErrorActionPreference='Stop'
$root='F:\ComfyArt\speech'
$out="$root\output\story-v2"
New-Item -ItemType Directory -Force -Path $out | Out-Null
$env:PYTHONIOENCODING='utf-8'
$env:HF_HOME="$root\cache"
$env:HF_HUB_OFFLINE='1'
$env:TRANSFORMERS_OFFLINE='1'
Write-Output 'Starting offline Chinese narration on the RTX 5090'
$command="$root\.venv\Scripts\python.exe -u F:\ComfyArt\scripts\story-speech.py --story F:\ComfyArt\scripts\story.json --output $out 1>$out\generation.log 2>&1"
& cmd.exe /d /c $command
if ($LASTEXITCODE) { Get-Content "$out\generation.log" -Tail 24; throw 'Narration generation failed' }
Write-Output 'Offline narration completed'
