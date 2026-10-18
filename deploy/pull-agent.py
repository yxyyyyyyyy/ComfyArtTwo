import json
import time
import requests

last = 0
with requests.post('http://127.0.0.1:11435/api/pull', json={'model': 'qwen3-vl:4b-instruct'}, stream=True, timeout=(10, 600)) as response:
    response.raise_for_status()
    for line in response.iter_lines():
        if not line:
            continue
        event = json.loads(line)
        if event.get('error'):
            raise RuntimeError(event['error'])
        if time.monotonic() - last > 20 or event.get('status') == 'success':
            print(json.dumps(event), flush=True)
            last = time.monotonic()
