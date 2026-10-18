$root = 'F:\ComfyArt'
$digest = '16b83be682148a4d8201dbf720ea7eace5de98b69f63f05e0c908b4d7977ecb5'
$file = "$root\ollama\models\blobs\sha256-$digest"
$actual = (Get-FileHash $file -Algorithm SHA256).Hash.ToLower()
if ($actual -ne $digest) { throw 'Remote Qwen3-VL SHA256 mismatch' }
@{model='qwen3-vl:4b-instruct';sha256=$actual;path=$file} | ConvertTo-Json | Set-Content -Encoding UTF8 "$root\artifacts\agent-verified.json"
Write-Output 'Remote Qwen3-VL SHA256 verified'
