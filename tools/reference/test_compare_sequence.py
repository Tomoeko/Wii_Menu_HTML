import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image

from compare_sequence import (
    compare, monotonic_alignment, presentation_normalization, read_sequence, region_mask,
)


class SequenceComparisonTests(unittest.TestCase):
    def test_alignment_allows_repeated_and_skipped_native_presentations(self):
        costs = np.array([[0, 9, 9, 9], [1, 9, 9, 9], [9, 9, 0, 9], [9, 9, 1, 0]])
        self.assertEqual(monotonic_alignment(costs), [0, 0, 2, 3])
        # The locally cheapest first sample would prevent the better global path.
        costs = np.array([[1, 9, 0], [0, 9, 100], [9, 0, 100]])
        self.assertEqual(monotonic_alignment(costs), [0, 0, 1])
        with self.assertRaises(ValueError):
            monotonic_alignment(np.array([[np.nan]]))

    def test_regions_reject_invalid_bounds_and_remove_excluded_pixels(self):
        mask = region_mask((4, 3), [[0, 0, 4, 3]], [[1, 1, 3, 3]])
        self.assertEqual(int(mask.sum()), 8)
        self.assertFalse(mask[1, 1])
        for rectangle in ([0, 0, 5, 3], [1, 0, 1, 3], [0, 0, 4.0, 3]):
            with self.assertRaises(ValueError):
                region_mask((4, 3), [rectangle])
        with self.assertRaises(ValueError):
            region_mask((4, 3), [[0, 0, 4, 3]], [[0, 0, 4, 3]])

    def test_manifest_rejects_missing_frames_noncontiguous_updates_and_path_escape(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sidecar = root / 'final.json'
            Image.new('RGB', (4, 3)).save(root / 'first.png')
            Image.new('RGB', (4, 3)).save(root / 'final.png')
            def write(frames, complete=True):
                sidecar.write_text(json.dumps({'comparison': {
                    'total': len(frames),
                    'sequenceManifest': {'complete': complete, 'frames': frames},
                }}))
            frames = [{'frame': 0, 'path': 'first.png'}, {'frame': 1, 'currentCapture': True}]
            write(frames)
            self.assertEqual(len(read_sequence(sidecar, root)[1]), 2)
            for values in (
                [{'frame': 1, 'path': 'first.png'}],
                [{'frame': 0, 'path': 'missing.png'}],
                [{'frame': 0, 'path': '../outside.png'}],
                [{'frame': 0, 'path': str(root / 'first.png')}],
                [{'frame': 0, 'currentCapture': True}, {'frame': 1, 'path': 'first.png'}],
            ):
                write(values)
                with self.assertRaises(ValueError):
                    read_sequence(sidecar, root)
            write(frames, complete=False)
            with self.assertRaises(ValueError):
                read_sequence(sidecar, root)

    def test_report_and_contact_sheet_exclude_private_pixels(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            native = root / 'native'
            native.mkdir()
            for index, value in enumerate((10, 20, 30)):
                image = Image.new('RGB', (4, 3), (value, value, value))
                image.putpixel((1, 1), (255, 0, 0))
                image.save(native / f'framedump_{index + 7}.png')
            for name, value in (('first.png', 10), ('final.png', 30)):
                Image.new('RGB', (4, 3), (value, value, value)).save(root / name)
            sidecar = root / 'final.json'
            sidecar.write_text(json.dumps({'width': 4, 'height': 3, 'comparison': {
                'total': 2,
                'frameConvention': 'Explicit browser updates',
                'sequenceManifest': {'complete': True, 'frames': [
                    {'frame': 0, 'path': 'first.png'}, {'frame': 1, 'currentCapture': True},
                ]},
            }}))
            configuration = {
                'size': [4, 3], 'alignmentRegions': [[0, 0, 4, 3]],
                'measurementRegions': {'public': [[0, 0, 4, 3]]},
                'exclusions': [[1, 1, 2, 2]],
            }
            report = compare(sidecar, root, native, 7, 9, configuration, root / 'output')
            self.assertNotIn('nativePresentationNormalization', report)
            self.assertIn('No image resampling', report['method'])
            self.assertFalse(report['authoredSourceSnapshot']['available'])
            snapshot = root / 'sources.json'
            snapshot.write_text(json.dumps({'sidecars': ['other.json'], 'files': []}))
            with self.assertRaisesRegex(ValueError, 'explicitly identify'):
                compare(sidecar, root, native, 7, 9, configuration, root / 'output',
                        authored_source_snapshot=snapshot)
            snapshot.write_text(json.dumps({
                'sidecars': ['final.json'],
                'files': [{'path': 'renderer.js', 'sha256': 'a' * 64}],
            }))
            report = compare(sidecar, root, native, 7, 9, configuration, root / 'output',
                             authored_source_snapshot=snapshot)
            self.assertTrue(report['authoredSourceSnapshot']['available'])
            self.assertEqual(report['authoredSourceSnapshot']['files'][0]['sha256'], 'a' * 64)
            self.assertEqual([pair['nativeOrdinal'] for pair in report['pairs']], [7, 9])
            self.assertEqual(report['pairs'][0]['regions']['public']['meanAbsoluteRgbDifference'], 0)
            self.assertNotIn(str(root), json.dumps(report))
            with Image.open(root / 'output/contact-sheet.png') as sheet:
                self.assertEqual(sheet.getpixel((1, 25)), (24, 24, 24))

    def test_horizontal_mapping_requires_recorded_geometry_and_an_explicit_filter(self):
        valid = {'size': [640, 456], 'nativePresentation': {
            'sourceSize': [836, 456], 'resample': 'lanczos',
        }}
        result = presentation_normalization(valid)
        self.assertEqual(result['sourceSize'], [836, 456])
        self.assertEqual(result['comparisonSize'], [640, 456])
        self.assertEqual(result['scale'], [640 / 836, 1])
        self.assertEqual(result['resample'], 'lanczos')
        self.assertIn('pillowVersion', result)
        self.assertIn('numpyVersion', result)
        for mapping in (
            None, [], {}, {'resample': 'lanczos'}, {'sourceSize': [836, 456]},
            {'sourceSize': [836, 480], 'resample': 'lanczos'},
            {'sourceSize': [640, 456], 'resample': 'lanczos'},
            {'sourceSize': [0, 456], 'resample': 'lanczos'},
            {'sourceSize': [836.0, 456], 'resample': 'lanczos'},
            {'sourceSize': [True, 456], 'resample': 'lanczos'},
            {'sourceSize': [836, 456], 'resample': 'unknown'},
            {'sourceSize': [836, 456], 'resample': ['lanczos']},
            {'sourceSize': [836, 456], 'resample': 'lanczos', 'offset': 2},
        ):
            with self.subTest(mapping=mapping), self.assertRaises(ValueError):
                presentation_normalization({'size': [640, 456], 'nativePresentation': mapping})
        for size in (None, [], [640], [0, 456], [640, -1], [640, 456.0]):
            with self.subTest(size=size), self.assertRaises(ValueError):
                presentation_normalization({'size': size})

    def test_only_native_width_is_normalized_and_raw_files_remain_hashed_and_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            native = root / 'native'
            native.mkdir()
            source_path = native / 'framedump_7.png'
            browser_path = root / 'final.png'
            source = Image.new('RGB', (8, 3))
            browser = Image.new('RGB', (4, 3))
            for y in range(3):
                for x in range(8):
                    source.putpixel((x, y), (x * 30, y * 40, 0))
                # Nearest 8-to-4 mapping samples native columns 1, 3, 5 and 7.
                for x, red in enumerate((30, 90, 150, 210)):
                    browser.putpixel((x, y), (red, y * 40, 0))
            source.save(source_path)
            browser.save(browser_path)
            original = {path: path.read_bytes() for path in (source_path, browser_path)}
            sidecar = root / 'final.json'
            sidecar.write_text(json.dumps({'width': 4, 'height': 3, 'comparison': {
                'total': 1, 'sequenceManifest': {'complete': True, 'frames': [
                    {'frame': 0, 'currentCapture': True},
                ]},
            }}))
            configuration = {
                'size': [4, 3], 'alignmentRegions': [[0, 0, 4, 3]],
                'measurementRegions': {'public': [[0, 0, 4, 3]]},
            }
            with self.assertRaisesRegex(ValueError, 'Unexpected image dimensions'):
                compare(sidecar, root, native, 7, 7, configuration, root / 'direct')
            self.assertFalse((root / 'direct').exists())
            configuration['nativePresentation'] = {'sourceSize': [8, 3], 'resample': 'nearest'}
            report = compare(sidecar, root, native, 7, 7, configuration, root / 'normalized')
            self.assertIn('horizontally resampled with nearest', report['method'])
            self.assertTrue(any('not original native-pixel equality' in note for note in report['limits']))
            self.assertEqual(report['pairs'][0]['regions']['public'], {
                'pixels': 12, 'meanAbsoluteRgbDifference': 0, 'equalPixelFraction': 1,
            })
            self.assertEqual(report['nativeFrames'][0]['sha256'], hashlib.sha256(original[source_path]).hexdigest())
            self.assertEqual(report['browserFrames'][0]['sha256'], hashlib.sha256(original[browser_path]).hexdigest())
            for path, content in original.items():
                self.assertEqual(path.read_bytes(), content)
            with Image.open(root / 'normalized/contact-sheet.png') as sheet:
                self.assertEqual(sheet.size, (8, 27))
                self.assertEqual(sheet.getpixel((3, 26)), (210, 80, 0))
                self.assertEqual(sheet.getpixel((7, 26)), (210, 80, 0))
            configuration['nativePresentation']['resample'] = 'lanczos'
            report = compare(sidecar, root, native, 7, 7, configuration, root / 'lanczos')
            self.assertEqual(report['nativePresentationNormalization']['resample'], 'lanczos')
            self.assertGreater(report['pairs'][0]['regions']['public']['meanAbsoluteRgbDifference'], 0)
            configuration['nativePresentation']['sourceSize'] = [9, 3]
            with self.assertRaisesRegex(ValueError, 'Unexpected image dimensions'):
                compare(sidecar, root, native, 7, 7, configuration, root / 'wrong-source')
            configuration['nativePresentation']['sourceSize'] = [8, 3]
            Image.new('RGB', (8, 3)).save(browser_path)
            with self.assertRaisesRegex(ValueError, 'Unexpected image dimensions'):
                compare(sidecar, root, native, 7, 7, configuration, root / 'wrong-browser')


if __name__ == '__main__':
    unittest.main()
