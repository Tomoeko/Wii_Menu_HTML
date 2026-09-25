#!/usr/bin/env python3
"""Compare explicit image regions after documented native-to-candidate resizing."""

from __future__ import annotations

try:
    from tools.json_format import format_json
except ModuleNotFoundError:  # Direct execution from a tools subdirectory.
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from json_format import format_json

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

from raster import RESAMPLING, RgbImage, read_png


RASTER_SHA256 = hashlib.sha256((Path(__file__).parent / "raster.py").read_bytes()).hexdigest()


def region_arg(value: str) -> tuple[str, tuple[int, int, int, int]]:
    try:
        name, coordinates = value.split(":", 1)
        rectangle = tuple(int(n) for n in coordinates.split(","))
        if not name or len(rectangle) != 4 or min(rectangle[:2]) < 0 or min(rectangle[2:]) <= 0:
            raise ValueError
        return name, rectangle
    except ValueError as error:
        raise argparse.ArgumentTypeError(
            "Use NAME:X,Y,WIDTH,HEIGHT with nonnegative coordinates and positive dimensions"
        ) from error


def sample_arg(value: str) -> tuple[int, int]:
    try:
        coordinates = tuple(int(n) for n in value.split(","))
        if len(coordinates) != 2 or min(coordinates) < 0:
            raise ValueError
        return coordinates
    except ValueError as error:
        raise argparse.ArgumentTypeError("Use nonnegative X,Y") from error


def metrics(reference: RgbImage, candidate: RgbImage, rectangle: tuple[int, int, int, int]) -> dict:
    x, y, width, height = rectangle
    signed_sums = [0, 0, 0]
    absolute_sums = [0, 0, 0]
    maximum = [0, 0, 0]
    changed = 0
    within_one = 0
    for row in range(y, y + height):
        for column in range(x, x + width):
            offset = (row * reference.width + column) * 3
            differences = [candidate.pixels[offset + channel] - reference.pixels[offset + channel]
                           for channel in range(3)]
            absolute = [abs(value) for value in differences]
            changed += any(absolute)
            within_one += max(absolute) <= 1
            for channel in range(3):
                signed_sums[channel] += differences[channel]
                absolute_sums[channel] += absolute[channel]
                maximum[channel] = max(maximum[channel], absolute[channel])
    pixel_count = width * height
    return {
        "pixelCount": pixel_count,
        "changedPixelCount": changed,
        "pixelsWithinOneRGBValue": within_one,
        "meanSignedRGB": [total / pixel_count for total in signed_sums],
        "meanAbsoluteRGB": [total / pixel_count for total in absolute_sums],
        "maxAbsoluteRGB": maximum,
    }


def compare(
    reference: RgbImage, candidate: RgbImage, regions: list, samples: list, resampling: str
) -> dict:
    rw, rh = reference.size
    width, height = candidate.size
    if rw * height != rh * width:
        raise ValueError(
            "Aspect ratios differ; do not stretch or crop a candidate to conceal geometry differences"
        )
    normalized = reference.resize(candidate.size, resampling)
    result = {
        "normalization": {
            "operation": "First-party RGB resize of reference to candidate dimensions; candidate remains unchanged",
            "resampling": resampling,
            "referenceRawSize": reference.size,
            "candidateRawSize": candidate.size,
            "normalizedSize": normalized.size,
            "referenceToCandidateScale": [width / rw, height / rh],
            "colorSpace": "Decoded 8-bit RGB values, without ICC/gamma correction",
            "pixelCenterMapping": "nativeCenter=((candidateIndex+0.5)*nativeSize/candidateSize)-0.5",
            "nearestPixelMapping": "nativeIndex=floor((candidateIndex+0.5)*nativeSize/candidateSize)",
            "rasterImplementation": "tools/reference/raster.py",
            "rasterSha256": RASTER_SHA256,
        },
        "regions": [],
        "samples": [],
    }
    for name, (x, y, w, h) in regions:
        if x + w > width or y + h > height:
            raise ValueError(f"Region {name!r} extends outside the candidate")
        result["regions"].append(
            {
                "name": name,
                "candidateRectangleXYWH": [x, y, w, h],
                "referenceRectangleEdges": [
                    x * rw / width,
                    y * rh / height,
                    (x + w) * rw / width,
                    (y + h) * rh / height,
                ],
                **metrics(normalized, candidate, (x, y, w, h)),
            }
        )
    for x, y in samples:
        if x >= width or y >= height:
            raise ValueError(f"Sample {(x, y)} extends outside the candidate")
        nx, ny = int((x + 0.5) * rw / width), int((y + 0.5) * rh / height)
        raw = reference.getpixel((nx, ny))
        expected = normalized.getpixel((x, y))
        actual = candidate.getpixel((x, y))
        result["samples"].append(
            {
                "candidatePixel": [x, y],
                "referenceContinuousCenter": [
                    (x + 0.5) * rw / width - 0.5,
                    (y + 0.5) * rh / height - 0.5,
                ],
                "referenceNearestPixel": [nx, ny],
                "referenceNearestRGB": list(raw),
                "normalizedReferenceRGB": list(expected),
                "candidateRGB": list(actual),
                "signedDifferenceRGB": [left - right for left, right in zip(actual, expected)],
            }
        )
    return result


