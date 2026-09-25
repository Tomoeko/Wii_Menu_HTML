import tempfile
import unittest
from pathlib import Path

from compare_address_edges import compare as compare_address
from compare_settings_raster import compare as compare_settings
from raster import RgbImage


class RegionComparisonTests(unittest.TestCase):
    def test_address_metrics_use_only_selected_stack_and_white_face(self):
        with tempfile.TemporaryDirectory() as directory:
            native_path = Path(directory) / "native.png"
            browser_path = Path(directory) / "browser.png"
            native = RgbImage.new((836, 456), "white")
            browser = native.copy()
            browser.putpixel((203, 75), (254, 255, 255))
            browser.putpixel((10, 10), "black")
            native.save(native_path)
            browser.save(browser_path)

            report = compare_address(native_path, browser_path, 0)

            self.assertEqual(report["leftStack"]["maximumAbsoluteComponentDifference"], 1)
            self.assertEqual(report["whiteFaceEnvelope"]["matchingRowFraction"], 1)

    def test_settings_region_excludes_pixels_outside_named_rectangles(self):
        with tempfile.TemporaryDirectory() as directory:
            native_path = Path(directory) / "native.png"
            browser_path = Path(directory) / "browser.png"
            native = RgbImage.new((832, 456), "white")
            browser = native.copy()
            browser.putpixel((140, 27), "black")
            browser.putpixel((700, 400), "black")
            native.save(native_path)
            browser.save(browser_path)

            report = compare_settings(native_path, browser_path)

            self.assertEqual(report["regions"]["header"]["browserTextBounds"],
                             [140, 27, 140, 27])
            self.assertEqual(report["regions"]["nickname"]["equalPixelFraction"], 1)


if __name__ == "__main__":
    unittest.main()
