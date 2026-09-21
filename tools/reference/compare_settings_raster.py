#!/usr/bin/env python3
"""Compare a settled widescreen Settings page 1 against a browser canvas PNG."""

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

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
    native_image = Image.open(native_path).convert("RGB")
    browser_image = Image.open(browser_path).convert("RGB")
    if browser_image.size != (832, 456) or native_image.height != 456:
        raise ValueError("Use the 832×456 browser canvas and a 456-pixel-high native capture.")

    native = np.asarray(native_image.resize((832, 456), Image.Resampling.BILINEAR))
    browser = np.asarray(browser_image)
    report = {
        "nativeFrame": native_path.name,
        "browserFrame": browser_path.name,
        "nativeSha256": hashlib.sha256(native_path.read_bytes()).hexdigest(),
        "browserSha256": hashlib.sha256(browser_path.read_bytes()).hexdigest(),
        "nativeSize": list(native_image.size),
        "comparisonSize": [832, 456],
        "normalization": (
            "Native width resampled to 832 with Pillow bilinear filtering; "
            "browser pixels unchanged. Calendar hover and native cursor excluded."
        ),
        "regions": {},
    }
    for name, (x0, y0, x1, y1) in REGIONS.items():
        reference = native[y0:y1, x0:x1]
        candidate = browser[y0:y1, x0:x1]
        difference = np.abs(reference.astype(float) - candidate)
        metrics = {
            "rectangle": [x0, y0, x1, y1],
            "meanAbsoluteRgbDifference": float(difference.mean()),
            "equalPixelFraction": float((reference == candidate).all(axis=2).mean()),
        }
        if name != "left-side":
            for label, pixels in (
                ("nativeTextBounds", reference),
                ("browserTextBounds", candidate),
            ):
                ys, xs = np.where(pixels.max(axis=2) < 120)
                metrics[label] = (
                    None
                    if not len(xs)
                    else [
                        int(xs.min() + x0),
                        int(ys.min() + y0),
                        int(xs.max() + x0),
                        int(ys.max() + y0),
                    ]
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
    output = json.dumps(report, indent=2) + "\n"
    if arguments.output:
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        arguments.output.write_text(output)
    else:
        print(output, end="")
