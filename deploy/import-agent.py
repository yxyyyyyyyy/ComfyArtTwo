"""Import SHA256-verified official Ollama blobs into the isolated F-drive service."""
import subprocess
from pathlib import Path
from transfer import upload

root = Path('/tmp/comfyart-agent-model')
assert (root / '4b-instruct').is_file(), 'Complete deploy/download_agent.py first'
subprocess.run(['python3', 'deploy/remote.py', 'deploy/stop-agent.ps1'], check=True)
subprocess.run(['python3', 'deploy/remote.py', 'deploy/import-agent.ps1'], check=True)
for path in root.glob('sha256-*'):
    destination = 'F:/ComfyArt/ollama/models/blobs/' + path.name
    upload(path, destination)
subprocess.run(['scp', str(root / '4b-instruct'), '5090:F:/ComfyArt/ollama/models/manifests/registry.ollama.ai/library/qwen3-vl/4b-instruct'], check=True)
subprocess.run(['python3', 'deploy/remote.py', 'deploy/verify-agent.ps1'], check=True)
subprocess.run(['python3', 'deploy/remote.py', 'deploy/start-agent.ps1'], check=True)
print('Imported official Qwen3-VL model and started isolated local agent')
