import importlib.util
import json
import sys
from pathlib import Path


def test_ssd_cache_preserves_originals_and_repairs_a_corrupt_cache(tmp_path, monkeypatch):
    source = Path(__file__).resolve().parents[1] / 'deploy/cache-video-models.py'
    spec = importlib.util.spec_from_file_location('cache_video_models', source)
    module = importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    models=tmp_path/'models';cache=tmp_path/'cache';config=tmp_path/'paths.yaml'
    originals={}
    for kind,names in module.FILES.items():
        for name in names:
            path=models/kind/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(name.encode()); originals[path]=path.read_bytes()
    monkeypatch.setattr(sys,'argv',['cache','--models',str(models),'--cache',str(cache),'--config',str(config)])
    module.main()
    paths=json.loads(config.read_text())['comfyart_video_cache']
    assert paths['is_default'] is True
    assert paths['base_path']==str(cache)
    for path,data in originals.items():
        assert path.read_bytes()==data
        assert (cache/path.relative_to(models)).read_bytes()==data
    copied=next(iter(originals)); target=cache/copied.relative_to(models)
    target.write_bytes(b'x'*target.stat().st_size)
    module.main()
    assert target.read_bytes()==originals[copied]
    assert copied.read_bytes()==originals[copied]


def test_unmanaged_existing_cache_is_not_overwritten(tmp_path, monkeypatch):
    import pytest
    source=Path(__file__).resolve().parents[1]/'deploy/cache-video-models.py'
    spec=importlib.util.spec_from_file_location('cache_video_models_guard',source)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    models=tmp_path/'models';cache=tmp_path/'cache'
    for kind,names in module.FILES.items():
        for name in names:
            path=models/kind/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'model')
    kind=next(iter(module.FILES));existing=cache/kind/module.FILES[kind][0]
    existing.parent.mkdir(parents=True);existing.write_bytes(b'existing private file')
    monkeypatch.setattr(sys,'argv',['cache','--models',str(models),'--cache',str(cache),'--config',str(tmp_path/'config.yaml')])
    with pytest.raises(RuntimeError,match='unmanaged'):module.main()
    assert existing.read_bytes()==b'existing private file'
