#!/usr/bin/env python3
"""Package Mac source and upload it without remote models, data or secrets."""
import base64
import subprocess
import tempfile
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
skip = {".git", "node_modules", "__pycache__", ".pytest_cache", ".venv", "artifacts", "engine"}
with tempfile.TemporaryDirectory() as directory:
    archive = Path(directory) / "source.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
        for path in root.rglob("*"):
            if path.is_file() and not skip.intersection(path.relative_to(root).parts):
                if path.name == ".env" or path.name.startswith(".env.") or path.suffix == ".pyc":
                    continue
                bundle.write(path, path.relative_to(root))
    command = "$ProgressPreference='SilentlyContinue'; New-Item -ItemType Directory -Force F:\\ComfyArt | Out-Null"
    encoded = base64.b64encode(command.encode("utf-16le")).decode()
    subprocess.run(["ssh", "5090", "powershell -NoProfile -EncodedCommand " + encoded], check=True)
    subprocess.run(["scp", str(archive), "5090:F:/ComfyArt/source.zip"], check=True)
    print(f"Uploaded {archive.stat().st_size:,} bytes to F:\\ComfyArt\\source.zip")
