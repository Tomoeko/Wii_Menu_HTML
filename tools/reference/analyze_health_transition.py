#!/usr/bin/env python3
"""Measure a captured health-to-menu sequence without treating XFBs as game ticks."""
try:
    from tools.json_format import format_json
except ModuleNotFoundError:  # Direct execution from a tools subdirectory.
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from json_format import format_json

import argparse
import csv
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


def fitted_alpha(pixels, reference, mask):
    selected = reference[mask]
    return float(np.sum(pixels[mask] * selected) / np.sum(selected**2))


def analyze(capture, start, end, output):
    output.mkdir(parents=True, exist_ok=True)
    frames = {
        number: np.asarray(
            Image.open(capture / "Frames" / f"framedump_{number}.png").convert("RGB")
        )
        for number in range(start, end + 1)
    }
    health = frames[start].astype(np.float64)
    menu = frames[end].astype(np.float64)
    # The supplied start/end must be verified stable endpoints. Header excludes
    # the blinking Press A prompt; grid mask excludes all changing channel icons.
    health_mask = np.zeros(health.shape[:2], dtype=bool)
    health_mask[45:365] = health[45:365].min(axis=2) >= 200
    menu_mask = (frames[end] == frames[end - 1]).all(axis=2) & (menu.min(axis=2) >= 180)
    menu_mask[:200] = False
    previous = None
    rows = []
    for number, pixels in frames.items():
        data = pixels.astype(np.float64)
        row = {
            "frame": number,
            "max_rgb": int(pixels.max()),
            "mean_rgb": float(data.mean()),
            "nonblack_pixels": int((pixels.max(axis=2) > 0).sum()),
            "changed_pixels": (
                0 if previous is None else int((pixels != previous).any(axis=2).sum())
            ),
            "mean_abs_delta": (0 if previous is None else float(np.abs(data - previous).mean())),
            "health_alpha_fit": fitted_alpha(data, health, health_mask),
            "menu_alpha_fit": fitted_alpha(data, menu, menu_mask),
        }
        rows.append(row)
        previous = pixels
    with (output / "health-frame-metrics.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
    black = [row["frame"] for row in rows if row["nonblack_pixels"] == 0]
    info = {
        "firstFrame": start,
        "lastFrame": end,
        "frameCount": len(rows),
        "resolution": list(frames[start].shape[1::-1]),
        "blackFrames": black,
        "blackFrameCount": len(black),
        "healthReferenceFrame": start,
        "menuReferenceFrame": end,
        "healthMaskPixels": int(health_mask.sum()),
        "menuMaskPixels": int(menu_mask.sum()),
        "alphaMethod": (
            "Least-squares RGB multiplier of verified bright stable endpoint pixels. "
            "An estimate of displayed intensity, not an extracted GX register."
        ),
        "frameSemantics": (
            "Presented-XFB ordinals. Duplicate presented images are retained; "
            "these are not asserted to be game update counters."
        ),
    }
    (output / "health-analysis.json").write_text(format_json(info))
    numbers = list(range(start, end + 1, 5))
    width, columns = 320, 5
    thumbnail_height = round(width * frames[start].shape[0] / frames[start].shape[1])
    height = thumbnail_height + 18
    sheet_rows = (len(numbers) + columns - 1) // columns
    sheet = Image.new("RGB", (width * columns, height * sheet_rows), (25, 25, 25))
    draw = ImageDraw.Draw(sheet)
    for index, number in enumerate(numbers):
        x, y = index % columns * width, index // columns * height
        thumbnail = Image.fromarray(frames[number]).resize((width, thumbnail_height))
        sheet.paste(thumbnail, (x, y))
        draw.text((x + 5, y + thumbnail_height + 2), f"XFB {number}", fill="white")
    sheet.save(output / "health-contact-sheet.png")
    return info, rows


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capture", type=Path)
    parser.add_argument("--start", type=int, required=True)
    parser.add_argument("--end", type=int, required=True)
    parser.add_argument("--output", type=Path)
    options = parser.parse_args()
    output = options.output or options.capture / "analysis/health"
    info, rows = analyze(options.capture, options.start, options.end, output)
    print(json.dumps(info, indent=2))
    for row in rows:
        if row["changed_pixels"] or row["frame"] in (options.start, options.end):
            print(
                row["frame"],
                round(row["health_alpha_fit"], 4),
                round(row["menu_alpha_fit"], 4),
                row["max_rgb"],
            )
