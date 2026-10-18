"""Run real GPU feature checks and retain outputs and prompt history on the Mac."""
import argparse
import io
import json
import subprocess
import time
from pathlib import Path

import requests
from PIL import Image, ImageChops, ImageDraw

parser = argparse.ArgumentParser()
parser.add_argument("features", nargs="+", choices=["cutout", "upscale", "erase", "z-image", "qwen-edit", "qwen-t2i", "outpaint", "angles", "video", "i2v"])
parser.add_argument("--url", default="http://127.0.0.1:8188")
parser.add_argument("--timeout", type=int, default=2700)
parser.add_argument("--wait-for-idle", action="store_true")
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
artifacts = root / "artifacts"
base = args.url.rstrip("/")
session = requests.Session()
session.trust_env = False


def api(method, path, **kwargs):
    response = session.request(method, base + path, timeout=120, **kwargs)
    response.raise_for_status()
    return response.json()


def upload(image, name):
    data = io.BytesIO()
    image.save(data, format="PNG")
    result = api("POST", "/upload/image", files={"image": (name, data.getvalue(), "image/png")},
                 data={"subfolder": "comfyart-checks", "type": "input", "overwrite": "true"})
    return result["subfolder"] + "/" + result["name"]


def workflow(name):
    return json.loads((root / "workflows" / (name + ".api.json")).read_text())


