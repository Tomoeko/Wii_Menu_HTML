#!/usr/bin/env python3
"""Measure the settled 836×456 Address Book cover/page-one left edge."""

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image


def compare(native_path: Path, browser_path: Path, page: int) -> dict:
    """Compare unchanged pixels; these bounds apply only to the named poses."""
    native_image = Image.open(native_path).convert("RGB")
    browser_image = Image.open(browser_path).convert("RGB")
    if native_image.size != (836, 456) or browser_image.size != native_image.size:
        raise ValueError("Both images must be aligned 836×456 settled book poses.")
    if page not in (0, 1):
        raise ValueError("Only the cover and page-one regions have been established.")
    native = np.asarray(native_image)
    browser = np.asarray(browser_image)
    right = 223 if page == 0 else 221
    x0, y0, x1, y1 = (203, 75, right, 320)
    reference = native[y0:y1, x0:x1]
    candidate = browser[y0:y1, x0:x1]
    difference = np.abs(reference.astype(float) - candidate)

    def body_extent(pixels):
        # The outer white page is visible throughout this range. Taking its
        # envelope avoids counting interior text, icons and divider rules.
        body = (pixels[75:320, 220:626].min(axis=2) >= 250)
        extents = []
        for row in body:
            columns = np.flatnonzero(row)
            if not len(columns):
                raise ValueError("The expected white book face is absent.")
            extents.append([int(columns[0] + 220), int(columns[-1] + 220)])
        return np.asarray(extents)

    native_body = body_extent(native)
    browser_body = body_extent(browser)
    return {
        "pose": "cover" if page == 0 else "page-one",
        "nativeFrame": native_path.name,
        "browserFrame": browser_path.name,
        "nativeSha256": hashlib.sha256(native_path.read_bytes()).hexdigest(),
        "browserSha256": hashlib.sha256(browser_path.read_bytes()).hexdigest(),
        "comparisonSize": [836, 456],
        "normalization": "None; both input PNGs are compared without resampling.",
        "leftStack": {
            "rectangle": [x0, y0, x1, y1],
            "meanAbsoluteRgbDifference": float(difference.mean()),
            "maximumAbsoluteComponentDifference": int(difference.max()),
            "equalPixelFraction": float((reference == candidate).all(axis=2).mean()),
            "sampleRow": 100,
            "nativeRedValues": native[100, x0:x1, 0].tolist(),
            "browserRedValues": browser[100, x0:x1, 0].tolist(),
        },
        "whiteFaceEnvelope": {
            "rows": [75, 320],
            "searchColumns": [220, 626],
            "minimumRgbThreshold": 250,
            "nativeRange": [native_body.min(axis=0).tolist(), native_body.max(axis=0).tolist()],
            "browserRange": [browser_body.min(axis=0).tolist(), browser_body.max(axis=0).tolist()],
            "matchingRowFraction": float((native_body == browser_body).all(axis=1).mean()),
            "meanAbsoluteEndpointDifference": float(np.abs(native_body - browser_body).mean()),
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
    text = json.dumps(report, indent=2) + "\n"
    if arguments.output:
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        arguments.output.write_text(text)
    else:
        print(text, end="")


if __name__ == "__main__":
    main()
