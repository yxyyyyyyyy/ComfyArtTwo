"""Apply the pinned, narrow engine fix without resetting unrelated source edits."""
import argparse
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("engine", type=Path)
args = parser.parse_args()
patch = Path(__file__).resolve().parent / "patches" / "disable-direct-file-transfer.patch"
command = ["git", "-C", str(args.engine), "apply"]
already = subprocess.run(command + ["--reverse", "--check", str(patch)], capture_output=True)
if already.returncode == 0:
    print("Engine file-transfer patch is already applied")
else:
    subprocess.run(command + ["--check", str(patch)], check=True)
    subprocess.run(command + [str(patch)], check=True)
    print("Applied --disable-fast-disk guard for direct aimdo file transfers")
