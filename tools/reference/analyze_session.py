#!/usr/bin/env python3
"""Index an original menu recording, with compact preview/transition sheets and audio traces."""

from __future__ import annotations

try:
    from tools.json_format import format_json
except ModuleNotFoundError:  # Direct execution from a tools subdirectory.
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from json_format import format_json

import argparse
from concurrent.futures import ThreadPoolExecutor
import csv
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import struct

from raster import RgbImage, read_png

RASTER_SHA256 = hashlib.sha256((Path(__file__).parent / "raster.py").read_bytes()).hexdigest()


def frame_path(capture: Path, number: int) -> Path:
    return capture / "Frames" / f"framedump_{number}.png"


def contact_sheet(capture: Path, frames: list[int], output: Path, columns: int = 5) -> None:
    source_width, source_height = read_png(frame_path(capture, frames[0])).size
    width = 256
    image_height = round(width * source_height / source_width)
    height = image_height + 20
    sheet = RgbImage.new((width * columns, height * math.ceil(len(frames) / columns)),
                         (24, 24, 24))
    for index, number in enumerate(frames):
        image = read_png(frame_path(capture, number)).resize((width, image_height), "bicubic")
        x, y = index % columns * width, index // columns * height
        sheet.paste(image, (x, y))
        sheet.draw_text((x + 5, y + image_height + 3), f"Captured image {number}", "white")
    sheet.save(output)


def frame_change_metrics(current: RgbImage, previous: RgbImage | None) -> dict:
    pixels = current.pixels
    earlier = previous.pixels if previous is not None else None
    red = green = blue = absolute_delta = changed = 0
    for offset in range(0, len(pixels), 3):
        red += pixels[offset]
        green += pixels[offset + 1]
        blue += pixels[offset + 2]
        if earlier is not None:
            deltas = [abs(pixels[offset + channel] - earlier[offset + channel])
                      for channel in range(3)]
            absolute_delta += sum(deltas)
            changed += int(max(deltas) > 2)
    pixel_count = current.width * current.height
    return {
        "mean_rgb_delta": round(absolute_delta / (pixel_count * 3), 6),
        "fraction_changed_gt_2": round(changed / pixel_count, 6),
        "mean_red": round(red / pixel_count, 6),
        "mean_green": round(green / pixel_count, 6),
        "mean_blue": round(blue / pixel_count, 6),
    }


def scan_frames(capture: Path, output: Path, end: int) -> list[dict]:
    path = output / "frame-change.csv"
    rows = []
    if path.exists():
        with path.open() as file:
            rows = [
                {k: (int(v) if k == "frame" else float(v)) for k, v in row.items()}
                for row in csv.DictReader(file)
            ]
    start = rows[-1]["frame"] + 1 if rows else 1
    previous = None
    if start > 1:
        previous = read_png(frame_path(capture, start - 1)).resize((80, 60), "bicubic")
    with path.open("a", newline="") as file:
        writer = csv.DictWriter(
            file,
            fieldnames=[
                "frame",
                "mean_rgb_delta",
                "fraction_changed_gt_2",
                "mean_red",
                "mean_green",
                "mean_blue",
            ],
        )
        if not rows:
            writer.writeheader()
        for number, pixels in decoded_frames(capture, start, end):
            row = {"frame": number, **frame_change_metrics(pixels, previous)}
            writer.writerow(row)
            rows.append(row)
            previous = pixels
            if number % 1000 == 0:
                file.flush()
                print(f"Indexed captured image {number}/{end}", flush=True)
    return [row for row in rows if row["frame"] <= end]


def decoded_frames(capture: Path, start: int, end: int):
    def decode(number):
        pixels = read_png(frame_path(capture, number)).resize((80, 60), "bicubic")
        return number, pixels

    # Independent PNG decoding can run concurrently; measurements stay in frame order.
    with ThreadPoolExecutor(max_workers=4) as pool:
        for first in range(start, end + 1, 256):
            yield from pool.map(decode, range(first, min(first + 256, end + 1)))


