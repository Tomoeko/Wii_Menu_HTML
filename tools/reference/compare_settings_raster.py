#!/usr/bin/env python3
"""Compare a settled widescreen Settings page 1 against a browser canvas PNG."""
try:
    from tools.json_format import format_json
except ModuleNotFoundError:  # Direct execution from a tools subdirectory.
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from json_format import format_json

import argparse
import hashlib
import json
from pathlib import Path

from raster import read_png

# These regions exclude the Calendar hover and pointer in the fresh native
# reference. They intentionally describe page 1, not arbitrary Settings pages.
REGIONS = {
    "header": (140, 27, 500, 59),
    "nickname": (230, 85, 598, 130),
    "screen": (230, 226, 574, 272),
    "sound": (230, 298, 598, 344),
    "back": (165, 384, 390, 427),
    "left-side": (0, 0, 110, 456),
}


def compare(native_path, browser_path):
    native_image = read_png(native_path)
    browser_image = read_png(browser_path)
    if browser_image.size != (832, 456) or native_image.height != 456:
        raise ValueError("Use the 832×456 browser canvas and a 456-pixel-high native capture.")

    native = native_image.resize((832, 456), "bilinear")
    browser = browser_image
    report = {
        "nativeFrame": native_path.name,
        "browserFrame": browser_path.name,
        "nativeSha256": hashlib.sha256(native_path.read_bytes()).hexdigest(),
        "browserSha256": hashlib.sha256(browser_path.read_bytes()).hexdigest(),
        "nativeSize": list(native_image.size),
        "comparisonSize": [832, 456],
        "normalization": (
            "Native width resampled to 832 with the first-party bilinear filter; "
            "browser pixels unchanged. Calendar hover and native cursor excluded."
        ),
        "rasterSha256": hashlib.sha256((Path(__file__).parent / "raster.py").read_bytes()).hexdigest(),
        "regions": {},
    }
    for name, (x0, y0, x1, y1) in REGIONS.items():
        difference_sum = 0
        matching_pixels = 0
        bounds = {"nativeTextBounds": [], "browserTextBounds": []}
        for y in range(y0, y1):
            for x in range(x0, x1):
                reference = native.getpixel((x, y))
                candidate = browser.getpixel((x, y))
                difference_sum += sum(abs(left - right)
                                      for left, right in zip(reference, candidate))
                matching_pixels += reference == candidate
                if name != "left-side":
                    if max(reference) < 120:
                        bounds["nativeTextBounds"].append((x, y))
                    if max(candidate) < 120:
                        bounds["browserTextBounds"].append((x, y))
        pixel_count = (x1 - x0) * (y1 - y0)
        metrics = {
            "rectangle": [x0, y0, x1, y1],
            "meanAbsoluteRgbDifference": difference_sum / (pixel_count * 3),
            "equalPixelFraction": matching_pixels / pixel_count,
        }
        if name != "left-side":
            for label, points in bounds.items():
                metrics[label] = (
                    [min(x for x, _ in points), min(y for _, y in points),
                     max(x for x, _ in points), max(y for _, y in points)]
                    if points else None
                )
        report["regions"][name] = metrics
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("native", type=Path)
    parser.add_argument("browser", type=Path)
    parser.add_argument("--output", type=Path)
    arguments = parser.parse_args()
    report = compare(arguments.native, arguments.browser)
    output = format_json(report)
    if arguments.output:
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        arguments.output.write_text(output)
    else:
        print(output, end="")
