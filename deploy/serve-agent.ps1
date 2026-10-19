$root = 'F:\ComfyArt'
$env:OLLAMA_HOST = '127.0.0.1:11435'
$env:OLLAMA_MODELS = "$root\ollama\models"
$env:OLLAMA_NUM_PARALLEL = '1'
$env:OLLAMA_MAX_LOADED_MODELS = '1'
$env:OLLAMA_CONTEXT_LENGTH = '16384'
$env:OLLAMA_KEEP_ALIVE = '30s'
$env:OLLAMA_NO_CLOUD = '1'
& 'C:\Users\Administrator\AppData\Local\Programs\Ollama\ollama.exe' serve 1> "$root\logs\ollama.out.log" 2> "$root\logs\ollama.err.log"
exit $LASTEXITCODE
