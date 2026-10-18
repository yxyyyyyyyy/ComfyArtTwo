"""Fetch official, hash-pinned CUDA 13 wheels into the F-drive runtime cache."""
import json
from pathlib import Path

import download_models as downloader

downloader.REPO = "pytorch"
catalog = json.loads(Path(__file__).with_name("runtime-wheels.json").read_text())
verified = []
for wheel in catalog:
    path = downloader.ROOT / "cache" / "runtime-wheels" / wheel["name"]
    metadata = {"rfilename": wheel["name"], "url": wheel["url"],
                "lfs": {"sha256": wheel["sha256"], "size": wheel["size"]}}
    verified.append(downloader.download(wheel["name"], "cu130", metadata, None, destination=path))
report = downloader.ROOT / "artifacts" / "runtime-wheels-verified.json"
report.write_text(json.dumps(verified, indent=2), encoding="utf-8")
