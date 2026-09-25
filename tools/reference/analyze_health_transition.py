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
import hashlib
import json
from pathlib import Path

from raster import RgbImage, read_png

RASTER_SHA256 = hashlib.sha256((Path(__file__).parent / "raster.py").read_bytes()).hexdigest()


def bright_offsets(image, first_row, last_row, threshold):
    offsets = []
    for y in range(first_row, min(last_row, image.height)):
        for x in range(image.width):
            offset = (y * image.width + x) * 3
            if min(image.pixels[offset : offset + 3]) >= threshold:
                offsets.append(offset)
    return offsets


def fitted_alpha(pixels, reference, offsets, denominator):
    numerator = sum(
        pixels[offset + channel] * reference[offset + channel]
        for offset in offsets for channel in range(3)
    )
    return numerator / denominator


def reference_denominator(reference, offsets):
    result = sum(
        reference[offset + channel] ** 2
        for offset in offsets for channel in range(3)
    )
    if not result:
        raise ValueError("The stable endpoint mask contains no bright pixels")
    return result


def frame_metrics(pixels, previous):
    values = pixels.pixels
    changed = 0
    nonblack = 0
    absolute_delta = 0
    for offset in range(0, len(values), 3):
        current = values[offset : offset + 3]
        nonblack += int(any(current))
        if previous is not None:
            earlier = previous.pixels[offset : offset + 3]
            changed += int(current != earlier)
            absolute_delta += sum(abs(value - old) for value, old in zip(current, earlier))
    return {
        "max_rgb": max(values),
        "mean_rgb": sum(values) / len(values),
        "nonblack_pixels": nonblack,
        "changed_pixels": changed,
        "mean_abs_delta": absolute_delta / len(values),
    }


def analyze(capture, start, end, output):
    if end <= start:
        raise ValueError("Health analysis requires distinct start and end frames")
    output.mkdir(parents=True, exist_ok=True)
    frames = {
        number: read_png(capture / "Frames" / f"framedump_{number}.png")
        for number in range(start, end + 1)
    }
    health = frames[start]
    menu = frames[end]
    if any(image.size != health.size for image in frames.values()):
        raise ValueError("Health analysis frames must have matching dimensions")
    # The supplied start/end must be verified stable endpoints. Header excludes
    # the blinking Press A prompt; grid mask excludes all changing channel icons.
    health_mask = bright_offsets(health, 45, 365, 200)
    menu_mask = [
        offset for offset in bright_offsets(menu, 200, menu.height, 180)
        if menu.pixels[offset : offset + 3] == frames[end - 1].pixels[offset : offset + 3]
    ]
    health_denominator = reference_denominator(health.pixels, health_mask)
    menu_denominator = reference_denominator(menu.pixels, menu_mask)
    previous = None
    rows = []
    for number, pixels in frames.items():
        row = {
            "frame": number,
            **frame_metrics(pixels, previous),
            "health_alpha_fit": fitted_alpha(
                pixels.pixels, health.pixels, health_mask, health_denominator
            ),
            "menu_alpha_fit": fitted_alpha(
                pixels.pixels, menu.pixels, menu_mask, menu_denominator
            ),
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
        "resolution": list(health.size),
        "blackFrames": black,
        "blackFrameCount": len(black),
        "healthReferenceFrame": start,
        "menuReferenceFrame": end,
        "healthMaskPixels": len(health_mask),
        "menuMaskPixels": len(menu_mask),
        "alphaMethod": (
            "Least-squares RGB multiplier of verified bright stable endpoint pixels. "
            "An estimate of displayed intensity, not an extracted GX register."
        ),
        "frameSemantics": (
            "Presented-XFB ordinals. Duplicate presented images are retained; "
            "these are not asserted to be game update counters."
        ),
        "rasterDecoder": "first-party RGB PNG",
        "rasterSha256": RASTER_SHA256,
        "contactSheetResampling": "bicubic",
    }
    (output / "health-analysis.json").write_text(format_json(info))
    numbers = list(range(start, end + 1, 5))
    width, columns = 320, 5
    thumbnail_height = round(width * health.height / health.width)
    height = thumbnail_height + 18
    sheet_rows = (len(numbers) + columns - 1) // columns
    sheet = RgbImage.new((width * columns, height * sheet_rows), (25, 25, 25))
    for index, number in enumerate(numbers):
        x, y = index % columns * width, index // columns * height
        thumbnail = frames[number].resize((width, thumbnail_height), "bicubic")
        sheet.paste(thumbnail, (x, y))
        sheet.draw_text((x + 5, y + thumbnail_height + 2), f"XFB {number}", "white")
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
