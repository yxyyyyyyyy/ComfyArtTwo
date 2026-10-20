import importlib.util
from pathlib import Path

import av
import numpy as np
import pytest
from PIL import Image


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).resolve().parents[1] / 'deploy' / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


worker = load('directed_worker', 'render-directed-film.py')
timeline = load('directed_timeline', 'render-directed-timeline.py')


def test_voice_beats_remain_ordered_and_do_not_require_slow_video():
    cues = [{'id': str(i), 'beat': i // 4, 'text': '虚构对白'} for i in range(8)]
    beats = [{'id': i, 'title': '虚构场景', 'start': i * 30, 'end': (i + 1) * 30} for i in range(2)]
    placed = timeline.cue_layout(cues, {str(i): 5.0 for i in range(8)}, beats)
    assert [c['id'] for c in placed] == [str(i) for i in range(8)]
    assert all(c['speed'] == 1 for c in placed)
    assert all(c['start'] + c['duration'] <= (c['beat'] + 1) * 30 for c in placed)
    assert all(a['start'] + a['duration'] <= b['start'] for a, b in zip(placed, placed[1:]))


def test_excessive_voice_length_requires_revision_instead_of_holding_a_frame():
    with pytest.raises(ValueError, match='精简旁白'):
        timeline.cue_layout([{'id': '0', 'beat': 0}], {'0': 50}, [{'id': 0, 'title': '虚构场景', 'start': 0, 'end': 30}])


def make_clip(path, moving):
    with av.open(str(path), 'w') as container:
        stream = container.add_stream('mpeg4', rate=24)
        stream.width = 64
        stream.height = 64
        stream.pix_fmt = 'yuv420p'
        for i in range(72):
            frame = np.zeros((64, 64, 3), dtype=np.uint8)
            x = i % 44 if moving else 20
            frame[15:45, x:x + 18] = [240, 200, 60]
            for packet in stream.encode(av.VideoFrame.from_ndarray(frame, format='rgb24')):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)


def test_a_decodable_video_must_also_show_change_before_it_is_accepted(tmp_path):
    frozen = tmp_path / 'frozen.mp4'
    moving = tmp_path / 'moving.mp4'
    make_clip(frozen, False)
    make_clip(moving, True)
    assert worker.video_metrics(frozen)['not_frozen'] is False
    metrics = worker.video_metrics(moving)
    assert metrics['not_frozen'] is True
    assert abs(metrics['seconds'] - 3) < .05
    end = tmp_path / 'continuity.png'
    worker.last_frame(moving, end)
    frame = np.asarray(Image.open(end))
    assert frame.shape == (64, 64, 3)
    assert frame[30, 35, 0] > 100  # This position is dark in the first frame, bright near the end.


def test_image_cache_keeps_existing_video_paths_and_canonical_files(tmp_path, monkeypatch):
    import json
    import sys
    cache = load('model_cache', 'cache-video-models.py')
    models = tmp_path / 'models'
    (models / 'vae').mkdir(parents=True)
    source = models / 'vae' / 'tiny.bin'
    source.write_bytes(b'canonical-test-model')
    config = tmp_path / 'extra.json'
    config.write_text(json.dumps({'comfyart_video_cache': {'base_path': 'existing-video-cache'}}))
    monkeypatch.setattr(cache, 'IMAGE_FILES', {'vae': ['tiny.bin']})
    monkeypatch.setattr(sys, 'argv', ['cache', '--models', str(models), '--cache', str(tmp_path / 'cache'), '--config', str(config), '--profile', 'image'])
    cache.main()
    saved = json.loads(config.read_text())
    assert saved['comfyart_video_cache']['base_path'] == 'existing-video-cache'
    assert saved['comfyart_image_cache']['is_default'] is True
    assert source.read_bytes() == (tmp_path / 'cache/vae/tiny.bin').read_bytes()
