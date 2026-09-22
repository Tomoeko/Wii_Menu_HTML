#!/usr/bin/env python3
"""Measure captured icon frames and retain original-pixel crops in indexed PNG atlases."""

from __future__ import annotations

try:
    from tools.json_format import format_json
except ModuleNotFoundError:  # Direct execution from a tools subdirectory.
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from json_format import format_json

import argparse
import csv
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil

import numpy as np
from PIL import Image, ImageDraw

NAMES = [
    "Disc",
    "Mii",
    "Photo",
    "Wii Shop",
    "Forecast",
    "News",
    "Wii + Internet",
    "Nintendo",
    "Internet",
    "Check Mii Out",
    "Everybody Votes",
    "Netflix",
]
# Coordinates are capture pixels, not the menu's logical projection. Right and
# bottom are exclusive, matching Pillow.crop and NumPy array slices.
BOXES = [(x, y, x + 125, y + 94) for y in (40, 142, 242) for x in (55, 190, 325, 460)]
WIDE_BOXES = [
    (left, top, right, bottom)
    for top, bottom in ((39, 126), (136, 222), (231, 318))
    for left, right in ((70, 238), (247, 415), (422, 590), (600, 767))
]
PRESETS = {"4:3": ((640, 480), BOXES), "16:9": ((836, 456), WIDE_BOXES)}
ATLAS_COLUMNS = 12
ATLAS_ROWS = 10
ATLAS_LENGTH = ATLAS_COLUMNS * ATLAS_ROWS


def resolve_regions(aspect: str, image_size: tuple[int, int], region_file: Path | None = None):
    """Select an explicit pixel preset, or validate named rectangles from JSON."""
    if region_file:
        definition = json.loads(region_file.read_text())
        expected_size = tuple(definition["resolution"])
        regions = definition["regions"]
    else:
        expected_size, boxes = PRESETS[aspect]
        regions = [{"name": name, "box": list(box)} for name, box in zip(NAMES, boxes)]
    if image_size != expected_size:
        raise ValueError(
            f"Regions require {expected_size}, but captured image is {image_size}; "
            "provide --regions for this capture geometry instead of rescaling it"
        )
    if not regions:
        raise ValueError("At least one named region is required")
    names = set()
    for region in regions:
        name, box = region.get("name"), region.get("box")
        if not isinstance(name, str) or not name or name in names:
            raise ValueError("Region names must be nonempty and unique")
        names.add(name)
        if (
            not isinstance(box, (list, tuple))
            or len(box) != 4
            or any(type(n) is not int for n in box)
        ):
            raise ValueError(f"{name}: box must contain four integer pixel coordinates")
        left, top, right, bottom = box
        if not (0 <= left < right <= image_size[0] and 0 <= top < bottom <= image_size[1]):
            raise ValueError(f"{name}: rectangle {box} extends outside {image_size} or has no area")
    return [{"name": region["name"], "box": list(region["box"])} for region in regions]


def frame_path(capture: Path, number: int) -> Path:
    return capture / "Frames" / f"framedump_{number}.png"


