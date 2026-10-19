"""Exercise the public MCP canvas tools against the open example project."""
import os
import json
from pathlib import Path
import requests

URL = 'http://127.0.0.1:8188/comfyart/mcp?project=' + requests.utils.quote(os.environ['COMFYART_DEMO_PROJECT'], safe='')


def call(name, arguments):
    response = requests.post(URL, json={'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call',
                                      'params': {'name': name, 'arguments': arguments}}, timeout=60)
    response.raise_for_status()
    result = response.json()['result']
    if result.get('isError'):
        raise RuntimeError(result)
    return json.loads(result['content'][0]['text'])


state = call('get_canvas', {})
if state['shapes']:
    raise RuntimeError('Demo project already has content; refusing to overwrite it')
frame = call('create_frame', {'name': '灵感，在本地生长', 'width': 1200, 'height': 800, 'x': 0, 'y': 0})
print(json.dumps(frame, ensure_ascii=False), flush=True)
fid = frame['id']


def shape(**args):
    return call('add_shape', {'frame': fid, **args})


def text(**args):
    return call('add_text', {'frame': fid, **args})


shape(kind='rect', x=0, y=0, width=1200, height=800, fill='#F4F2EC', stroke='#F4F2EC')
shape(kind='rect', x=64, y=64, width=44, height=5, fill='#547B55', stroke='#547B55')
text(text='MUJIAN / AI CREATIVE STUDIO', x=64, y=90, width=650, font_size=20, color='#547B55')
text(text='让灵感\n在本地生长。', x=58, y=195, width=560, font_size=68, color='#17261D')
text(text='Agent · 图片 · 视频 · 自由画布', x=64, y=400, width=520, font_size=23, color='#647165')
text(text='从一个想法，到一幅作品。\n所有创作，留在你自己的电脑上。', x=64, y=460, width=500, font_size=21, color='#647165')
shape(kind='rect', x=650, y=160, width=486, height=486, fill='#E1E6DA', stroke='#E1E6DA')
text(text='本地生成图像', x=740, y=380, width=310, font_size=27, color='#547B55', align='center')
shape(kind='rect', x=64, y=680, width=1072, height=1, fill='#C9CEC1', stroke='#C9CEC1')
text(text='CREATED WITH AI.  DESIGNED BY YOU.', x=64, y=710, width=650, font_size=17, color='#547B55')
text(text='01 / YOUR CANVAS', x=910, y=710, width=226, font_size=17, color='#547B55', align='right')
call('focus', {'ids': [fid]})
artifacts = Path(__file__).resolve().parents[1] / 'artifacts'
artifacts.mkdir(exist_ok=True)
(artifacts / 'demo-frame.json').write_text(json.dumps({'project': os.environ['COMFYART_DEMO_PROJECT'], 'frame': fid}, indent=2))
print('MCP canvas editing verified', flush=True)
