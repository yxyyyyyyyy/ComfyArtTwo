"""Copy verified models downloaded on Mac to F without touching user projects."""
import json
import subprocess
from pathlib import Path
from transfer import upload

root = Path('/tmp/comfyart-models')
report = root / 'artifacts' / 'models-verified.json'
assert report.is_file(), 'Complete deploy/download_models.py first'
subprocess.run(['python3', 'deploy/remote.py', 'deploy/pause-downloads.ps1'], check=True)
for item in json.loads(report.read_text()):
    source = root / 'ComfyUI' / 'models' / item['path']
    upload(source, 'F:/ComfyArt/ComfyUI/models/' + item['path'])
subprocess.run(['scp', str(report), '5090:F:/ComfyArt/artifacts/models-verified.json'], check=True)
print('Verified official Z-Image artifacts imported to F drive')
