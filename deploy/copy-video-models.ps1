$source = 'D:\ComfyUI\models'
$target = 'F:\ComfyArt\ComfyUI\models'
$models = @(
    'diffusion_models\minimax_h3_fl2va_pruned_int8_convrot.safetensors',
    'text_encoders\qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
    'vae\minimax_h3_video_vae_fp16.safetensors',
    'vae\minimax_h3_audio_vae_fp32.safetensors'
)
foreach ($model in $models) {
    $from = Join-Path $source $model
    $to = Join-Path $target $model
    New-Item -ItemType Directory -Force (Split-Path $to) | Out-Null
    if (!(Test-Path $to) -or (Get-Item $to).Length -ne (Get-Item $from).Length) {
        Copy-Item $from $to -Force
    }
    Write-Output "Copied $model"
}
