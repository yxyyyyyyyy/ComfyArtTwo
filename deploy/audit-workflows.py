"""Compare every bundled workflow with the running engine and model registry."""
import argparse
import json
from pathlib import Path

import requests

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://127.0.0.1:8188")
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
response = requests.get(args.url.rstrip("/") + "/object_info", timeout=60)
response.raise_for_status()
registry = response.json()
report = {}
for path in sorted((root / "workflows").glob("*.api.json")):
    missing_nodes, missing_models = set(), set()
    workflow = json.loads(path.read_text())
    for node in workflow.values():
        kind = node["class_type"]
        if kind not in registry:
            missing_nodes.add(kind)
            continue
        schemas = registry[kind].get("input", {})
        fields = {**schemas.get("required", {}), **schemas.get("optional", {})}
        for key, value in node.get("inputs", {}).items():
            if not isinstance(value, str) or key not in fields:
                continue
            if not value.endswith((".safetensors", ".pth", ".pt", ".ckpt", ".bin", ".onnx")):
                continue
            schema = fields[key]
            options = schema[0] if isinstance(schema[0], list) else schema[1].get("options", []) if schema[0] == "COMBO" else None
            if options is not None and value not in options:
                missing_models.add(value)
    report[path.name] = {"ready": not missing_nodes and not missing_models,
                         "missing_nodes": sorted(missing_nodes), "missing_models": sorted(missing_models)}
output = root / "artifacts" / "workflow-readiness.json"
output.parent.mkdir(exist_ok=True)
output.write_text(json.dumps(report, indent=2, ensure_ascii=False))
for name, status in report.items():
    details = status["missing_nodes"] + status["missing_models"]
    print(("READY " if status["ready"] else "MISSING ") + name + (": " + ", ".join(details) if details else ""))
