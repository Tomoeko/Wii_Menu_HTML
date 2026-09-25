#!/usr/bin/env python3
"""Align explicit browser updates to native presented images using masked pixels.

The alignment is monotonic image matching, not a frame-rate measurement. Native
ordinals may repeat or be skipped. Images are not resampled unless a native-only
horizontal presentation mapping is explicitly recorded in the configuration.
Only named, opt-in regions are included in the redacted contact sheet.
"""
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
import math
import mmap
from pathlib import Path
import tempfile

from raster import MAX_PIXELS, RESAMPLING, RgbImage, read_png


RASTER_SHA256 = hashlib.sha256((Path(__file__).parent / "raster.py").read_bytes()).hexdigest()


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
    mask = bytearray(width * height)
    for rectangles, value in ((regions, 1), (exclusions, 0)):
        for rectangle in rectangles:
            if len(rectangle) != 4 or any(type(x) is not int for x in rectangle):
                raise ValueError("Rectangles require four integer coordinates.")
            x0, y0, x1, y1 = rectangle
            if not (0 <= x0 < x1 <= width and 0 <= y0 < y1 <= height):
                raise ValueError("Rectangle is empty or outside the image.")
            row = bytes((value,)) * (x1 - x0)
            for y in range(y0, y1):
                mask[y * width + x0:y * width + x1] = row
    if not any(mask):
        raise ValueError("The selected region contains no pixels after exclusions.")
    return mask


def monotonic_alignment(cost):
    """Minimum-cost nondecreasing native indices; duplicate/skipped XFBs allowed."""
    if not isinstance(cost, (list, tuple)) or not cost:
        raise ValueError("Alignment needs a finite, nonempty cost matrix.")
    columns = len(cost[0]) if isinstance(cost[0], (list, tuple)) else 0
    if columns == 0:
        raise ValueError("Alignment needs a finite, nonempty cost matrix.")
    for row in cost:
        if (not isinstance(row, (list, tuple)) or len(row) != columns
                or any(type(value) not in (int, float) or not math.isfinite(value)
                       for value in row)):
            raise ValueError("Alignment needs a finite, nonempty cost matrix.")
    total = list(cost[0])
    previous = [[0] * len(total) for _ in cost]
    for row in range(1, len(cost)):
        best = 0
        for column in range(len(total)):
            if total[column] < total[best]:
                best = column
            previous[row][column] = best
        total = [value + total[previous[row][column]]
                 for column, value in enumerate(cost[row])]
    indices = [min(range(len(total)), key=total.__getitem__)]
    for row in range(len(cost) - 1, 0, -1):
        indices.append(previous[row][indices[-1]])
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
        "rasterImplementation": "tools/reference/raster.py",
        "rasterSha256": RASTER_SHA256,
    }


def load_image(path, size, normalization=None):
    image = read_png(path)
    if image.size != tuple(size):
        raise ValueError(f"Unexpected image dimensions: {path.name}")
    if normalization is not None:
        image = image.resize(tuple(normalization["comparisonSize"]),
                             normalization["resample"])
    return image


def mask_runs(mask):
    """Return contiguous selected pixel spans for repeat sampling and redaction."""
    runs = []
    start = None
    for index, selected in enumerate(mask):
        if selected and start is None:
            start = index
        elif not selected and start is not None:
            runs.append((start, index))
            start = None
    if start is not None:
        runs.append((start, len(mask)))
    return runs


def masked_rgb(image: RgbImage, runs) -> bytes:
    return b"".join(image.pixels[start * 3:end * 3] for start, end in runs)


def redacted_image(image: RgbImage, runs) -> RgbImage:
    result = RgbImage.new(image.size, (24, 24, 24))
    for start, end in runs:
        result.pixels[start * 3:end * 3] = image.pixels[start * 3:end * 3]
    return result


