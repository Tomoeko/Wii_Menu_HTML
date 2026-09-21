#!/usr/bin/env python3
"""Align explicit browser updates to native presented images using masked pixels.

The alignment is monotonic image matching, not a frame-rate measurement. Native
ordinals may repeat or be skipped. Images are not resampled unless a native-only
horizontal presentation mapping is explicitly recorded in the configuration.
Only named, opt-in regions are included in the redacted contact sheet.
"""

import argparse
import csv
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, __version__ as pillow_version


RESAMPLING = {
    name: getattr(Image.Resampling, name.upper())
    for name in ("nearest", "bilinear", "bicubic", "lanczos")
}


def read_sequence(sidecar, project):
    """Resolve a complete inspector manifest without allowing paths outside root."""
    metadata = json.loads(sidecar.read_text())
    comparison = metadata.get("comparison", {})
    manifest = comparison.get("sequenceManifest", {})
    frames = manifest.get("frames", [])
    if manifest.get("complete") is not True or not isinstance(frames, list) or not frames:
        raise ValueError("A complete, nonempty sequence manifest is required.")
    result = []
    for expected, item in enumerate(frames):
        if not isinstance(item, dict) or type(item.get("frame")) is not int or item["frame"] != expected:
            raise ValueError("Browser updates must be contiguous integers starting at zero.")
        if item.get("currentCapture"):
            if expected != len(frames) - 1 or item.get("path"):
                raise ValueError("Only the final frame may refer to the current capture.")
            path = sidecar.with_suffix(".png")
        else:
            value = item.get("path")
            if not isinstance(value, str) or Path(value).is_absolute():
                raise ValueError("Capture paths must be relative to the project root.")
            path = project / value
        path = path.resolve()
        if not path.is_relative_to(project.resolve()) or not path.is_file():
            raise ValueError("A capture is missing or outside the project root.")
        result.append(path)
    if comparison.get("total") != len(frames):
        raise ValueError("Sequence total does not match its manifest.")
    return metadata, result


def region_mask(size, regions, exclusions=()):
    width, height = size
    mask = np.zeros((height, width), dtype=bool)
    for rectangles, value in ((regions, True), (exclusions, False)):
        for rectangle in rectangles:
            if len(rectangle) != 4 or any(type(x) is not int for x in rectangle):
                raise ValueError("Rectangles require four integer coordinates.")
            x0, y0, x1, y1 = rectangle
            if not (0 <= x0 < x1 <= width and 0 <= y0 < y1 <= height):
                raise ValueError("Rectangle is empty or outside the image.")
            mask[y0:y1, x0:x1] = value
    if not mask.any():
        raise ValueError("The selected region contains no pixels after exclusions.")
    return mask


def monotonic_alignment(cost):
    """Minimum-cost nondecreasing native indices; duplicate/skipped XFBs allowed."""
    if cost.ndim != 2 or not cost.size or not np.isfinite(cost).all():
        raise ValueError("Alignment needs a finite, nonempty cost matrix.")
    total = cost[0].copy()
    previous = np.zeros(cost.shape, dtype=int)
    for row in range(1, len(cost)):
        best = 0
        for column in range(cost.shape[1]):
            if total[column] < total[best]:
                best = column
            previous[row, column] = best
        total = cost[row] + total[previous[row]]
    indices = [int(total.argmin())]
    for row in range(len(cost) - 1, 0, -1):
        indices.append(int(previous[row, indices[-1]]))
    return list(reversed(indices))


def presentation_normalization(configuration):
    """Require measured source geometry for an opt-in horizontal-only mapping."""
    def geometry(value):
        return (isinstance(value, list) and len(value) == 2
                and all(type(number) is int and number > 0 for number in value))

    size = configuration.get("size")
    if not geometry(size):
        raise ValueError("Comparison size requires two positive integer dimensions.")
    if "nativePresentation" not in configuration:
        return None
    mapping = configuration["nativePresentation"]
    if not isinstance(mapping, dict) or set(mapping) != {"sourceSize", "resample"}:
        raise ValueError("Native presentation requires only recorded sourceSize and resample fields.")
    source_size = mapping["sourceSize"]
    if not geometry(source_size):
        raise ValueError("Native sourceSize requires two positive integer dimensions.")
    if source_size[1] != size[1] or source_size[0] == size[0]:
        raise ValueError("Native presentation normalization requires different widths and equal heights.")
    resampling = mapping["resample"]
    if not isinstance(resampling, str) or resampling not in RESAMPLING:
        raise ValueError("Native resample must be nearest, bilinear, bicubic or lanczos.")
    return {
        "operation": "Resize only decoded native RGB images horizontally; browser pixels are unchanged.",
        "sourceSize": source_size,
        "comparisonSize": size,
        "resample": resampling,
        "scale": [size[0] / source_size[0], 1],
        "pixelCenterMapping": "nativeX=((comparisonX+0.5)*sourceWidth/comparisonWidth)-0.5; nativeY=comparisonY",
        "colorSpace": "Decoded 8-bit RGB without ICC or gamma correction.",
        "pillowVersion": pillow_version,
        "numpyVersion": np.__version__,
    }


