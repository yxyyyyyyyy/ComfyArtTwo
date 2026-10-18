"""Mac fallback when the GPU host cannot receive the official PyTorch CDN body."""
import concurrent.futures
import hashlib
import json
import subprocess
import time
from pathlib import Path

from transfer import CHUNK, upload

root = Path(__file__).resolve().parents[1]
cache = Path("/tmp/comfyart-runtime")
cache.mkdir(exist_ok=True)
catalog = json.loads((root / "deploy" / "runtime-wheels.json").read_text())
for wheel in catalog:
    target = cache / wheel["name"]
    chunks = cache / (wheel["name"] + ".chunks")
    chunks.mkdir(exist_ok=True)
    count = (wheel["size"] + CHUNK - 1) // CHUNK

    def fetch(index):
        start, end = index * CHUNK, min((index + 1) * CHUNK, wheel["size"]) - 1
        saved = chunks / str(index)
        if saved.exists() and saved.stat().st_size == end - start + 1:
            return saved
        temp = saved.with_suffix(".tmp")
        headers = saved.with_suffix(".headers")
        subprocess.run(["curl", "--fail", "--location", "--silent", "--show-error", "--retry", "4", "--retry-all-errors",
                        "--max-time", "180", "--range", f"{start}-{end}", "--dump-header", str(headers),
                        wheel["url"], "-o", str(temp)], check=True)
        if f"content-range: bytes {start}-{end}/" not in headers.read_text().lower():
            raise RuntimeError("CDN returned the wrong byte range")
        if temp.stat().st_size != end - start + 1:
            raise RuntimeError("Incomplete runtime chunk")
        temp.replace(saved)
        headers.unlink()
        return saved

    if not target.exists():
        started = time.monotonic()
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            jobs = [pool.submit(fetch, i) for i in range(count)]
            for number, job in enumerate(concurrent.futures.as_completed(jobs), 1):
                job.result()
                if number % 8 == 0 or number == count:
                    print(f"{wheel['name']}: {number}/{count} chunks, {time.monotonic()-started:.0f}s", flush=True)
        with target.open("wb") as output:
            for i in range(count):
                with (chunks / str(i)).open("rb") as source:
                    while block := source.read(8 * 1024 * 1024):
                        output.write(block)
    hasher = hashlib.sha256()
    with target.open("rb") as source:
        while block := source.read(8 * 1024 * 1024):
            hasher.update(block)
    if hasher.hexdigest() != wheel["sha256"] or target.stat().st_size != wheel["size"]:
        raise RuntimeError("Official runtime SHA256 mismatch: " + wheel["name"])
    upload(target, "F:/ComfyArt/cache/runtime-wheels/" + wheel["name"])
    print("Verified and transferred " + wheel["name"], flush=True)
