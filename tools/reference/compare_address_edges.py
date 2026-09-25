#!/usr/bin/env python3
"""Measure the settled 836×456 Address Book cover/page-one left edge."""
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

from raster import RgbImage, read_png


def white_face_extent(image: RgbImage) -> list[list[int]]:
    # The outer white page is visible throughout this range. Its envelope
    # avoids counting interior text, icons and divider rules.
    extents = []
    for y in range(75, 320):
        columns = [x for x in range(220, 626)
                   if min(image.getpixel((x, y))) >= 250]
        if not columns:
            raise ValueError("The expected white book face is absent.")
        extents.append([columns[0], columns[-1]])
    return extents


def compare(native_path: Path, browser_path: Path, page: int) -> dict:
    """Compare unchanged pixels; these bounds apply only to the named poses."""
    native_image = read_png(native_path)
    browser_image = read_png(browser_path)
    if native_image.size != (836, 456) or browser_image.size != native_image.size:
        raise ValueError("Both images must be aligned 836×456 settled book poses.")
    if page not in (0, 1):
        raise ValueError("Only the cover and page-one regions have been established.")
    right = 223 if page == 0 else 221
    x0, y0, x1, y1 = (203, 75, right, 320)
    difference_sum = 0
    maximum_difference = 0
    equal_pixels = 0
    for y in range(y0, y1):
        for x in range(x0, x1):
            reference = native_image.getpixel((x, y))
            candidate = browser_image.getpixel((x, y))
            differences = [abs(left - right) for left, right in zip(reference, candidate)]
            difference_sum += sum(differences)
            maximum_difference = max(maximum_difference, *differences)
            equal_pixels += reference == candidate
    pixel_count = (x1 - x0) * (y1 - y0)
    native_body = white_face_extent(native_image)
    browser_body = white_face_extent(browser_image)
    endpoint_difference = sum(abs(left - right)
                              for native_row, browser_row in zip(native_body, browser_body)
                              for left, right in zip(native_row, browser_row))
    return {
        "pose": "cover" if page == 0 else "page-one",
        "nativeFrame": native_path.name,
        "browserFrame": browser_path.name,
        "nativeSha256": hashlib.sha256(native_path.read_bytes()).hexdigest(),
        "browserSha256": hashlib.sha256(browser_path.read_bytes()).hexdigest(),
        "rasterSha256": hashlib.sha256((Path(__file__).parent / "raster.py").read_bytes()).hexdigest(),
        "comparisonSize": [836, 456],
        "normalization": "None; both input PNGs are compared without resampling.",
        "leftStack": {
            "rectangle": [x0, y0, x1, y1],
            "meanAbsoluteRgbDifference": difference_sum / (pixel_count * 3),
            "maximumAbsoluteComponentDifference": maximum_difference,
            "equalPixelFraction": equal_pixels / pixel_count,
            "sampleRow": 100,
            "nativeRedValues": [native_image.getpixel((x, 100))[0] for x in range(x0, x1)],
            "browserRedValues": [browser_image.getpixel((x, 100))[0] for x in range(x0, x1)],
        },
        "whiteFaceEnvelope": {
            "rows": [75, 320],
            "searchColumns": [220, 626],
            "minimumRgbThreshold": 250,
            "nativeRange": [[min(row[index] for row in native_body) for index in (0, 1)],
                            [max(row[index] for row in native_body) for index in (0, 1)]],
            "browserRange": [[min(row[index] for row in browser_body) for index in (0, 1)],
                             [max(row[index] for row in browser_body) for index in (0, 1)]],
            "matchingRowFraction": sum(left == right for left, right in zip(
                native_body, browser_body)) / len(native_body),
            "meanAbsoluteEndpointDifference": endpoint_difference / (len(native_body) * 2),
        },
        "limits": [
            "The native cursor, background, footer and console-number text are excluded.",
            "A restored line structure does not imply identical GX/VI pixel sampling.",
            "Only a settled cover or page one is measured, not page-turn timing or full-frame equivalence.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("native", type=Path)
    parser.add_argument("browser", type=Path)
    parser.add_argument("--page", type=int, choices=(0, 1), default=0)
    parser.add_argument("--output", type=Path)
    arguments = parser.parse_args()
    report = compare(arguments.native, arguments.browser, arguments.page)
    text = format_json(report)
    if arguments.output:
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        arguments.output.write_text(text)
    else:
        print(text, end="")


if __name__ == "__main__":
    main()
