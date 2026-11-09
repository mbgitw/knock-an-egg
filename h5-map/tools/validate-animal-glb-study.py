"""Verify generated pilot results, not production resources."""
from pathlib import Path
from PIL import Image, ImageChops, ImageStat
import json
import struct
import hashlib

folder = Path(__file__).resolve().parents[1] / 'build/animal-glb-study'
report = json.loads((folder / 'report.json').read_text(encoding='utf-8'))
assert not report['errors'], report['errors']
visual = []
for sample in report['reports']:
    name = sample['name']
    assert sample['maxVertexError'] < 1e-3
    assert sample['optimized']['maxVertexError'] < 1e-3
    assert sample['optimized']['independentSkeletons']
    assert sample['optimized']['sharedGeometry']
    assert sample['optimized']['skeletonsPerInstance'] == 1
    assert sample['colorError'] < 1e-5
    assert not any(variant.get('missing') for variant in sample['variantChecks'])
    path = folder / (name + '-optimized.glb')
    raw = path.read_bytes()
    assert raw[:4] == b'glTF' and struct.unpack_from('<I', raw, 8)[0] == len(raw)
    sample['optimized']['sha256'] = hashlib.sha256(raw).hexdigest()
    for variant in ['Normal', 'Gold', 'Diamond']:
        with Image.open(folder / f'{name}-{variant}.png') as image:
            image = image.convert('RGB')
            assert image.width == 1200 and image.height >= 600, image.size
            difference = ImageChops.difference(image.crop((0, 0, 600, 600)), image.crop((600, 0, 1200, 600)))
            mean = sum(ImageStat.Stat(difference).mean) / 3
            assert mean < .05, (name, variant, mean)
            visual.append({'name': name, 'variant': variant, 'meanAbsoluteChannelError255': mean})
report['visualChecks'] = visual
(folder / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print('PASS: two animated GLBs, independent skeletons/shared geometry, full-vertex poses and six render comparisons')
