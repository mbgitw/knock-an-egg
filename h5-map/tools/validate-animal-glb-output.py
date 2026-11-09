"""Audit the final local build and browser evidence; never publishes anything."""
from pathlib import Path
from zipfile import ZipFile
from PIL import Image, ImageChops, ImageStat
import hashlib
import json
import struct

root = Path(__file__).resolve().parents[1]
build = root / 'build/builda-draft'
out = root.parent / 'outputs/animal-glb-migration'
read = lambda path: json.loads(path.read_text(encoding='utf-8'))
catalog = read(build / 'gameplay/animal-glb/catalog.json')
assert len(catalog['entries']) == 92
assert read(build / 'draft-preview-config.json') == {'enabled': False, 'diagnostics': False}
assert not (build / 'plot-test.html').exists()
asset_hashes = {}
for name, entry in catalog['entries'].items():
    path = build / 'gameplay/animal-glb' / entry['file']
    raw = path.read_bytes()
    assert raw[:4] == b'glTF' and struct.unpack_from('<I', raw, 8)[0] == len(raw)
    data = json.loads(raw[20:20+struct.unpack_from('<I', raw, 12)[0]])
    assert len(data.get('skins', [])) == 1
    assert all('uri' not in image for image in data.get('images', []))
    assert {animation['name'] for animation in data['animations']} == {'Idle', 'Walk'}
    asset_hashes[name] = hashlib.sha256(raw).hexdigest()
for folder in ['animals', 'paid-animals']:
    for entry in read(build / f'model-check/{folder}/catalog.json'):
        assert entry['format'] == 'animal-glb'
        assert (build / 'model-check' / entry['glb']).resolve().is_file()
runtime = read(out / 'runtime-validation.json')
gameplay = read(out / 'gameplay-validation.json')
assert len(runtime['validations']) == 92
assert all(item['parentTransformError'] < 1e-3 for item in runtime['validations'])
assert not runtime['errors'] and not runtime['responses']
assert not gameplay['errors'] and not gameplay['responses']
assert len(gameplay['gameplay']['checks']) == 6
assert gameplay['gameplay']['legacyRigRequests'] == 0
visual = []
for name in ['Chicken', 'CrystalDragon', 'CelestialBeast', 'AngelHydra']:
    for variant in ['Normal', 'Gold', 'Diamond']:
        with Image.open(out / f'{name}-{variant}.png') as image:
            image = image.convert('RGB')
            difference = ImageChops.difference(image.crop((0, 0, 600, 600)), image.crop((600, 0, 1200, 600)))
            mean = sum(ImageStat.Stat(difference).mean) / 3
            assert mean < .05, (name, variant, mean)
            visual.append({'name': name, 'variant': variant, 'meanAbsoluteChannelError255': mean})
pruning = read(root / 'build/animal-glb-pruning.json')
baseline = root / 'build/animal-glb-baseline.zip'
optimized = root / 'build/animal-glb-optimized-local.zip'
with ZipFile(baseline) as archive:
    removed_zip_bytes = sum(archive.getinfo(name).compress_size for name in pruning['removed'])
with ZipFile(optimized) as archive:
    compiled_zip_bytes = sum(entry.compress_size for entry in archive.infolist() if entry.filename.startswith('gameplay/animal-glb/'))
    assert not any(name.endswith('-test.html') for name in archive.namelist())
summary = {'animals': 92, 'baselineZipBytes': baseline.stat().st_size, 'optimizedZipBytes': optimized.stat().st_size,
           'removedLegacyFiles': len(pruning['removed']), 'removedLegacyRawBytes': pruning['bytes'],
           'removedLegacyZipBytes': removed_zip_bytes, 'compiledAnimalZipBytes': compiled_zip_bytes,
           'maxStaticVertexError': max(item['staticError'] for item in runtime['validations']),
           'maxAnimatedVertexError': max(item['animationError'] for item in runtime['validations']),
           'maxParentTransformError': max(item['parentTransformError'] for item in runtime['validations']),
           'runtime': runtime, 'gameplay': gameplay, 'visualChecks': visual,
           'benchmarks': read(out / 'benchmark.json')['benchmarks'], 'assetSha256': asset_hashes,
           'uploaded': False, 'serverDeployed': False}
(out / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(f"PASS: 92 assets, 12 render comparisons, six gameplay checks; local ZIP {summary['baselineZipBytes']} -> {summary['optimizedZipBytes']} bytes")
