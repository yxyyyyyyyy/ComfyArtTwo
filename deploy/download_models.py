"""Download only the three official Z-Image artifacts, with resume and SHA256."""
import concurrent.futures
import hashlib
import json
import os
import threading
import time
from pathlib import Path

import requests

SESSION = requests.Session()
SESSION.trust_env = False
SESSION.mount("https://", requests.adapters.HTTPAdapter(pool_connections=32, pool_maxsize=32))

ROOT = Path(os.getenv("COMFYART_DOWNLOAD_ROOT", r"F:\ComfyArt"))
DOWNLOAD_CACHE = Path(os.getenv("COMFYART_DOWNLOAD_CACHE", r"D:\ComfyArt-download-cache"))
ENDPOINT = os.getenv("HF_ENDPOINT", "https://hf-mirror.com")
REPO = "Comfy-Org/z_image_turbo"
FILES = ["diffusion_models/z_image_turbo_bf16.safetensors",
         "text_encoders/qwen_3_4b.safetensors", "vae/ae.safetensors"]


def download(name, revision, metadata, mirror, *, destination=None):
    target = Path(destination) if destination is not None else ROOT / "ComfyUI" / "models" / name
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(target.suffix + ".part")
    expected = metadata["lfs"]["sha256"]
    size = metadata["lfs"]["size"]
    if mirror and (mirror["Sha256"] != expected or mirror["Size"] != size):
        raise RuntimeError(f"Mirror artifact does not match official SHA256: {name}")
    if not target.exists():
        chunks = DOWNLOAD_CACHE / (target.name + ".chunks")
        chunks.mkdir(parents=True, exist_ok=True)
        chunk_size = 32 * 1024 * 1024
        count = (size + chunk_size - 1) // chunk_size
        lock = threading.Lock()
        progress = {"last": 0, "bytes": 0}

        def fetch(index):
            start = index * chunk_size
            end = min(size, start + chunk_size) - 1
            saved = chunks / str(index)
            if saved.exists() and saved.stat().st_size == end - start + 1:
                return saved
            temp = saved.with_suffix(".tmp")
            for attempt in range(8):
                try:
                    if metadata.get("url"):
                        url = metadata["url"]
                    elif mirror:
                        url = f"https://modelscope.cn/models/{REPO}/resolve/{mirror['Revision']}/{mirror['Path']}"
                    else:
                        url = f"{ENDPOINT}/{REPO}/resolve/{revision}/{metadata['rfilename']}"
                    with SESSION.get(url, headers={"Range": f"bytes={start}-{end}"}, stream=True, timeout=(30, 120)) as response:
                        response.raise_for_status()
                        if response.status_code != 206 or not response.headers.get("Content-Range", "").startswith(f"bytes {start}-{end}/"):
                            raise RuntimeError("Invalid Content-Range")
                        with temp.open("wb") as output:
                            for block in response.iter_content(1024 * 1024):
                                output.write(block)
                    if temp.stat().st_size != end - start + 1:
                        raise RuntimeError("Incomplete chunk")
                    temp.replace(saved)
                    with lock:
                        progress["bytes"] += end - start + 1
                        if time.monotonic() - progress["last"] > 20:
                            print(f"{name}: downloaded {progress['bytes']/1e9:.2f}/{size/1e9:.2f} GB this run", flush=True)
                            progress["last"] = time.monotonic()
                    return saved
                except (requests.RequestException, RuntimeError) as error:
                    print(f"Retry {name} chunk {index}, attempt {attempt+1}: {type(error).__name__}", flush=True)
                    if attempt == 7:
                        raise
                    time.sleep(2 + attempt)

        with concurrent.futures.ThreadPoolExecutor(max_workers=int(os.getenv("COMFYART_DOWNLOAD_WORKERS", "4"))) as pool:
            parts = list(pool.map(fetch, range(count)))
        with partial.open("wb") as output:
            for part in parts:
                with part.open("rb") as source:
                    while block := source.read(8 * 1024 * 1024):
                        output.write(block)
        source = partial
    else:
        source = target
    with source.open("rb") as data:
        hasher = hashlib.sha256()
        while block := data.read(8 * 1024 * 1024):
            hasher.update(block)
        digest = hasher.hexdigest()
    if digest != expected:
        raise RuntimeError(f"SHA256 mismatch: {name}")
    if source == partial:
        partial.replace(target)
        for part in chunks.iterdir():
            part.unlink()
        chunks.rmdir()
    print(f"Verified {name}: {digest}", flush=True)
    return {"path": name, "bytes": size, "sha256": digest, "repository": REPO, "revision": revision,
            "download_mirror": "modelscope.cn" if mirror else metadata.get("url", ENDPOINT),
            "mirror_revision": mirror["Revision"] if mirror else revision}


if __name__ == "__main__":
    (ROOT / "artifacts").mkdir(parents=True, exist_ok=True)
    response = SESSION.get(f"{ENDPOINT}/api/models/{REPO}?blobs=true", timeout=45)
    response.raise_for_status()
    info = response.json()
    metadata = {item["rfilename"]: item for item in info["siblings"]}
    response = SESSION.get(f"https://www.modelscope.cn/api/v1/models/{REPO}/repo/files?Revision=master&Recursive=true", timeout=45)
    response.raise_for_status()
    mirror = {item["Path"]: item for item in response.json()["Data"]["Files"]}
    print(f"Repository {REPO} pinned at {info['sha']}", flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        jobs = [pool.submit(download, name, info["sha"], metadata["split_files/" + name], mirror["split_files/" + name]) for name in FILES]
        results = [job.result() for job in jobs]
    (ROOT / "artifacts" / "models-verified.json").write_text(json.dumps(results, indent=2))
    print("All Z-Image Turbo files verified", flush=True)
