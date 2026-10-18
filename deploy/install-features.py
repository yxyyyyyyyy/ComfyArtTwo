"""Install pinned feature models; SHA256 is checked before each file is used."""
import argparse
import json
from pathlib import Path

import download_models as downloader


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("features", nargs="*", help="Feature groups in feature-models.json")
    args = parser.parse_args()
    catalog = json.loads(Path(__file__).with_name("feature-models.json").read_text())
    selected = args.features or list(catalog)
    unknown = set(selected) - catalog.keys()
    if unknown:
        parser.error("Unknown features: " + ", ".join(sorted(unknown)))
    report = downloader.ROOT / "artifacts" / "feature-models-verified.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    verified = json.loads(report.read_text()) if report.exists() else {}
    for feature in selected:
        results = []
        for model in catalog[feature]:
            downloader.REPO = model["repository"]
            print(f"Installing {feature}: {model['target']}", flush=True)
            results.append(downloader.download(
                model["target"], model["revision"], model["metadata"], model.get("mirror")))
        verified[feature] = results
        report.write_text(json.dumps(verified, indent=2), encoding="utf-8")
        print(f"Verified feature: {feature}", flush=True)


if __name__ == "__main__":
    main()
