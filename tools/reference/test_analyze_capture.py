import csv
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image

from analyze_capture import BOXES, WIDE_BOXES, analyze, resolve_regions


class IconCaptureAnalysisTests(unittest.TestCase):
    def test_aspect_presets_preserve_narrow_coordinates_and_reject_other_sizes(self):
        narrow = resolve_regions("4:3", (640, 480))
        wide = resolve_regions("16:9", (836, 456))
        self.assertEqual([r["box"] for r in narrow], [list(box) for box in BOXES])
        self.assertEqual([r["box"] for r in wide], [list(box) for box in WIDE_BOXES])
        self.assertEqual(wide[0]["box"], [70, 39, 238, 126])
        self.assertEqual(wide[-1]["box"], [600, 231, 767, 318])
        with self.assertRaisesRegex(ValueError, "instead of rescaling"):
            resolve_regions("16:9", (832, 456))

    def test_explicit_regions_reject_clipped_and_duplicate_rectangles(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "regions.json"
            path.write_text(
                json.dumps(
                    {"resolution": [8, 6], "regions": [{"name": "bad", "box": [7, 0, 9, 2]}]}
                )
            )
            with self.assertRaisesRegex(ValueError, "extends outside"):
                resolve_regions("4:3", (8, 6), path)
            path.write_text(
                json.dumps(
                    {
                        "resolution": [8, 6],
                        "regions": [
                            {"name": "same", "box": [0, 0, 1, 1]},
                            {"name": "same", "box": [1, 1, 2, 2]},
                        ],
                    }
                )
            )
            with self.assertRaisesRegex(ValueError, "unique"):
                resolve_regions("4:3", (8, 6), path)

    def test_metrics_and_atlas_lookup_preserve_different_sized_original_crops(self):
        with tempfile.TemporaryDirectory() as directory:
            capture = Path(directory) / "capture"
            (capture / "Frames").mkdir(parents=True)
            definition = {
                "resolution": [8, 6],
                "regions": [
                    {"name": "static", "box": [1, 2, 5, 5]},
                    {"name": "moving", "box": [5, 0, 8, 2]},
                ],
            }
            regions = Path(directory) / "regions.json"
            regions.write_text(json.dumps(definition))
            for number in range(7, 128):
                image = Image.new("RGB", (8, 6), (10, 20, 30))
                image.putpixel((0, 5), (number, 0, 0))  # Outside both measured rectangles.
                image.putpixel((6, 1), (number, 20, 30))
                image.save(capture / "Frames" / f"framedump_{number}.png")
            output = Path(directory) / "analysis"
            report = analyze(capture, output, 7, 127, region_file=regions)
            self.assertEqual(report["frameCount"], 121)
            self.assertEqual(report["slots"][0]["changedTransitions"], 0)
            self.assertEqual(report["slots"][1]["changedTransitions"], 120)
            self.assertAlmostEqual(report["slots"][1]["meanFrameDelta"], 1 / 18)
            self.assertEqual(len(report["atlas"]["files"]), 4)
            with (output / "frame-metrics.csv").open() as file:
                rows = list(csv.DictReader(file))
            self.assertEqual(len(rows), 242)
            for number in (7, 126, 127):
                with Image.open(capture / "Frames" / f"framedump_{number}.png") as image:
                    for slot, region in enumerate(definition["regions"], 1):
                        record = next(
                            r
                            for r in report["atlas"]["files"]
                            if r["slot"] == slot and r["firstFrame"] <= number <= r["lastFrame"]
                        )
                        width, height = record["cropWidth"], record["cropHeight"]
                        offset = number - record["firstFrame"]
                        left, top = offset % 12 * width, offset // 12 * height
                        with Image.open(output / record["file"]) as atlas:
                            actual = atlas.crop((left, top, left + width, top + height))
                        expected = image.crop(region["box"])
                        np.testing.assert_array_equal(np.asarray(actual), np.asarray(expected))
                        row = next(
                            r for r in rows if int(r["frame"]) == number and int(r["slot"]) == slot
                        )
                        self.assertEqual(
                            row["crop_sha256"], hashlib.sha256(expected.tobytes()).hexdigest()
                        )


if __name__ == "__main__":
    unittest.main()
