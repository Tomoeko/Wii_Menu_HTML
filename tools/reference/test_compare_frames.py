import unittest

import numpy as np
from PIL import Image

from compare_frames import compare


class FrameComparisonTests(unittest.TestCase):
    def test_nearest_uses_pixel_centers_and_preserves_native_sample_coordinates(self):
        reference = Image.fromarray(np.arange(48, dtype=np.uint8).reshape((4, 4, 3)))
        candidate = Image.fromarray(np.asarray(reference)[1::2, 1::2])
        report = compare(reference, candidate, [("all", (0, 0, 2, 2))], [(0, 0), (1, 1)], "nearest")
        self.assertEqual(report["regions"][0]["changedPixelCount"], 0)
        self.assertEqual(report["samples"][0]["referenceNearestPixel"], [1, 1])
        self.assertEqual(report["samples"][1]["referenceNearestPixel"], [3, 3])
        self.assertEqual(report["normalization"]["referenceRawSize"], (4, 4))

    def test_metrics_exclude_unselected_pixels_and_report_channel_errors(self):
        reference = Image.new("RGB", (4, 4), (10, 20, 30))
        candidate = reference.copy()
        candidate.putpixel((3, 3), (255, 255, 255))
        candidate.putpixel((0, 0), (11, 18, 33))
        report = compare(reference, candidate, [("flat", (0, 0, 2, 2))], [], "nearest")
        region = report["regions"][0]
        self.assertEqual(region["changedPixelCount"], 1)
        self.assertEqual(region["meanAbsoluteRGB"], [0.25, 0.5, 0.75])
        self.assertEqual(region["maxAbsoluteRGB"], [1, 2, 3])

    def test_rejects_aspect_stretch_and_out_of_bounds_regions(self):
        image = Image.new("RGB", (4, 3))
        with self.assertRaisesRegex(ValueError, "Aspect ratios differ"):
            compare(image, Image.new("RGB", (4, 4)), [], [], "nearest")
        with self.assertRaisesRegex(ValueError, "extends outside"):
            compare(image, image, [("bad", (3, 0, 2, 1))], [], "nearest")


if __name__ == "__main__":
    unittest.main()
