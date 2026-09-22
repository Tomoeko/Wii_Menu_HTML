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

import numpy as np
from PIL import Image, __version__ as pillow_version

RESAMPLING = {
    name: getattr(Image.Resampling, name.upper())
    for name in ("nearest", "bilinear", "bicubic", "lanczos")
}


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


def metrics(reference: np.ndarray, candidate: np.ndarray) -> dict:
    difference = candidate.astype(np.int16) - reference.astype(np.int16)
    absolute = np.abs(difference)
    maximum = absolute.max(axis=2)
    return {
        "pixelCount": int(maximum.size),
        "changedPixelCount": int(np.count_nonzero(maximum)),
        "pixelsWithinOneRGBValue": int(np.count_nonzero(maximum <= 1)),
        "meanSignedRGB": difference.mean(axis=(0, 1)).tolist(),
        "meanAbsoluteRGB": absolute.mean(axis=(0, 1)).tolist(),
        "maxAbsoluteRGB": absolute.max(axis=(0, 1)).tolist(),
    }


def compare(
    reference: Image.Image, candidate: Image.Image, regions: list, samples: list, resampling: str
) -> dict:
    reference, candidate = reference.convert("RGB"), candidate.convert("RGB")
    rw, rh = reference.size
    width, height = candidate.size
    if rw * height != rh * width:
        raise ValueError(
            "Aspect ratios differ; do not stretch or crop a candidate to conceal geometry differences"
        )
    normalized = reference.resize(candidate.size, RESAMPLING[resampling])
    raw, expected, actual = np.asarray(reference), np.asarray(normalized), np.asarray(candidate)
    result = {
        "normalization": {
            "operation": "Pillow Image.resize of reference to candidate dimensions; candidate remains unchanged",
            "resampling": resampling,
            "referenceRawSize": reference.size,
            "candidateRawSize": candidate.size,
            "normalizedSize": normalized.size,
            "referenceToCandidateScale": [width / rw, height / rh],
            "colorSpace": "Decoded 8-bit RGB values, without ICC/gamma correction",
            "pixelCenterMapping": "nativeCenter=((candidateIndex+0.5)*nativeSize/candidateSize)-0.5",
            "nearestPixelMapping": "nativeIndex=floor((candidateIndex+0.5)*nativeSize/candidateSize)",
            "pillowVersion": pillow_version,
            "numpyVersion": np.__version__,
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
                **metrics(expected[y : y + h, x : x + w], actual[y : y + h, x : x + w]),
            }
        )
    for x, y in samples:
        if x >= width or y >= height:
            raise ValueError(f"Sample {(x, y)} extends outside the candidate")
        nx, ny = int((x + 0.5) * rw / width), int((y + 0.5) * rh / height)
        result["samples"].append(
            {
                "candidatePixel": [x, y],
                "referenceContinuousCenter": [
                    (x + 0.5) * rw / width - 0.5,
                    (y + 0.5) * rh / height - 0.5,
                ],
                "referenceNearestPixel": [nx, ny],
                "referenceNearestRGB": raw[ny, nx].tolist(),
                "normalizedReferenceRGB": expected[y, x].tolist(),
                "candidateRGB": actual[y, x].tolist(),
                "signedDifferenceRGB": (actual[y, x].astype(np.int16) - expected[y, x]).tolist(),
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
        f"Normalize only the reference to the candidate dimensions using Pillow `{method['resampling']}` resampling. "
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
        with Image.open(options.reference) as reference, Image.open(options.candidate) as candidate:
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
