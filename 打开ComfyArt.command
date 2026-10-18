#!/bin/sh
set -eu
cd "$(dirname "$0")"
python3 deploy/remote.py deploy/start-agent.ps1
python3 deploy/remote.py deploy/start.ps1
if ! lsof -nP -iTCP:8188 -sTCP:LISTEN >/dev/null 2>&1; then
  ssh -fN -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -L 127.0.0.1:8188:127.0.0.1:8188 5090
fi
attempt=0
while [ "$attempt" -lt 60 ]; do
  if curl --fail --silent --max-time 2 --output /dev/null 'http://127.0.0.1:8188/comfyart/'; then
    open 'http://127.0.0.1:8188/comfyart/'
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 1
done
echo 'ComfyArt 尚未启动完成，请查看 F:\ComfyArt\logs\comfyui.err.log'
exit 1
