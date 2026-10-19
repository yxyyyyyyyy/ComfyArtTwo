"""Build a verified optional SSD cache; keep original model files and runtime on F:."""
import argparse
import hashlib
import json
import shutil
from pathlib import Path

FILES = {
    'diffusion_models': ['minimax_h3_fl2va_pruned_int8_convrot.safetensors'],
    'text_encoders': ['qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors'],
    'vae': ['minimax_h3_video_vae_fp16.safetensors', 'minimax_h3_audio_vae_fp32.safetensors'],
    'loras': ['minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors'],
}


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(16 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--models', type=Path, default=Path(r'F:\ComfyArt\ComfyUI\models'))
    p.add_argument('--cache', type=Path, required=True)
    p.add_argument('--config', type=Path, default=Path(r'F:\ComfyArt\comfyart-video-cache.yaml'))
    a = p.parse_args()
    sources = [(kind, a.models / kind / name) for kind, names in FILES.items() for name in names]
    for _, source in sources:
        if not source.is_file(): raise SystemExit(f'Missing source: {source}')
    a.cache.mkdir(parents=True, exist_ok=True)
    manifest_path = a.cache / 'manifest.json'
    old = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    needed = sum(source.stat().st_size for kind, source in sources if not (a.cache / kind / source.name).exists())
    if shutil.disk_usage(a.cache).free < needed + (10 << 30): raise SystemExit('Insufficient SSD space with 10 GiB headroom')
    manifest = {}
    for kind, source in sources:
        key = f'{kind}/{source.name}'; destination = a.cache / key
        destination.parent.mkdir(parents=True, exist_ok=True)
        stat = source.stat(); previous = old.get(key, {})
        if destination.exists() and not previous:
            raise RuntimeError('Refusing to replace an unmanaged cache file: ' + str(destination))
        if destination.is_file() and destination.stat().st_size == stat.st_size and previous.get('mtime_ns') == stat.st_mtime_ns and previous.get('sha256') == digest(destination):
            manifest[key] = previous; print('VERIFIED CACHE', key, flush=True); continue
        tmp = destination.with_suffix('.part'); h = hashlib.sha256(); count = 0; next_log = 1 << 30
        print('COPY', key, stat.st_size, 'bytes', flush=True)
        with source.open('rb') as src, tmp.open('wb') as dst:
            for chunk in iter(lambda: src.read(16 << 20), b''):
                dst.write(chunk); h.update(chunk); count += len(chunk)
                if count >= next_log:
                    print('PROGRESS', key, count, '/', stat.st_size, flush=True); next_log += 1 << 30
        checksum = h.hexdigest()
        if digest(tmp) != checksum: raise RuntimeError('Cache checksum mismatch: ' + key)
        tmp.replace(destination)
        manifest[key] = {'bytes': count, 'mtime_ns': stat.st_mtime_ns, 'sha256': checksum}
        manifest_path.write_text(json.dumps({**old, **manifest}, indent=2), encoding='utf-8')
        print('VERIFIED COPY', key, checksum, flush=True)
    # JSON is valid YAML, and escaping Windows paths is handled by the serializer.
    a.config.write_text(json.dumps({'comfyart_video_cache': {'base_path': str(a.cache), 'is_default': True, **{kind: kind for kind in FILES}}}, indent=2), encoding='utf-8')
    print('READY', str(a.config), 'Original models retained on F:', flush=True)


if __name__ == '__main__': main()
