import hashlib
import json
import os
import sys
from pathlib import Path

manifest = json.loads(Path(sys.argv[1]).read_text())
target = Path(manifest['destination'])
if not target.resolve().is_relative_to(Path('F:/ComfyArt').resolve()):
    raise ValueError('Destination must be under F:/ComfyArt')
partial = target.with_suffix(target.suffix + '.upload')
hasher = hashlib.sha256()
with partial.open('wb') as output:
    if manifest['prefix']:
        with target.open('rb') as prefix:
            remaining = manifest['prefix']
            while remaining:
                block = prefix.read(min(8 * 1024 * 1024, remaining))
                if not block:
                    raise RuntimeError('Incomplete existing prefix')
                output.write(block)
                hasher.update(block)
                remaining -= len(block)
    directory = Path(manifest['directory'])
    for index in range(manifest['prefix'] // manifest['chunk_size'], manifest['count']):
        with (directory / str(index)).open('rb') as source:
            while block := source.read(8 * 1024 * 1024):
                output.write(block)
                hasher.update(block)
if partial.stat().st_size != manifest['size'] or hasher.hexdigest() != manifest['sha256']:
    raise RuntimeError('Remote assembled model failed SHA256 verification')
os.replace(partial, target)
for part in directory.iterdir():
    part.unlink()
directory.rmdir()
print('Remote file assembled and SHA256 verified: ' + str(target), flush=True)