for feature in args.features:
    waiting = time.monotonic()
    while True:
        queue = api("GET", "/queue")
        if not queue["queue_running"] and not queue["queue_pending"]:
            break
        if not args.wait_for_idle:
            raise RuntimeError("Another job is running; retry after it finishes or use --wait-for-idle")
        if time.monotonic() - waiting > args.timeout:
            raise TimeoutError("The GPU queue did not become idle")
        time.sleep(15)
    source = Image.open(artifacts / "5090-first-image.png").convert("RGB")
    if feature in ("upscale", "erase"):
        source = source.resize((256, 256), Image.Resampling.LANCZOS)
        if feature == "erase":
            ImageDraw.Draw(source).rectangle((115, 100, 145, 130), fill=(240, 48, 60))
    elif feature in ("qwen-edit", "qwen-t2i", "outpaint", "angles"):
        source = source.resize((512, 512), Image.Resampling.LANCZOS)
    uploaded = upload(source, feature + "-source.png")
    if feature == "cutout":
        graph = workflow("cutout-birefnet")
        graph["17"]["inputs"]["image"] = uploaded
    elif feature == "upscale":
        graph = workflow("upscale-ultrasharp-4x")
        graph["1"]["inputs"]["image"] = uploaded
    elif feature == "erase":
        graph = workflow("erase-lama")
        graph["1"]["inputs"]["image"] = uploaded
        mask = Image.new("RGBA", source.size, (0, 0, 0, 255))
        ImageDraw.Draw(mask).rectangle((115, 100, 145, 130), fill=(0, 0, 0, 0))
        graph["2"]["inputs"]["image"] = upload(mask, "erase-mask.png")
    elif feature == "z-image":
        graph = workflow("z-image-turbo-t2i")
        graph["5"]["inputs"].update(width=512, height=512)
        graph["6"]["inputs"]["text"] = "A white ceramic coffee cup on a warm oak table, soft morning sunlight, photorealistic product photography"
        graph["7"]["inputs"]["seed"] = 509019
    elif feature == "qwen-edit":
        graph = workflow("edit-qwen-image-2.1")
        graph["11"]["inputs"]["image"] = uploaded
        graph["6"]["inputs"]["prompt"] = "Change the white ceramic coffee cup to a cobalt blue ceramic coffee cup. Keep the coffee, composition, wooden table, lighting and background unchanged."
        graph["7"]["inputs"]["seed"] = 509019
    elif feature == "qwen-t2i":
        graph = workflow("qwen-image-2.1-t2i")
        graph["5"]["inputs"].update(width=512, height=512)
        graph["6"]["inputs"].update(prompt="A cobalt blue ceramic coffee cup on a warm oak table, morning light, minimalist product photography, no text", resolution=512)
        graph["7"]["inputs"]["seed"] = 509019
    elif feature == "outpaint":
        graph = workflow("outpaint-qwen-image-2.1")
        graph["11"]["inputs"]["image"] = uploaded
        for node in ("21", "27"):
            graph[node]["inputs"].update(left=64, right=64, top=0, bottom=0)
        graph["25"]["inputs"]["string_b"] = "Continue the oak tabletop and softly lit room naturally."
        graph["7"]["inputs"]["seed"] = 509019
    elif feature == "angles":
        graph = workflow("multiangle-qwen-image-2.1")
        graph["11"]["inputs"]["image"] = uploaded
        graph["6"]["inputs"].update(prompt="<qma> right side view elevated shot medium shot", resolution=512)
        graph["7"]["inputs"]["seed"] = 509019
    elif feature == "i2v":
        graph = workflow("i2v-minimax-h3")
        graph["114"]["inputs"]["image"] = uploaded
        graph["105:104"]["inputs"].update(width=512, height=512, prompt="The white ceramic coffee cup and saucer stay still on the wooden table. Soft morning light, a tiny slow camera move. Audio: quiet morning ambience.")
        graph["105:111"]["inputs"]["value"] = 2
    else:
        graph = workflow("t2v-minimax-h3")
        graph["131"]["inputs"].update(width=512, height=512, prompt="A white ceramic cup of hot coffee on an oak table, wisps of steam gently rising, warm morning sunlight, locked camera, photorealistic. Audio: quiet morning birdsong.")
        graph["133"]["inputs"]["value"] = 2
        graph["138"]["inputs"]["value"] = 8
        graph["139"]["inputs"]["value"] = True
    for node in graph.values():
        if node["class_type"] in ("SaveImage", "SaveVideo"):
            node["inputs"]["filename_prefix"] = "comfyart/verified-" + feature
    started = time.monotonic()
    job = api("POST", "/prompt", json={"prompt": graph, "client_id": "comfyart-feature-check"})
    prompt_id = job["prompt_id"]
    print(feature + " queued: " + prompt_id, flush=True)
    report = {"feature": feature, "prompt_id": prompt_id, "workflow": graph}
    while time.monotonic() - started < args.timeout:
        history = api("GET", "/history/" + prompt_id)
        if prompt_id in history:
            entry = history[prompt_id]
            report.update(seconds=round(time.monotonic() - started, 2), history=entry)
            events = {name: data for name, data in entry["status"]["messages"]}
            if "execution_success" in events:
                report["engine_seconds"] = (events["execution_success"]["timestamp"] - events["execution_start"]["timestamp"]) / 1000
            (artifacts / (feature + "-check.json")).write_text(json.dumps(report, indent=2))
            if entry["status"]["status_str"] != "success":
                raise RuntimeError(json.dumps(entry["status"], ensure_ascii=False))
            saved = []
            for output in entry["outputs"].values():
                for kind in ("images", "videos", "gifs"):
                    for item in output.get(kind, []):
                        response = session.get(base + "/view", params={k: item[k] for k in ("filename", "subfolder", "type") if k in item}, timeout=120)
                        response.raise_for_status()
                        destination = artifacts / ("5090-" + feature + Path(item["filename"]).suffix)
                        destination.write_bytes(response.content)
                        saved.append(str(destination))
                        if destination.suffix.lower() in (".png", ".jpg", ".webp"):
                            image = Image.open(destination)
                            assert image.getextrema() != ((0, 0),) * len(image.getbands()), "Output is blank"
                            if feature == "cutout":
                                assert image.mode == "RGBA" and image.getchannel("A").getextrema()[0] < 20
                                assert image.getchannel("A").getextrema()[1] > 235
                            if feature == "upscale":
                                assert image.size == (1024, 1024)
                            if feature == "erase":
                                difference = ImageChops.difference(source, image.convert("RGB"))
                                assert difference.crop((115, 100, 146, 131)).getbbox(), "Masked area did not change"
                                assert not difference.crop((0, 0, 50, 50)).getbbox(), "Unmasked corner changed"
                                assert image.convert("RGB").getpixel((130, 115))[1] > 100, "Red test mark was not removed"
                            if feature == "outpaint":
                                assert image.size == (640, 512)
                                original_center = source.crop((100, 100, 412, 412))
                                output_center = image.convert("RGB").crop((164, 100, 476, 412))
                                assert not ImageChops.difference(original_center, output_center).getbbox(), "Original center changed during outpaint"
                        elif destination.suffix.lower() in (".mp4", ".webm"):
                            probe = json.loads(subprocess.check_output([
                                "ffprobe", "-v", "error", "-count_frames", "-show_streams", "-of", "json", str(destination)]))
                            video = next(stream for stream in probe["streams"] if stream["codec_type"] == "video")
                            assert (video["width"], video["height"]) == (512, 512)
                            assert int(video["nb_read_frames"]) >= 48
                            assert any(stream["codec_type"] == "audio" for stream in probe["streams"])
                            report["video"] = {k: video.get(k) for k in ("width", "height", "codec_name", "duration", "nb_read_frames", "avg_frame_rate")}
            if not saved:
                raise RuntimeError("Successful job returned no downloadable output")
            report["files"] = saved
            (artifacts / (feature + "-check.json")).write_text(json.dumps(report, indent=2))
            print(f"{feature} passed in {report['seconds']}s: {saved}", flush=True)
            break
        print(f"{feature} running ({time.monotonic() - started:.0f}s)", flush=True)
        time.sleep(15)
    else:
        raise TimeoutError(feature + " exceeded timeout; the job remains visible in /queue")
