import json
from pathlib import Path
import pytest
import folder_paths
from ComfyArt.api import video


def output_clip(name='shot.mp4'):
    root = Path(folder_paths.get_output_directory()); root.mkdir(parents=True, exist_ok=True)
    (root / name).write_bytes(b'video')
    return '/api/view?filename=' + name + '&type=output'


def test_only_existing_local_output_videos_can_be_assembled():
    src = output_clip()
    assert video.validate_clips({'clips': [{'src': src, 'narration': '雨夜。'}]})[0]['narration'] == '雨夜。'
    for src in ['https://example.com/view?filename=shot.mp4', '/api/view?filename=../secret.mp4', '/api/view?filename=shot.mp4&type=input', '/api/view?filename=missing.mp4']:
        with pytest.raises(ValueError): video.clip_path(src)


def test_symlink_outside_output_is_rejected(tmp_path):
    root = Path(folder_paths.get_output_directory());root.mkdir(parents=True)
    outside = tmp_path / 'private.mp4';outside.write_bytes(b'private')
    (root / 'shortcut.mp4').symlink_to(outside)
    with pytest.raises(ValueError): video.clip_path('/api/view?filename=shortcut.mp4')


def test_jobs_are_scoped_to_user_and_ids_are_validated():
    jid = 'a' * 32
    assert video.job_file('alice', jid) != video.job_file('default', jid)
    with pytest.raises(ValueError): video.job_file('default', '../file')


@pytest.mark.parametrize('clips', [[], [None], [{'src':'x'}] * 61])
def test_invalid_clip_batches_rejected(clips):
    with pytest.raises(ValueError): video.validate_clips({'clips': clips})


def test_excessive_narration_fails_instead_of_truncating():
    with pytest.raises(ValueError, match='150'):
        video.validate_clips({'clips':[{'src':output_clip(), 'narration':'长'*151}]})


def test_subtitles_keep_millisecond_timing():
    assert video.stamp(65.125) == '00:01:05,125'
    assert video.stamp(3600) == '01:00:00,000'


async def test_assembly_failure_is_persisted_and_existing_clips_are_preserved(monkeypatch):
    import sys, types
    monkeypatch.setitem(sys.modules, 'imageio_ffmpeg', types.SimpleNamespace(get_ffmpeg_exe=lambda: '/fake/ffmpeg'))
    src = output_clip(); clips=video.validate_clips({'clips':[{'src':src}]}); jid='b'*32
    video.write_json(str(video.job_file('default',jid)),{'id':jid,'status':'queued'})
    await video.assemble('default',jid,clips,False)
    state=json.loads(video.job_file('default',jid).read_text())
    assert state['status']=='error'
    assert 'shot.mp4' in state['error']
    assert Path(clips[0]['path']).exists()


async def test_prepare_does_not_release_resources_while_any_queue_job_is_active(monkeypatch):
    monkeypatch.setattr(video.PromptServer.instance.prompt_queue, 'get_tasks_remaining', lambda: 1)
    def forbidden(*args, **kwargs): pytest.fail('must not touch an active queue')
    monkeypatch.setattr(video.aiohttp, 'ClientSession', forbidden)
    assert await video.prepare_resources() is False