def audio_energy(path: Path, output: Path) -> dict:
    # Dolphin's live WAV size fields may be placeholders; use the bytes actually present.
    with path.open("rb") as file:
        if file.read(12)[0:4] != b"RIFF":
            raise ValueError(f"Expected PCM RIFF audio: {path}")
        pcm = None
        while True:
            header = file.read(8)
            if len(header) != 8:
                raise ValueError(f"No data chunk in {path}")
            kind, length = struct.unpack("<4sI", header)
            if kind == b"fmt ":
                pcm = struct.unpack("<HHIIHH", file.read(16))
                file.seek(length - 16 + length % 2, 1)
            elif kind == b"data":
                data_offset = file.tell()
                declared = length
                break
            else:
                file.seek(length + length % 2, 1)
    if pcm is None or pcm[0] != 1 or pcm[5] != 16:
        raise ValueError(f"Only native PCM16 dumps are supported: {path}")
    _, channels, rate, _, alignment, _ = pcm
    if channels not in (1, 2) or rate <= 0 or alignment != channels * 2:
        raise ValueError(f"Invalid native PCM16 format: {path}")
    available = path.stat().st_size - data_offset
    count = available // alignment
    window = max(1, round(rate * 0.05))
    records = []
    with path.open("rb") as file:
        file.seek(data_offset)
        for start in range(0, count, window):
            frames = min(window, count - start)
            block = file.read(frames * alignment)
            if len(block) != frames * alignment:
                raise ValueError(f"Native PCM data changed during analysis: {path}")
            samples = [sample for (sample,) in struct.iter_unpack("<h", block)]
            rms = math.sqrt(sum(sample * sample for sample in samples) / len(samples)) / 32768
            peak = max(abs(sample) for sample in samples) / 32768
            records.append(
                {
                    "seconds": round(start / rate, 6),
                    "rms_dbfs": max(-120, 20 * math.log10(max(rms, 1e-6))),
                    "peak_dbfs": max(-120, 20 * math.log10(max(peak, 1e-6))),
                }
            )
    filename = path.stem + "-energy.csv"
    with (output / filename).open("w", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=["seconds", "rms_dbfs", "peak_dbfs"])
        writer.writeheader()
        writer.writerows(records)
    onsets = []
    previous = -120
    last_time = -1
    for row in records:
        # Abrupt rises are candidates, including UI effects; they are not channel labels.
        if (
            row["rms_dbfs"] > -55
            and row["rms_dbfs"] - previous > 8
            and row["seconds"] - last_time >= 0.3
        ):
            onsets.append(
                {
                    "seconds": row["seconds"],
                    "rms_dbfs": round(row["rms_dbfs"], 2),
                    "rise_db": round(row["rms_dbfs"] - previous, 2),
                }
            )
            last_time = row["seconds"]
        previous = row["rms_dbfs"]
    return {
        "source": "Audio/" + path.name,
        "sampleRate": rate,
        "channels": channels,
        "seconds": count / rate,
        "pcmBytesAnalyzed": count * alignment,
        "declaredDataBytes": declared,
        "sizeHeaderMatchesSnapshot": declared == available,
        "csv": filename,
        "onsetCandidates": onsets,
        "records": records,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capture", type=Path)
    parser.add_argument(
        "--annotations", type=Path, required=True, help="Manually reviewed segment/transition JSON"
    )
    parser.add_argument(
        "--end", type=int, help="Snapshot upper frame ordinal; defaults to latest complete frame"
    )
    parser.add_argument(
        "--skip-frame-scan",
        action="store_true",
        help="Only refresh sheets/audio when full scan already exists",
    )
    options = parser.parse_args()
    capture = options.capture.resolve()
    output = capture / "analysis/session"
    output.mkdir(parents=True, exist_ok=True)
    annotations = json.loads(options.annotations.read_text())
    duplicate_skipping = annotations.get("duplicateXfbSkipping", "unknown")
    latest = max(
        int(path.stem.split("_")[-1]) for path in (capture / "Frames").glob("framedump_*.png")
    )
    end = min(latest, options.end) if options.end else latest - 1
    if options.skip_frame_scan and (output / "frame-change.csv").exists():
        with (output / "frame-change.csv").open() as file:
            rows = [
                {k: (int(v) if k == "frame" else float(v)) for k, v in row.items()}
                for row in csv.DictReader(file)
            ]
        rows = [row for row in rows if row["frame"] <= end]
    else:
        rows = scan_frames(capture, output, end)
    segments = []
    for segment in annotations.get("segments", []):
        if segment["start"] > end:
            continue
        finish = min(segment.get("end", end), end)
        start = segment["start"]
        choices = [start + offset for offset in (0, 10, 20, 40, 80, 160, 320)]
        choices += [int(start + (finish - start) * index / 7) for index in range(8)]
        selected = sorted(set(number for number in choices if start <= number <= finish))
        filename = f"preview-{segment['id']}.png"
        contact_sheet(capture, selected, output / filename)
        segments.append(
            {**segment, "end": finish, "selectedFrames": selected, "contactSheet": filename}
        )
    transitions = []
    for transition in annotations.get("transitions", []):
        if transition["end"] > end:
            continue
        selected = list(
            range(transition["start"], transition["end"] + 1, transition.get("step", 1))
        )
        filename = f"transition-{transition['id']}.png"
        contact_sheet(capture, selected, output / filename, columns=6)
        transitions.append({**transition, "selectedFrames": selected, "contactSheet": filename})
    overview_files = []
    overview = list(range(1, end + 1, 500)) + [end]
    for page, offset in enumerate(range(0, len(overview), 50)):
        filename = f"overview-{page + 1:02d}.png"
        contact_sheet(capture, overview[offset : offset + 50], output / filename)
        overview_files.append(filename)
    audio = [audio_energy(path, output) for path in sorted((capture / "Audio").glob("*.wav"))]
    if audio:
        graph = RgbImage.new((1600, 80 + len(audio) * 230), "white")
        graph.draw_text(
            (12, 12),
            "Native audio energy: independent sample-clock seconds. "
            "No frame-ordinal/time alignment is assumed.",
            "black",
        )
        duration = max(item["seconds"] for item in audio)
        for index, item in enumerate(audio):
            top = 55 + index * 230
            graph.draw_text(
                (12, top), f"{Path(item['source']).name} ({item['sampleRate']} Hz)", "black"
            )
            for db in (-90, -60, -30, 0):
                y = top + 190 - (db + 90) / 90 * 150
                graph.draw_line((65, y, 1580, y), (220, 220, 220))
                graph.draw_text((10, round(y - 5)), str(db), "black")
            points = [
                (
                    65 + row["seconds"] / max(duration, 1) * 1515,
                    top + 190 - (max(-90, row["rms_dbfs"]) + 90) / 90 * 150,
                )
                for row in item["records"]
            ]
            if len(points) > 1:
                graph.draw_line(points, (0, 140, 190))
            for seconds in range(0, math.ceil(duration), 60):
                graph.draw_text(
                    (round(65 + seconds / max(duration, 1) * 1515), top + 196),
                    f"{seconds}s", "black"
                )
        graph.save(output / "audio-energy.png")
    for item in audio:
        del item["records"]
    strong_changes = sorted(rows, key=lambda row: row["mean_rgb_delta"], reverse=True)[:100]
    result = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceCapture": capture.name,
        "lastFrameAnalyzed": end,
        "rasterDecoder": "first-party RGB PNG",
        "rasterSha256": RASTER_SHA256,
        "frameScanResampling": "bicubic 80x60",
        "contactSheetResampling": "bicubic",
        "semantics": (
            "Native presented-XFB image ordinals and independent audio sample seconds. "
            f"Duplicate-XFB skipping {duplicate_skipping}; exact audio/frame alignment is "
            "unverified."
        ),
        "duplicateXfbSkipping": duplicate_skipping,
        "notes": annotations.get("notes", []),
        "segments": segments,
        "transitions": transitions,
        "overview": overview_files,
        "audio": audio,
        "strongestPixelChanges": strong_changes,
    }
    (output / "session-index.json").write_text(format_json(result))
    lines = [
        "# Original menu session capture",
        "",
        (
            f"Indexed through captured image **{end}**. This recording uses original local "
            "USA 4.3 software in the RecompCore Dolphin fork with ARM64 JIT."
        ),
        "",
        (
            "Frame numbers are ordered presented-XFB images. Duplicate-XFB skipping was "
            f"**{duplicate_skipping}**. Audio uses its independent PCM sample clock; onset "
            "candidates include UI sounds and have not been aligned to named channel boundaries. "
            "Image ordinals are not wall-clock timestamps. Live WAV headers may be unfinished; "
            "only complete PCM samples physically present in the file were analyzed."
        ),
        "",
    ]
    lines += [f"- {note}" for note in annotations.get("notes", [])]
    lines += [
        "",
        "| Observed screen | First image | Last image | Contact sheet |",
        "|---|---:|---:|---|",
    ]
    lines += [
        (
            f"| {segment['title']} | {segment['start']} | {segment['end']} | "
            f"[Original frames]({segment['contactSheet']}) |"
        )
        for segment in segments
    ]
    lines += [
        "",
        (
            "The named intervals were reviewed against captured images. A preview interval "
            "includes its own opening animation; its first image may be mostly blank. A "
            "contact sheet samples both the opening and later animation without substituting "
            "browser renders."
        ),
        "",
        "## Transitions",
        "",
    ]
    for transition in transitions:
        lines += [
            f"### {transition['title']}",
            "",
            transition.get("notes", ""),
            "",
            f"![Original adjacent images]({transition['contactSheet']})",
            "",
        ]
    lines += [
        "## Audio",
        "",
        "![Independent audio-energy timeline](audio-energy.png)",
        "",
        (
            "`session-index.json` records source paths, selected frame ordinals, PCM metadata "
            "and abrupt-rise candidates. The energy CSVs contain 50 ms windows. "
            "`frame-change.csv` measures adjacent images after an 80×60 analysis downsample; "
            "the original PNGs and displayed references remain untouched."
        ),
        "",
    ]
    (output / "README.md").write_text("\n".join(lines))
    print(f"Wrote {output / 'session-index.json'}", flush=True)


if __name__ == "__main__":
    main()