def analyze(
    capture: Path,
    output: Path,
    start: int,
    end: int,
    *,
    aspect: str = "4:3",
    region_file: Path | None = None,
    duplicate_xfb_skipping: str = "unknown",
    notes: list[str] | None = None,
) -> dict:
    if end < start:
        raise ValueError("End frame precedes start frame")
    capture, output = capture.resolve(), output.resolve()
    with Image.open(frame_path(capture, start)) as first:
        resolution = first.size
    regions = resolve_regions(aspect, resolution, region_file)
    output.mkdir(parents=True, exist_ok=True)
    (output / "crops").mkdir(exist_ok=True)
    frames = range(start, end + 1)
    sample_frames = sorted(set(int(n) for n in np.linspace(start, end, 9)))
    samples, previous, atlases = {}, None, None
    metrics = [[] for _ in regions]
    hashes = [set() for _ in regions]
    atlas_records, source_records = [], []
    with (output / "frame-metrics.csv").open("w", newline="") as file:
        writer = csv.writer(file)
        writer.writerow(
            [
                "frame",
                "slot",
                "channel",
                "mean_abs_rgb_delta_0_255",
                "fraction_pixels_delta_gt_2",
                "max_channel_delta",
                "crop_sha256",
            ]
        )
        for relative, number in enumerate(frames):
            path = frame_path(capture, number)
            with Image.open(path) as source_image:
                image = source_image.convert("RGB")
            if image.size != resolution:
                raise ValueError(f"Capture resolution changed to {image.size} in {path}")
            pixels = np.asarray(image)
            source_records.append(
                {"frame": number, "rgbSha256": hashlib.sha256(pixels.tobytes()).hexdigest()}
            )
            if number in sample_frames:
                samples[number] = image.copy()
            atlas_index, atlas_offset = divmod(relative, ATLAS_LENGTH)
            if atlas_offset == 0:
                atlases = [
                    Image.new(
                        "RGB",
                        (
                            (r["box"][2] - r["box"][0]) * ATLAS_COLUMNS,
                            (r["box"][3] - r["box"][1]) * ATLAS_ROWS,
                        ),
                    )
                    for r in regions
                ]
            for slot, region in enumerate(regions):
                left, top, right, bottom = region["box"]
                crop = pixels[top:bottom, left:right]
                digest = hashlib.sha256(crop.tobytes()).hexdigest()
                hashes[slot].add(digest)
                if previous is None:
                    values = (0.0, 0.0, 0)
                else:
                    delta = np.abs(
                        crop.astype(np.int16) - previous[top:bottom, left:right].astype(np.int16)
                    )
                    values = (
                        float(delta.mean()),
                        float((delta.max(axis=2) > 2).mean()),
                        int(delta.max()),
                    )
                metrics[slot].append(values)
                writer.writerow(
                    [
                        number,
                        slot + 1,
                        region["name"],
                        f"{values[0]:.6f}",
                        f"{values[1]:.6f}",
                        values[2],
                        digest,
                    ]
                )
                x = atlas_offset % ATLAS_COLUMNS * (right - left)
                y = atlas_offset // ATLAS_COLUMNS * (bottom - top)
                atlases[slot].paste(Image.fromarray(crop), (x, y))
            previous = pixels
            if atlas_offset == ATLAS_LENGTH - 1 or number == end:
                first_frame = start + atlas_index * ATLAS_LENGTH
                for slot, atlas in enumerate(atlases):
                    box = regions[slot]["box"]
                    filename = f"crops/slot-{slot + 1:02d}-frames-{first_frame}-{number}.png"
                    atlas.save(output / filename, compress_level=3)
                    atlas_records.append(
                        {
                            "slot": slot + 1,
                            "firstFrame": first_frame,
                            "lastFrame": number,
                            "cropWidth": box[2] - box[0],
                            "cropHeight": box[3] - box[1],
                            "file": filename,
                        }
                    )
            if relative % 240 == 0:
                print(f"Analyzed {number}/{end}", flush=True)
    summary = []
    for slot, region in enumerate(regions):
        values = np.asarray(metrics[slot][1:])
        summary.append(
            {
                "slot": slot + 1,
                **region,
                "distinctPixelCrops": len(hashes[slot]),
                "changedTransitions": int((values[:, 2] > 0).sum()) if len(values) else 0,
                "totalTransitions": max(0, len(frames) - 1),
                "meanFrameDelta": float(values[:, 0].mean()) if len(values) else 0,
                "maxFrameDelta": float(values[:, 0].max()) if len(values) else 0,
            }
        )
    metadata = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceCapture": capture.name,
        "firstFrame": start,
        "lastFrame": end,
        "frameCount": len(frames),
        "resolution": list(resolution),
        "aspectPreset": None if region_file else aspect,
        "regionsSource": (region_file.name if region_file else f"verified {aspect} pixel preset"),
        "boxConvention": "[left, top, right, bottom]; right and bottom exclusive",
        "sampleFrames": sample_frames,
        "duplicateXfbSkipping": duplicate_xfb_skipping,
        "frameSemantics": "Presented-XFB ordinals; not verified game ticks or wall-clock time.",
        "reviewNotes": notes or [],
        "slots": summary,
        "atlas": {
            "columns": ATLAS_COLUMNS,
            "rows": ATLAS_ROWS,
            "lookup": "offset=frame-firstFrame; x=(offset%12)*cropWidth; y=floor(offset/12)*cropHeight",
            "files": atlas_records,
        },
    }
    (output / "analysis.json").write_text(format_json(metadata))
    (output / "source-frames.json").write_text(format_json(source_records))
    max_width = max(r["box"][2] - r["box"][0] for r in regions)
    max_height = max(r["box"][3] - r["box"][1] for r in regions)
    cell_width, row_height = max_width + 3, max_height + 24
    sheet = Image.new(
        "RGB", (175 + len(sample_frames) * cell_width, 30 + len(regions) * row_height), (25, 25, 25)
    )
    draw = ImageDraw.Draw(sheet)
    for column, number in enumerate(sample_frames):
        draw.text((180 + column * cell_width, 8), f"Frame {number}", fill="white")
    for slot, region in enumerate(regions):
        top = 30 + slot * row_height
        draw.text((8, top + 12), f"{slot + 1:02d} {region['name']}", fill="white")
        draw.text((8, top + 29), f"{len(hashes[slot])} distinct crops", fill=(160, 160, 160))
        for column, number in enumerate(sample_frames):
            sheet.paste(samples[number].crop(region["box"]), (175 + column * cell_width, top))
    sheet.save(output / "icon-contact-sheet.png")
    plot = Image.new("RGB", (1200, len(regions) * 94 + 40), "white")
    draw = ImageDraw.Draw(plot)
    draw.text(
        (12, 10),
        "Mean absolute RGB difference from preceding captured image (0–255); rows scaled separately",
        fill="black",
    )
    for slot, region in enumerate(regions):
        values = np.asarray(metrics[slot])[:, 0]
        top, maximum = 40 + slot * 94, max(float(values.max()), 0.001)
        draw.text((10, top + 5), region["name"], fill="black")
        draw.text((10, top + 21), f"max {maximum:.3f}", fill=(90, 90, 90))
        points = [
            (170 + i / max(1, len(values) - 1) * 1015, top + 78 - value / maximum * 70)
            for i, value in enumerate(values)
        ]
        if len(points) > 1:
            draw.line(points, fill=(0, 140, 190), width=1)
        draw.line((170, top + 79, 1185, top + 79), fill=(190, 190, 190))
    plot.save(output / "icon-change-traces.png")
    annotated = samples[start].copy()
    draw = ImageDraw.Draw(annotated)
    for slot, region in enumerate(regions):
        left, top, right, bottom = region["box"]
        draw.rectangle((left, top, right - 1, bottom - 1), outline=(255, 0, 255), width=1)
        draw.text((left + 4, top + 3), str(slot + 1), fill=(255, 0, 255))
    annotated.save(output / "reviewed-regions.png")
    for label, number in (("first", start), ("last", end)):
        shutil.copyfile(frame_path(capture, number), output / f"{label}-analyzed-frame.png")
    rows = "\n".join(
        f"| {s['slot']} | {s['name']} | {s['box']} | {s['distinctPixelCrops']} | "
        f"{s['changedTransitions']}/{s['totalTransitions']} | {s['meanFrameDelta']:.3f} |"
        for s in summary
    )
    review = (
        "\n".join(f"- {note}" for note in notes or [])
        or "No reviewer notes supplied. Independently verify the range before interpreting motion."
    )
    (output / "README.md").write_text(f"""# Native channel icon capture analysis

Analyzed every contiguous presented image **{start}–{end}** ({len(frames)} images) from `{capture.name}` at **{resolution[0]}×{resolution[1]}**. No source pixel was resized, registered, recolored or removed for measurement. Names describe this recording's page-one fixture and are not inferred title identities.

## Range review

{review}

The original endpoint images and an annotated rectangle view are retained below. A stable grid does not by itself establish that pointer, tooltip, hover or startup overlays are absent. Such overlays affect the full-rectangle metrics and must be called out in the review notes.

![First source image](first-analyzed-frame.png)

![Last source image](last-analyzed-frame.png)

![Measured rectangles](reviewed-regions.png)

Duplicate-XFB skipping was **{duplicate_xfb_skipping}**. Image ordinals are presented XFBs, not guaranteed scene updates or wall-clock timestamps. Repeated hashes can reflect a held pose, repeated presentation or a loop; these measurements alone do not identify which. The range does not establish complete loop coverage without additional source/state alignment.

| Slot | Native channel | Rectangle (right/bottom exclusive) | Distinct crops | Changed adjacent images | Mean RGB delta |
|---|---|---|---:|---:|---:|
{rows}

![Original icon samples](icon-contact-sheet.png)

![Per-frame pixel change](icon-change-traces.png)

`frame-metrics.csv` contains every frame/slot pair. Mean delta is the average absolute RGB difference (0–255); changed-pixel fraction uses a maximum-channel difference greater than 2. The first sample has a zero baseline. Static tile borders and any visible overlays are included. `source-frames.json` hashes each complete decoded RGB image; the existing capture-session metadata identifies the original runtime and inputs.

`crops/` retains every crop as lossless PNG atlases. `analysis.json` lists each rectangle and atlas's own crop dimensions. For an atlas record, let `offset=frame-firstFrame`; its crop starts at `((offset%12)*cropWidth, floor(offset/12)*cropHeight)`. Unused cells in the last atlas are black padding, not captured frames. The contact sheet uses unscaled source crops; only the trace drawing compresses the horizontal frame axis for presentation. No browser/native equality or synchronized audio conclusion is made by this native-only report.
""")
    print(f"Wrote {output}", flush=True)
    return metadata


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capture", type=Path)
    parser.add_argument(
        "--start", type=int, required=True, help="First independently reviewed frame ordinal"
    )
    parser.add_argument(
        "--end", type=int, required=True, help="Last independently reviewed frame ordinal"
    )
    parser.add_argument("--output", type=Path)
    parser.add_argument(
        "--aspect",
        choices=tuple(PRESETS),
        default="4:3",
        help="Explicit capture-pixel preset; dimensions must match",
    )
    parser.add_argument(
        "--regions",
        type=Path,
        help="Override preset with JSON: resolution:[width,height], regions:[{name,box:[left,top,right,bottom]}]",
    )
    parser.add_argument(
        "--note", action="append", default=[], help="Repeatable range review/provenance note"
    )
    parser.add_argument(
        "--duplicate-xfb-skipping", choices=("enabled", "disabled", "unknown"), default="unknown"
    )
    options = parser.parse_args()
    try:
        analyze(
            options.capture,
            options.output or options.capture / "analysis/idle",
            options.start,
            options.end,
            aspect=options.aspect,
            region_file=options.regions,
            duplicate_xfb_skipping=options.duplicate_xfb_skipping,
            notes=options.note,
        )
    except (ValueError, KeyError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
