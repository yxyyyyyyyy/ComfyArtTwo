"""Check the real service through the Mac SSH tunnel; optionally generate an image."""
import argparse
import json
import time
import uuid
from pathlib import Path

import requests

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://127.0.0.1:8188")
parser.add_argument("--generate", action="store_true")
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
artifacts = root / "artifacts"
artifacts.mkdir(exist_ok=True)
base = args.url.rstrip("/")


def api(method, path, **kwargs):
    response = requests.request(method, base + path, timeout=180, **kwargs)
    response.raise_for_status()
    return response.json()


report = {"base_url": base}
page = requests.get(base + "/comfyart/", timeout=30)
page.raise_for_status()
assert '<div id="root">' in page.text
report["page"] = page.status_code
report["system"] = api("GET", "/system_stats")
report["projects_before"] = len(api("GET", "/comfyart/projects")["projects"])
pid = "deployment-check-" + uuid.uuid4().hex
snapshot = {"deployment_check": True}
try:
    api("PUT", "/comfyart/projects/" + pid, json={"name": "Deployment check", "snapshot": snapshot})
    assert api("GET", "/comfyart/projects/" + pid) == snapshot
    report["project_persistence"] = "passed"
finally:
    api("DELETE", "/comfyart/projects/" + pid)

settings = {"enable-mcp": True, "enable-bot": True, "bot-provider": "local-llm",
            "bot-local-llm-url": "http://127.0.0.1:11435/v1", "bot-model-local-llm": "qwen3-vl:4b-instruct"}
report["agent_settings"] = api("PUT", "/comfyart/settings", json=settings)
tools = api("POST", "/comfyart/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
report["mcp_tools"] = len(tools["result"]["tools"])
report["agent_reply"] = api("POST", "/comfyart/bot/complete", json={"text": "请只回复：本地设计助手已就绪"})
print("HTTP, project persistence, MCP and local agent checks passed", flush=True)

if args.generate:
    workflow = json.loads((root / "workflows" / "z-image-turbo-t2i.api.json").read_text())
    workflow["5"]["inputs"].update(width=768, height=768)
    workflow["6"]["inputs"]["text"] = "A beautiful professional product photograph of a white ceramic coffee cup on a warm oak table, soft morning sunlight, green leaves, minimalist composition, realistic texture, no text, no watermark"
    workflow["7"]["inputs"]["seed"] = 509018
    workflow["9"]["inputs"]["filename_prefix"] = "comfyart/deployment-smoke"
    started = time.monotonic()
    submitted = api("POST", "/prompt", json={"prompt": workflow, "client_id": "comfyart-deployment-check"})
    prompt_id = submitted["prompt_id"]
    print("GPU image generation queued: " + prompt_id, flush=True)
    while time.monotonic() - started < 1200:
        history = api("GET", "/history/" + prompt_id)
        if prompt_id in history:
            entry = history[prompt_id]
            report["generation"] = entry
            report["generation_seconds"] = round(time.monotonic() - started, 2)
            (artifacts / "smoke-report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False))
            if entry["status"]["status_str"] != "success":
                raise RuntimeError(json.dumps(entry["status"], ensure_ascii=False))
            image = entry["outputs"]["9"]["images"][0]
            response = requests.get(base + "/view", params=image, timeout=60)
            response.raise_for_status()
            (artifacts / "5090-first-image.png").write_bytes(response.content)
            print(f"GPU image generated in {report['generation_seconds']} seconds", flush=True)
            break
        print(f"GPU job running ({time.monotonic()-started:.0f}s)", flush=True)
        time.sleep(15)
    else:
        raise TimeoutError("GPU generation exceeded 20 minutes")

(artifacts / "smoke-report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False))