def sample_metrics(browser: bytes, native: bytes) -> dict:
    pixels = len(browser) // 3
    absolute = 0
    equal = 0
    for index in range(0, len(browser), 3):
        red = abs(browser[index] - native[index])
        green = abs(browser[index + 1] - native[index + 1])
        blue = abs(browser[index + 2] - native[index + 2])
        absolute += red + green + blue
        equal += red == green == blue == 0
    return {
        "pixels": pixels,
        "meanAbsoluteRgbDifference": absolute / (pixels * 3),
        "equalPixelFraction": equal / pixels,
    }


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
    exclusions = configuration.get("exclusions", [])
    alignment_mask = region_mask(size, configuration["alignmentRegions"], exclusions)
    masks = {
        name: region_mask(size, rectangles, exclusions)
        for name, rectangles in configuration["measurementRegions"].items()
    }
    if not masks:
        raise ValueError("At least one measurement region is required.")
    alignment_runs = mask_runs(alignment_mask)
    sample_length = sum(end - start for start, end in alignment_runs) * 3
    costs = []
    # The full decoded image sequence can exceed a gigabyte. Keep only the
    # selected native bytes in a temporary file and decode browser frames once
    # per alignment row. Metrics and sheet images are reloaded after alignment.
    with tempfile.TemporaryFile() as sample_file:
        for path in native_paths:
            image = load_image(path, native_size, normalization)
            sample_file.write(masked_rgb(image, alignment_runs))
        sample_file.flush()
        with mmap.mmap(sample_file.fileno(), 0, access=mmap.ACCESS_READ) as samples:
            for path in browser_paths:
                browser_sample = masked_rgb(load_image(path, size), alignment_runs)
                row = []
                for index in range(len(native_paths)):
                    offset = index * sample_length
                    with memoryview(samples)[offset:offset + sample_length] as native_sample:
                        absolute = sum(abs(left - right) for left, right
                                       in zip(browser_sample, native_sample))
                    row.append(absolute / sample_length)
                costs.append(row)
    alignment = monotonic_alignment(costs)
    selected = sorted(set(range(0, len(browser_paths), 4)) | {len(browser_paths) - 1})
    width, height = size
    pixels_per_sheet_row = width * 2 * (height + 24)
    page_capacity = MAX_PIXELS // pixels_per_sheet_row
    if page_capacity < 1:
        raise ValueError("A contact-sheet pair exceeds the first-party raster pixel limit.")
    pages = [selected[index:index + page_capacity]
             for index in range(0, len(selected), page_capacity)]
    contact_sheets = []
    for index, updates in enumerate(pages):
        filename = ("contact-sheet.png" if len(pages) == 1
                    else f"contact-sheet-{index + 1:02d}.png")
        contact_sheets.append({
            "file": filename,
            "browserUpdates": updates,
            "nativeOrdinals": [first + alignment[update] for update in updates],
        })
    measurement_runs = {name: mask_runs(mask) for name, mask in masks.items()}
    pairs = []
    previous_native_index = None
    native_image = None
    for update, ordinal_index in enumerate(alignment):
        browser_image = load_image(browser_paths[update], size)
        if ordinal_index != previous_native_index:
            native_image = load_image(native_paths[ordinal_index], native_size, normalization)
            previous_native_index = ordinal_index
        pairs.append({
            "browserUpdate": update,
            "nativeOrdinal": first + ordinal_index,
            "alignmentMeanAbsoluteRgbDifference": costs[update][ordinal_index],
            "regions": {
                name: sample_metrics(
                    masked_rgb(browser_image, runs), masked_rgb(native_image, runs)
                )
                for name, runs in measurement_runs.items()
            },
        })
    report = {
        "schemaVersion": 1,
        "analysisTool": {"file": Path(__file__).name, "sha256": file_digest(Path(__file__))},
        "rasterImplementation": {"file": "tools/reference/raster.py", "sha256": RASTER_SHA256},
        "alignmentStorage": "Selected native RGB bytes in an anonymous local temporary file.",
        "contactSheets": contact_sheets,
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
            "Alignment time grows with browser updates, native images and selected RGB bytes.",
            "Contact sheets include every fourth browser update and split at the raster pixel limit.",
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
    visible = alignment_mask[:]
    for mask in masks.values():
        for index, selected in enumerate(mask):
            if selected:
                visible[index] = 1
    visible_runs = mask_runs(visible)
    for page in contact_sheets:
        updates = page["browserUpdates"]
        sheet = RgbImage.new((width * 2, (height + 24) * len(updates)), "#181818")
        for row, update in enumerate(updates):
            matched = alignment[update]
            y = row * (height + 24)
            sheet.draw_text((8, y + 5), f"Native XFB {first + matched}", "white")
            sheet.draw_text((width + 8, y + 5), f"Browser update {update}", "white")
            images = (
                load_image(native_paths[matched], native_size, normalization),
                load_image(browser_paths[update], size),
            )
            for column, pixels in enumerate(images):
                sheet.paste(redacted_image(pixels, visible_runs), (column * width, y + 24))
        sheet.save(output / page["file"])
    (output / "comparison.json").write_text(format_json(report))
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
