param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-z0-9][a-z0-9-]{0,63}$')][string]$Id,
    [string]$Root = 'F:\ComfyArt'
)
$source = "$Root\ComfyUI\custom_nodes\ComfyArt"
$output = "$Root\ComfyUI\output\comfyart\$Id"
New-Item -ItemType Directory -Force $output | Out-Null
$env:PYTHONUTF8 = '1'
$env:PYTHONUNBUFFERED = '1'
$env:OPENBLAS_NUM_THREADS = '1'
$env:OMP_NUM_THREADS = '4'
$env:MKL_NUM_THREADS = '4'
$env:COMFYART_SPEECH_ROOT = "$Root\speech"
& "$Root\.venv\Scripts\python.exe" -u "$source\deploy\render-directed-film.py" --spec "$source\productions\$Id\episode.json" --output $output 1>> "$output\worker.out.log" 2>> "$output\worker.err.log"
exit $LASTEXITCODE
