param(
    [ValidatePattern('^[a-z0-9][a-z0-9-]{0,63}$')][string]$Id = 'cellar-episode-01',
    [ValidateSet('images','all')][string]$Phase = 'all'
)
$source = 'F:\ComfyArt\ComfyUI\custom_nodes\ComfyArt'
$output = "F:\ComfyArt\ComfyUI\output\comfyart\$Id"
$env:PYTHONUTF8 = '1'
$env:PYTHONFAULTHANDLER = '1'
$env:OPENBLAS_NUM_THREADS = '1'
$env:OMP_NUM_THREADS = '4'
$env:MKL_NUM_THREADS = '4'
$env:NUMEXPR_NUM_THREADS = '1'
& 'F:\ComfyArt\.venv\Scripts\python.exe' -u "$source\deploy\render-comic-episode.py" --spec "$source\productions\$Id\episode.json" --output $output --phase $Phase 1>> "$output\worker.out.log" 2>> "$output\worker.err.log"
$workerExit = $LASTEXITCODE
$progress = "$output\progress.json"
if ($workerExit -ne 0 -and (Test-Path $progress)) {
    $state = Get-Content $progress -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($state.status -notin @('done','error','paused')) {
        $state.status = 'error'
        $state.stage = 'Worker stopped; completed assets were retained.'
        $state | Add-Member -Force -NotePropertyName error -NotePropertyValue "Production process exited ($workerExit). See worker.err.log; completed assets can be resumed."
        $state.heartbeat = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() / 1000.0
        $json = $state | ConvertTo-Json -Depth 100
        [IO.File]::WriteAllText("$progress.tmp", $json, [Text.UTF8Encoding]::new($false))
        Move-Item -Force "$progress.tmp" $progress
    }
}
exit $workerExit
