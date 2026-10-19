import json

import pytest

from ComfyArt.bot.local_llm import LocalLlmProvider
from ComfyArt.bot.providers import TurnHandle, TurnRequest


def call(name, arguments):
    return {'content': '', 'tool_calls': [{'id': name, 'function': {
        'name': name, 'arguments': json.dumps(arguments)}}]}


async def run_poster(monkeypatch, messages):
    provider = LocalLlmProvider(base_url=lambda: 'http://x/v1')

    async def request(session, method, url, **kwargs):
        if url.endswith('/chat/completions'):
            return {'choices': [{'message': messages.pop(0)}]}
        return {'result': {'tools': [{'name': n} for n in
            ['skill', 'create_frame', 'add_shape', 'generate_image', 'wait_generation', 'view_canvas']]}}

    async def tool(session, endpoint, name, args):
        if name == 'skill':
            return json.dumps({'instructions': 'Design posters: meaningful hero and 3:4.'}), []
        if name == 'generate_image':
            return '{"ids":["job:poster"]}', []
        if name == 'wait_generation':
            return json.dumps({'status': 'done', 'results': [{'id': 'job:poster',
                'status': 'done', 'urls': ['/poster.png'], 'shapes': ['shape:poster']}]}), []
        if name == 'view_canvas':
            return '{}', ['data:image/png;base64,QUJD']
        return '{"id":"shape:frame"}', []

    monkeypatch.setattr(provider, '_request_json', request)
    monkeypatch.setattr(provider, '_mcp_call_tool', tool)
    monkeypatch.setattr(provider, '_lms_bin', lambda: '')
    events = []
    async def emit(event):
        events.append(event)
    result = await provider.send(TurnRequest(chat_id='c',
        user_text="[Selected ComfyArt skill id: poster]\nUse the ComfyArt skill '海报设计' for this task: 党政廉洁",
        mcp_endpoint='http://x/mcp', model='m'), emit, TurnHandle())
    return result, events


async def test_frames_and_circle_do_not_pass_as_a_finished_poster(monkeypatch):
    replies = [call('skill', {'action': 'read'}), call('create_frame', {}),
        call('add_shape', {'kind': 'ellipse'}), *[{'content': 'Poster designed.'} for _ in range(3)]]
    result, events = await run_poster(monkeypatch, replies)
    assert '海报未完成' in result.error
    assert not any(e.t == 'delta' and 'Poster designed' in e.text for e in events)


async def test_poster_contract_applies_even_when_model_skips_reading_skill(monkeypatch):
    replies = [call('create_frame', {}), call('add_shape', {'kind': 'ellipse'}),
        *[{'content': 'Poster designed.'} for _ in range(3)]]
    result, _ = await run_poster(monkeypatch, replies)
    assert '海报未完成' in result.error


async def test_generated_waited_and_inspected_portrait_image_passes(monkeypatch):
    replies = [call('skill', {'action': 'read'}), call('generate_image', {'ratio': '3:4'}),
        call('wait_generation', {'ids': ['job:poster']}),
        call('view_canvas', {'ids': ['shape:poster']}), {'content': '海报已生成，请查看。'}]
    result, events = await run_poster(monkeypatch, replies)
    assert not result.error
    assert events[-1].text == '海报已生成，请查看。'


async def test_wrong_ratio_does_not_pass_even_if_the_image_was_inspected(monkeypatch):
    replies = [call('skill', {'action': 'read'}), call('generate_image', {'ratio': '1:1'}),
        call('wait_generation', {'ids': ['job:poster']}),
        call('view_canvas', {'ids': ['shape:poster']}), *[{'content': 'Done.'} for _ in range(3)]]
    result, _ = await run_poster(monkeypatch, replies)
    assert result.error


async def test_memory_failure_retries_completion_once_without_repeating_tools(monkeypatch):
    provider = LocalLlmProvider(base_url=lambda: 'http://x/v1')
    calls = []
    async def request(*args, **kwargs):
        calls.append(kwargs['json_body'])
        if len(calls) == 1:
            raise RuntimeError('HTTP 500: memory layout cannot be allocated')
        return {'choices': [{'message': {'content': 'ok'}}]}
    async def emit(event):
        pass
    monkeypatch.setattr(provider, '_request_json', request)
    response = await provider._complete(None, 'm', [], [], 'http://x/mcp', emit)
    assert response['choices'][0]['message']['content'] == 'ok'
    assert len(calls) == 2 and calls[0] == calls[1]


async def test_repeated_allocation_failure_has_a_clear_bounded_error(monkeypatch):
    provider = LocalLlmProvider(base_url=lambda: 'http://x/v1')
    calls = []
    async def request(*args, **kwargs):
        calls.append(1)
        raise RuntimeError('memory layout cannot be allocated')
    async def emit(event):
        pass
    monkeypatch.setattr(provider, '_request_json', request)
    with pytest.raises(RuntimeError, match='自动恢复后仍未成功'):
        await provider._complete(None, 'm', [], [], 'http://x/mcp', emit)
    assert len(calls) == 2


@pytest.mark.parametrize('busy', [False, True])
async def test_recovery_releases_only_this_comfy_service_when_idle(monkeypatch, busy):
    provider = LocalLlmProvider(base_url=lambda: 'http://127.0.0.1:11435/v1')
    paths = []
    async def request(session, method, url, **kwargs):
        paths.append(url)
        return {'queue_running': [[1]] if busy else [], 'queue_pending': []} if url.endswith('/queue') else {}
    monkeypatch.setattr(provider, '_request_json', request)
    await provider._recover_memory(None, 'm', 'http://127.0.0.1:8188/comfyart/mcp')
    assert paths[0].endswith(':11435/api/generate')
    assert any(p.endswith('/free') for p in paths) is not busy
