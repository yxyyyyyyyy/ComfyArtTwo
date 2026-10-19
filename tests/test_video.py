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


def test_render_status_distinguishes_restarted_service_and_queued_job():
    from types import SimpleNamespace
    queue = SimpleNamespace(get_history=lambda **kw: {}, get_current_queue_volatile=lambda: ([], [(2, 'other', {}, {}), (1, 'ours', {}, {})]))
    assert video.render_status('ours', queue, None) == {'status': 'queued', 'stage': '排队等待', 'position': 1}
    assert video.render_status('lost', queue, None)['status'] == 'missing'


def test_render_status_reports_real_sampler_and_decode_stages():
    from types import SimpleNamespace
    queue = SimpleNamespace(get_history=lambda **kw: {}, get_current_queue_volatile=lambda: ([(1, 'ours', {}, {'create_time': 123})], []))
    state = {'state': SimpleNamespace(value='running'), 'value': 3, 'max': 8}
    registry = SimpleNamespace(prompt_id='ours', nodes={'12': state}, dynprompt=SimpleNamespace(get_node=lambda _: {'class_type': 'KSampler'}))
    result = video.render_status('ours', queue, registry)
    assert (result['stage'], result['value'], result['max'], result['started']) == ('视频采样', 3, 8, 123)
    registry.dynprompt.get_node = lambda _: {'class_type': 'VAEDecode'}
    assert video.render_status('ours', queue, registry)['stage'] == '视频解码'
    registry.prompt_id = 'unrelated'
    assert 'value' not in video.render_status('ours', queue, registry)


def test_render_status_recovers_saved_output_and_terminal_error():
    from types import SimpleNamespace
    history = {'ours': {'outputs': {'92': {'videos': [{'filename': 'done.mp4'}]}}}}
    queue = SimpleNamespace(get_history=lambda **kw: history)
    assert video.render_status('ours', queue, None) == {'status': 'done', 'outputs': [{'filename': 'done.mp4'}]}
    history['ours']['status'] = {'messages': [('execution_interrupted', {})]}
    assert video.render_status('ours', queue, None)['status'] == 'error'


async def test_assembly_uuid_reconnect_does_not_start_duplicate_work(bot_client, monkeypatch):
    import asyncio
    gate = asyncio.Event(); started = []
    async def fake_assemble(*args):
        started.append(args[1]); await gate.wait()
    monkeypatch.setattr(video, 'assemble', fake_assemble)
    body = {'id': 'c' * 32, 'clips': [{'src': output_clip(), 'narration': '雨夜。'}], 'voice': True}
    try:
        first = await bot_client.post('/comfyart/video/assemble', json=body)
        await asyncio.sleep(0)
        again = await bot_client.post('/comfyart/video/assemble', json=body)
        assert first.status == again.status == 202
        assert started == [body['id']]
        changed = await bot_client.post('/comfyart/video/assemble', json={**body, 'voice': False})
        assert changed.status == 409
        assert started == [body['id']]
    finally:
        gate.set()
        await asyncio.sleep(0)


async def test_voice_status_counts_completed_cues_without_waiting_for_all_audio(bot_client, monkeypatch):
    jid = 'd' * 32
    video.write_json(str(video.job_file('default', jid)), {'id': jid, 'status': 'voicing', 'total': 12, 'progress': 0})
    monkeypatch.setitem(video._TASKS, jid, object())
    root = Path(folder_paths.get_output_directory()) / 'comfyart' / 'stories' / jid
    root.mkdir(parents=True)
    (root / 'story.json').write_text(json.dumps({'narration': [{'id': '0'}, {'id': '3'}]}))
    (root / 'voice-manifest.json').write_text(json.dumps([{'id': '0', 'duration': 4.1}]))
    state = await (await bot_client.get('/comfyart/video/assemble/' + jid)).json()
    assert (state['progress'], state['total'], state['stage']) == (1, 2, '生成中文旁白')
    assert (await bot_client.get('/comfyart/video/assemble/' + jid, headers={'comfy-user': 'alice'})).status == 404


async def test_production_pause_only_targets_a_registered_local_episode(bot_client):
    response = await bot_client.post('/comfyart/video/production/cellar-episode-01/control', json={'pause': True})
    assert response.status == 200
    path = Path(folder_paths.get_output_directory()) / 'comfyart/cellar-episode-01/control.json'
    assert json.loads(path.read_text()) == {'pause': True}
    assert (await bot_client.post('/comfyart/video/production/UNKNOWN/control', json={'pause': True})).status == 400
    assert (await bot_client.post('/comfyart/video/production/not-a-registered-episode/control', json={'pause': True})).status == 404
    assert (await bot_client.post('/comfyart/video/production/cellar-episode-01/control', json={'pause': 'yes'})).status == 400
    assert json.loads(path.read_text()) == {'pause': True}


async def test_production_status_reads_json_without_streaming_a_file(bot_client):
    root = Path(folder_paths.get_output_directory()) / 'comfyart/cellar-episode-01'
    root.mkdir(parents=True, exist_ok=True)
    path = root / 'progress.json'
    video.write_json(str(path), {'status': 'running', 'voices_done': 35})
    response = await bot_client.get('/comfyart/video/production/cellar-episode-01')
    assert response.status == 200
    initial = await response.json()
    assert initial['status'] == 'running' and initial['voices_done'] == 35
    assert initial['preview_render'] is None
    path.replace(root / 'previous.json')
    video.write_json(str(path), {'status': 'done'})
    assert (await (await bot_client.get('/comfyart/video/production/cellar-episode-01')).json())['status'] == 'done'
    assert (await bot_client.get('/comfyart/video/production/unknown')).status == 404
    assert (await bot_client.get('/comfyart/video/production/INVALID')).status == 400