def load_images(paths, size, normalization=None):
    images = []
    for path in paths:
        with Image.open(path) as image:
            if image.size != tuple(size):
                raise ValueError(f"Unexpected image dimensions: {path.name}")
            pixels = image.convert("RGB")
            if normalization is not None:
                pixels = pixels.resize(tuple(normalization["comparisonSize"]),
                                       RESAMPLING[normalization["resample"]])
            images.append(np.asarray(pixels))
    return images


def file_digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def compare(sidecar, project, native_directory, first, last, configuration, output,
            native_evidence=None, authored_source_snapshot=None):
    metadata, browser_paths = read_sequence(sidecar, project)
    normalization = presentation_normalization(configuration)
    size = configuration["size"]
    if [metadata.get("width"), metadata.get("height")] != size:
        raise ValueError("Sidecar dimensions disagree with comparison configuration.")
    if first < 0 or last < first:
        raise ValueError("Native ordinal range must be increasing and nonnegative.")
    provenance = None
    if native_evidence:
        provenance = json.loads(native_evidence.read_text()).get("capture", {})
        native_wad = provenance.get("wadSha256")
        browser_wad = metadata["comparison"].get("source", {}).get("wadSha256")
        if not native_wad or not browser_wad or native_wad != browser_wad:
            raise ValueError("Native and browser WAD hashes must be present and match.")
    authored_source = {
        "available": False,
        "reason": "No source snapshot associated with this export was supplied.",
    }
    if authored_source_snapshot:
        snapshot = json.loads(authored_source_snapshot.read_text())
        if sidecar.name not in snapshot.get("sidecars", []):
            raise ValueError("The source snapshot must explicitly identify this export sidecar.")
        authored_source = {
            "available": True,
            "snapshotSha256": file_digest(authored_source_snapshot),
            **snapshot,
        }
    native_paths = [native_directory / f"framedump_{frame}.png" for frame in range(first, last + 1)]
    native_size = normalization["sourceSize"] if normalization is not None else size
    native = load_images(native_paths, native_size, normalization)
    browser = load_images(browser_paths, size)
    exclusions = configuration.get("exclusions", [])
    alignment_mask = region_mask(size, configuration["alignmentRegions"], exclusions)
    masks = {
        name: region_mask(size, rectangles, exclusions)
        for name, rectangles in configuration["measurementRegions"].items()
    }
    if not masks:
        raise ValueError("At least one measurement region is required.")
    native_samples = [image[alignment_mask].astype(np.int16) for image in native]
    browser_samples = [image[alignment_mask].astype(np.int16) for image in browser]
    costs = np.array([
        [
            float(np.abs(image - sample).mean())
            for sample in native_samples
        ]
        for image in browser_samples
    ])
    alignment = monotonic_alignment(costs)
    pairs = []
    for update, ordinal_index in enumerate(alignment):
        difference = np.abs(browser[update].astype(np.int16) - native[ordinal_index])
        pairs.append({
            "browserUpdate": update,
            "nativeOrdinal": first + ordinal_index,
            "alignmentMeanAbsoluteRgbDifference": float(costs[update, ordinal_index]),
            "regions": {
                name: {
                    "pixels": int(mask.sum()),
                    "meanAbsoluteRgbDifference": float(difference[mask].mean()),
                    "equalPixelFraction": float((difference[mask] == 0).all(axis=1).mean()),
                }
                for name, mask in masks.items()
            },
        })
    report = {
        "schemaVersion": 1,
        "analysisTool": {"file": Path(__file__).name, "sha256": file_digest(Path(__file__))},
        "browserSidecar": str(sidecar.resolve().relative_to(project.resolve())),
        "browserSidecarSha256": file_digest(sidecar),
        "browserFrameConvention": metadata["comparison"].get("frameConvention"),
        "source": metadata["comparison"].get("source"),
        "nativeRangeInclusive": [first, last],
        "nativeCaptureIdentity": provenance,
        "nativeEvidenceSha256": file_digest(native_evidence) if native_evidence else None,
        "authoredSourceSnapshot": authored_source,
        "configuration": configuration,
        "method": (
            "Minimum total RGB absolute difference with nondecreasing native ordinal, "
            "allowing duplicate or skipped native images. No image resampling, "
            "translation, color normalization, or inferred frame rate."
        ),
        "limits": [
            "Pixel matching estimates pose correspondence only; ordinal differences do not measure elapsed time or simulation updates.",
            "Unchanging regions cannot uniquely determine alignment; ties choose the earliest native ordinal.",
            "Excluded pixels do not contribute to alignment, metrics, or the redacted contact sheet.",
            "Low regional error does not establish full-frame or interaction equivalence.",
        ],
        "nativeFrames": [
            {"ordinal": first + i, "sha256": file_digest(path)}
            for i, path in enumerate(native_paths)
        ],
        "browserFrames": [
            {"update": i, "file": path.name, "sha256": file_digest(path)}
            for i, path in enumerate(browser_paths)
        ],
        "pairs": pairs,
    }
    if normalization is not None:
        report["nativePresentationNormalization"] = normalization
        report["method"] = (
            "Minimum total RGB absolute difference with nondecreasing native ordinal, "
            "allowing duplicate or skipped native images. Native images alone are "
            f"horizontally resampled with {normalization['resample']} from the recorded "
            "sourceSize to comparison size. No vertical resizing, translation, "
            "color normalization, browser resampling, or inferred frame rate."
        )
        report["limits"][2] = (
            "Exclusions apply in comparison coordinates after native resampling; "
            "excluded comparison pixels do not enter metrics or the contact sheet."
        )
        report["limits"].extend([
            "Horizontal normalization assumes a reviewed presentation-width difference; it does not prove matching aspect, projection, or native pixel geometry.",
            "Resampling mixes neighboring source pixels. Review and enlarge exclusions around private regions to cover the filter footprint before sharing reports.",
            "Metrics compare unchanged browser pixels with normalized native pixels, not original native-pixel equality. Input file hashes identify the unmodified images.",
        ])
    output.mkdir(parents=True, exist_ok=True)
    (output / "comparison.json").write_text(json.dumps(report, indent=2) + "\n")
    with (output / "alignment.csv").open("w", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["browser_update", "native_ordinal", "alignment_rgb_mae", *masks])
        for pair in pairs:
            writer.writerow([
                pair["browserUpdate"],
                pair["nativeOrdinal"],
                pair["alignmentMeanAbsoluteRgbDifference"],
                *[pair["regions"][name]["meanAbsoluteRgbDifference"] for name in masks],
            ])
    visible = alignment_mask.copy()
    for mask in masks.values():
        visible |= mask
    selected = sorted(set(range(0, len(browser), 4)) | {len(browser) - 1})
    width, height = size
    sheet = Image.new("RGB", (width * 2, (height + 24) * len(selected)), "#181818")
    draw = ImageDraw.Draw(sheet)
    for row, update in enumerate(selected):
        matched = alignment[update]
        y = row * (height + 24)
        draw.text((8, y + 5), f"Native XFB {first + matched}", fill="white")
        draw.text((width + 8, y + 5), f"Browser update {update}", fill="white")
        for column, pixels in enumerate((native[matched], browser[update])):
            redacted = np.where(visible[..., None], pixels, 24).astype(np.uint8)
            sheet.paste(Image.fromarray(redacted), (column * width, y + 24))
    sheet.save(output / "contact-sheet.png")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sidecar", type=Path)
    parser.add_argument("--project", type=Path, default=Path.cwd())
    parser.add_argument("--native", type=Path, required=True)
    parser.add_argument("--native-evidence", type=Path,
                        help="Capture evidence JSON; requires its WAD hash to match the browser.")
    parser.add_argument("--authored-source-snapshot", type=Path,
                        help="Previously recorded authored file hashes associated with this export.")
    parser.add_argument("--first", type=int, required=True)
    parser.add_argument("--last", type=int, required=True)
    parser.add_argument("--regions", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = compare(
        args.sidecar, args.project, args.native, args.first, args.last,
        json.loads(args.regions.read_text()), args.output, args.native_evidence,
        args.authored_source_snapshot,
    )
    print(f"Compared {len(report['pairs'])} browser updates; wrote {args.output / 'comparison.json'}")


if __name__ == "__main__":
    main()
