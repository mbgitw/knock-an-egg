"""Optimize generated runtime files only; public/ and original exports stay intact."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from PIL import Image
import hashlib
import json
import re
import shutil
import struct
from threading import Lock

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / 'build/builda-draft'
CACHE = ROOT / 'build/image-cache-v1'
UI_DIRS = ('index-ui', 'gcoin-shop', 'inventory-ui', 'hotbar-ui', 'merge-ui', 'bank-feedback', 'free-gift', 'trails')


def glb_images(path):
    data = path.read_bytes()
    size = struct.unpack_from('<I', data, 12)[0]
    return [i['uri'] for i in json.loads(data[20:20+size]).get('images', []) if i.get('uri') and not i['uri'].startswith('data:')]


def optimize():
    if BUILD.resolve() != (ROOT / 'build/builda-draft').resolve() or not (BUILD / 'index.html').is_file():
        raise RuntimeError('Build the runtime directory first')
    before = sum(p.stat().st_size for p in BUILD.rglob('*') if p.is_file())
    removed = []
    # Only world.glb consumes this directory's textures. Keep its complete URI set.
    map_dir = BUILD / 'obj-map'
    used = set(glb_images(map_dir / 'world.glb'))
    for uri in used:
        if not (map_dir / uri).is_file():
            raise RuntimeError(f'Missing map texture {uri}')
    for p in map_dir.iterdir():
        if p.suffix.lower() in ('.png', '.jpg', '.webp') and p.name not in used:
            removed.append(p.relative_to(BUILD).as_posix())
            p.unlink()
    for name in ['reference.png', 'speed.png']:
        reference = BUILD / 'gameplay/index-ui' / name
        # speed.webp is already the runtime icon; speed.png is its archived copy.
        if reference.exists():
            removed.append(reference.relative_to(BUILD).as_posix())
            reference.unlink()
    # All other GLBs embed their images. Reject a new external-image dependency
    # instead of silently breaking it when converting filenames.
    for p in BUILD.rglob('*.glb'):
        if p.parent != map_dir and glb_images(p):
            raise RuntimeError(f'External GLB textures need an explicit policy: {p}')

    CACHE.mkdir(parents=True, exist_ok=True)
    images = [p for p in BUILD.rglob('*.png') if map_dir not in p.parents]
    locks = {}
    def convert(path):
        relative = path.relative_to(BUILD).as_posix()
        ui = any(relative.startswith(f'gameplay/{folder}/') for folder in UI_DIRS)
        policy = 'ui512-q92-alpha-exact' if ui else 'lossless-exact'
        key = hashlib.sha256(path.read_bytes() + policy.encode()).hexdigest()
        cached = CACHE / (key + '.webp')
        destination = path.with_suffix('.webp')
        if destination.exists():
            raise RuntimeError(f'Image name collision: {relative}')
        with Image.open(path) as original:
            size = original.size
            with locks.setdefault(key, Lock()):
                if not cached.exists():
                    image = original.convert('RGBA')
                    if ui:
                        image.thumbnail((512, 512), Image.Resampling.LANCZOS)
                    image.save(cached, 'WEBP', lossless=not ui, quality=92, method=4, exact=True)
            with Image.open(cached) as optimized:
                result_size = optimized.size
        source_bytes = path.stat().st_size
        shutil.copyfile(cached, destination)
        path.unlink()
        return {'path': relative, 'sourceBytes': source_bytes, 'bytes': destination.stat().st_size,
                'sourceSize': size, 'size': result_size, 'lossless': not ui}
    with ThreadPoolExecutor(max_workers=4) as workers:
        entries = list(workers.map(convert, images))
    # Runtime-generated filenames and exported material JSON follow the same
    # extension rule. Map files and vendor code are deliberately kept verbatim.
    for path in BUILD.rglob('*'):
        if not path.is_file() or path.suffix not in ('.js', '.json', '.css', '.html', '.svg'):
            continue
        if path.relative_to(BUILD).parts[0] in ('obj-map', 'vendor'):
            continue
        if path.relative_to(BUILD).as_posix() == 'gameplay/animal-glb/catalog.json':
            continue  # Source PNG hashes describe public/, not rewritten runtime URLs.
        text = path.read_text(encoding='utf-8')
        result = re.sub(r'\.png\b', '.webp', text, flags=re.IGNORECASE)
        if result != text:
            path.write_text(result, encoding='utf-8')
    after = sum(p.stat().st_size for p in BUILD.rglob('*') if p.is_file())
    report = {'beforeBytes': before, 'afterBytes': after, 'removed': removed, 'images': entries}
    (ROOT / 'build/asset-optimization-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Runtime assets: {before / 1048576:.2f} -> {after / 1048576:.2f} MiB; '
          f'{len(entries)} WebP images; {len(removed)} unused/reference files excluded')


if __name__ == '__main__':
    optimize()