def describe_file(path: Path) -> dict:
    return {
        "path": path.name,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def markdown(report: dict) -> str:
    method = report["normalization"]
    text = [
        f"# {report['case']}",
        "",
        f"Generated: {report['generatedAt']}",
        "",
        f"Reference: `{report['reference']['path']}` ({method['referenceRawSize'][0]} × {method['referenceRawSize'][1]}).",
        f"Candidate: `{report['candidate']['path']}` ({method['candidateRawSize'][0]} × {method['candidateRawSize'][1]}).",
        "",
        f"Normalize only the reference to the candidate dimensions using the local `{method['resampling']}` resampler. "
        "No alignment, cropping, gamma correction, or candidate resizing is applied. "
        "JSON retains hashes, raw dimensions, region bounds, sample coordinates, and raw/normalized RGB values.",
        "",
        "| Region (candidate X,Y,W,H) | Pixels | Changed | Within ±1/channel | Mean absolute RGB | Maximum absolute RGB |",
        "| --- | ---: | ---: | ---: | --- | --- |",
    ]
    for item in report["regions"]:
        mean = ", ".join(f"{value:.4f}" for value in item["meanAbsoluteRGB"])
        text.append(
            f"| {item['name']} ({', '.join(map(str,item['candidateRectangleXYWH']))}) | {item['pixelCount']} | "
            f"{item['changedPixelCount']} | {item['pixelsWithinOneRGBValue']} | {mean} | {item['maxAbsoluteRGB']} |"
        )
    text += [
        "",
        "This measures only the selected pixels. It does not certify whole-frame, animation, input, text, or audio fidelity.",
        "",
    ]
    text += [f"- {note}" for note in report["notes"]]
    text += [
        "",
        "Reproduce with the recorded input hashes, regions, samples, and normalization settings. "
        "Supply local paths to `tools/reference/compare_frames.py`:",
        "",
        "```sh",
        "python3 tools/reference/compare_frames.py REFERENCE.png CANDIDATE.png "
        "--resampling " + method["resampling"] + " --roi NAME:X,Y,WIDTH,HEIGHT --output REPORT",
        "```",
        "",
    ]
    return "\n".join(text)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reference", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("--resampling", choices=RESAMPLING, required=True)
    parser.add_argument(
        "--roi", type=region_arg, action="append", required=True, metavar="NAME:X,Y,W,H"
    )
    parser.add_argument("--sample", type=sample_arg, action="append", default=[], metavar="X,Y")
    parser.add_argument(
        "--output", type=Path, required=True, help="Output prefix for .json and .md reports"
    )
    parser.add_argument("--case", default="Frame region comparison")
    parser.add_argument("--note", action="append", default=[])
    parser.add_argument(
        "--source-file",
        type=Path,
        action="append",
        default=[],
        help="Record analysis-workspace source hashes",
    )
    options = parser.parse_args()
    try:
        reference = read_png(options.reference)
        candidate = read_png(options.candidate)
        report = compare(reference, candidate, options.roi, options.sample, options.resampling)
    except ValueError as error:
        parser.error(str(error))
    report.update(
        {
            "case": options.case,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "reference": describe_file(options.reference),
            "candidate": describe_file(options.candidate),
            "sourceFilesAtAnalysis": [describe_file(path) for path in options.source_file],
            "notes": options.note,
        }
    )
    options.output.parent.mkdir(parents=True, exist_ok=True)
    options.output.with_suffix(".json").write_text(format_json(report))
    options.output.with_suffix(".md").write_text(markdown(report))
    print(f"Wrote {options.output.with_suffix('.json')} and {options.output.with_suffix('.md')}")


if __name__ == "__main__":
    main()
