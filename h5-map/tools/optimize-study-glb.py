"""Lossless structural/image optimization for the two isolated GLB pilot files."""
from pathlib import Path
from io import BytesIO
from PIL import Image
import json
import struct
import hashlib


def optimize(path):
    raw = path.read_bytes()
    size = struct.unpack_from('<I', raw, 12)[0]
    data = json.loads(raw[20:20+size])
    offset = 20+size
    length = struct.unpack_from('<I', raw, offset)[0]
    binary = raw[offset+8:offset+8+length]
    views = data.get('bufferViews', [])
    chunks = [binary[v.get('byteOffset', 0):v.get('byteOffset', 0)+v['byteLength']] for v in views]
    for image in data.get('images', []):
        if image.get('mimeType') != 'image/png':
            continue
        index = image['bufferView']
        with Image.open(BytesIO(chunks[index])) as original:
            output = BytesIO()
            original.save(output, 'WEBP', lossless=True, exact=True, method=6)
            with Image.open(BytesIO(output.getvalue())) as converted:
                if original.convert('RGBA').tobytes() != converted.convert('RGBA').tobytes():
                    raise RuntimeError('Image pixels changed')
        chunks[index] = output.getvalue()
        image['mimeType'] = 'image/webp'
    if data.get('images'):
        for texture in data.get('textures', []):
            index = texture.get('source')
            if index is not None and data['images'][index].get('mimeType') == 'image/webp':
                texture.setdefault('extensions', {})['EXT_texture_webp'] = {'source': index}
                del texture['source']
        for key in ['extensionsUsed', 'extensionsRequired']:
            data[key] = sorted(set(data.get(key, [])+['EXT_texture_webp']))
    def accessor_bytes(index):
        a = data['accessors'][index]
        return chunks[a['bufferView']]
    old_skins = data.get('skins', [])
    unique_skins = []
    skin_keys = {}
    mapping = {}
    for i, skin in enumerate(old_skins):
        key = json.dumps({k: v for k, v in skin.items() if k not in ('inverseBindMatrices', 'name')}, sort_keys=True)
        key += hashlib.sha256(accessor_bytes(skin['inverseBindMatrices'])).hexdigest()
        if key not in skin_keys:
            skin_keys[key] = len(unique_skins)
            unique_skins.append(skin)
        mapping[i] = skin_keys[key]
    for node in data.get('nodes', []):
        if 'skin' in node:
            node['skin'] = mapping[node['skin']]
    data['skins'] = unique_skins
    # Reuse byte-identical views (including bone matrices and time arrays).
    body = bytearray()
    seen = {}
    for view, payload in zip(views, chunks):
        key = (view.get('byteStride'), view.get('target'), hashlib.sha256(payload).digest())
        if key not in seen:
            body.extend(b'\0' * (-len(body) % 4))
            seen[key] = len(body)
            body.extend(payload)
        view['buffer'] = 0
        view['byteOffset'] = seen[key]
        view['byteLength'] = len(payload)
    data['buffers'] = [{'byteLength': len(body)}]
    json_bytes = json.dumps(data, separators=(',', ':')).encode()
    json_bytes += b' ' * (-len(json_bytes) % 4)
    body.extend(b'\0' * (-len(body) % 4))
    output = struct.pack('<4sII', b'glTF', 2, 28+len(json_bytes)+len(body))
    output += struct.pack('<I4s', len(json_bytes), b'JSON')+json_bytes
    output += struct.pack('<I4s', len(body), b'BIN\0')+body
    target = path.with_name(path.stem+'-optimized.glb')
    target.write_bytes(output)
    print(f'{path.stem}: {len(raw)} -> {len(output)} bytes; skins {len(old_skins)} -> {len(unique_skins)}')


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', type=Path)
    args = parser.parse_args()
    if args.directory:
        for path in sorted(args.directory.glob('*.glb')):
            if not path.stem.endswith('-optimized'):
                optimize(path)
    else:
        root = Path(__file__).resolve().parents[1] / 'build/animal-glb-study'
        for name in ['Chicken', 'CrystalDragon']:
            path = root / (name+'.glb')
            if path.exists():
                optimize(path)
