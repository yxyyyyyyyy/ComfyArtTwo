import json

from ComfyArt.api.bot_turns import blocks_text, _replay_history


def test_followup_replays_original_brief_and_read_skill(monkeypatch):
    from ComfyArt.api import chat_store
    instructions = 'Create a logo, color palette and stationery mockup.'
    rows = [
        {'id': 'u1', 'role': 'user', 'blocks': [
            {'type': 'skill', 'name': '品牌识别'},
            {'type': 'text', 'text': '链式感知公司，科技领域'}]},
        {'id': 'a1', 'role': 'assistant', 'blocks': [
            {'type': 'tool_result', 'name': 'skill', 'status': 'success',
             'text': json.dumps({'instructions': instructions})},
            {'type': 'text', 'text': '计划制作 Logo、配色板、名片。'}]},
        {'id': 'u2', 'role': 'user', 'blocks': [{'type': 'text', 'text': '继续'}]},
        {'id': 'a2', 'parent_id': 'u2', 'role': 'assistant', 'blocks': []},
    ]
    monkeypatch.setattr(chat_store, 'list_messages', lambda _: rows)
    history = _replay_history('chat', 'a2')
    assert [m['role'] for m in history] == ['user', 'assistant']
    assert '链式感知' in history[0]['text'] and '品牌识别' in history[0]['text']
    assert instructions in history[1]['text']


def test_direct_results_preserve_prompt_for_later_conversation():
    text = blocks_text([{'type': 'task', 'detail': {
        'tool': 'generate_image', 'prompt': 'Blue geometric technology logo'},
        'srcs': ['/api/view?filename=logo.png']}])
    assert 'Blue geometric technology logo' in text
    assert '/api/view?filename=logo.png' in text


def test_misrouted_confirmation_is_not_replayed_as_a_design_result():
    assert blocks_text([{'type': 'task', 'detail': {'prompt': '继续'},
                         'srcs': ['/api/view?filename=bird.png']}]) == ''


def test_unverified_assistant_claims_are_not_replayed_as_completed_work(monkeypatch):
    from ComfyArt.api import chat_store
    rows = [{'id': 'a1', 'role': 'assistant', 'blocks': [
        {'type': 'text', 'text': 'generate_image finished; fake.png'},
        {'type': 'notice', 'text': 'This turn made no tool calls, so nothing it describes was actually done'}]}]
    monkeypatch.setattr(chat_store, 'list_messages', lambda _: rows)
    text = _replay_history('chat', 'a2')[0]['text']
    assert 'fake.png' not in text and 'not a verified' in text


def test_rejected_visual_description_is_not_replayed_as_a_brief(monkeypatch):
    from ComfyArt.api import chat_store
    rows = [{'id': 'a1', 'role': 'assistant', 'blocks': [
        {'type': 'text', 'text': 'A blue ellipse is the finished anti-corruption poster.'},
        {'type': 'notice', 'kind': 'design_acceptance_failed', 'text': '验收未通过'}]}]
    monkeypatch.setattr(chat_store, 'list_messages', lambda _: rows)
    assert 'blue ellipse' not in _replay_history('chat', 'a2')[0]['text']
