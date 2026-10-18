#!/usr/bin/env python3
"""Run a checked-in PowerShell script on the registered Windows GPU host."""
import argparse
import base64
import subprocess
import sys
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("script", type=Path)
parser.add_argument("--host", default="5090")
args = parser.parse_args()
prefix = "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new();\n"
encoded = base64.b64encode((prefix + args.script.read_text()).encode("utf-16le")).decode()
sys.exit(subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", args.host,
                        "powershell -NoProfile -NonInteractive -EncodedCommand " + encoded]).returncode)
