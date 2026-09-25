#!/usr/bin/env python3
"""Export unchanged menu PCM from an isolated quiet native capture, with a verified loop join."""

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
import math
from pathlib import Path
import struct
import sys
import wave

from reference_paths import PACKAGE_ROOT as ROOT

sys.path.insert(0, str(ROOT / "tools/assets"))
from export_audio import Archive


def native_tick_frames(ticks):
    """SeqPlayer::UpdateTempoCounter: integer 416 threshold, one AX update per 3 ms."""
    counter, tempo, tick, frame = 416, 120, 0, 0
    found = {}
    while tick <= max(ticks):
        count = 0
        while counter >= 416:
            counter -= 416
            count += 1
        counter += tempo
        for _ in range(count):
            if tick in ticks:
                found[tick] = frame
            # This supplied sequence sets tempo 114 on its initial tick.
            tempo = 114
            tick += 1
        frame += 1
    return found


def rms_envelope(pcm: memoryview, start: int, window_samples: int = 32,
                 max_windows: int | None = None) -> list[float]:
    """Measure stereo PCM16 energy without changing the recorded samples."""
    complete_windows = (len(pcm) - start * 4) // (window_samples * 4)
    if max_windows is not None:
        complete_windows = min(complete_windows, max_windows)
    result = []
    for index in range(complete_windows):
        offset = (start + index * window_samples) * 4
        samples = struct.iter_unpack("<h", pcm[offset : offset + window_samples * 4])
        squared = math.fsum(sample[0] ** 2 for sample in samples)
        result.append(math.sqrt(squared / (window_samples * 2)) / 32768)
    return result


def correlation(first: list[float], second: list[float]) -> float | None:
    """Pearson correlation of two equal-length energy windows."""
    if len(first) != len(second) or not first:
        raise ValueError("Correlation requires equally sized, nonempty windows")
    first_mean = math.fsum(first) / len(first)
    second_mean = math.fsum(second) / len(second)
    centered = ((left - first_mean, right - second_mean)
                for left, right in zip(first, second))
    cross, first_square, second_square = 0.0, 0.0, 0.0
    for left, right in centered:
        cross += left * right
        first_square += left * left
        second_square += right * right
    denominator = math.sqrt(first_square * second_square)
    return cross / denominator if denominator else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capture", type=Path)
    parser.add_argument(
        "--start-sample",
        type=int,
        required=True,
        help="Manually verified native BGM event start in the 32 kHz DSP stream",
    )
    parser.add_argument(
        "--phase-offset-samples",
        type=int,
        default=32000,
        help="Rotate loop phase to a matching unchanged PCM boundary",
    )
    parser.add_argument("--assets", type=Path, default=ROOT / "web/public/assets")
    parser.add_argument("--sound-archive", type=Path, default=ROOT / ".local/IplSound.brsar")
    parser.add_argument(
        "--activate",
        action="store_true",
        help="Activate captured BGM and preserve it during future asset generation",
    )
    options = parser.parse_args()
    capture = options.capture.resolve()
    boundary = json.loads((capture / "quiet-idle-boundary.json").read_text())
    names = [name for name in boundary["audioSizes"] if name.endswith("_dspdump.wav")]
    if len(names) != 1:
        parser.error("Expected one DSP dump in quiet-idle-boundary.json")
    source = capture / "Audio" / names[0]
    prefix_bytes = boundary["audioSizes"][names[0]]
    with source.open("rb") as file:
        prefix = file.read(prefix_bytes)
    if len(prefix) != prefix_bytes:
        parser.error("Quiet capture boundary exceeds available audio")
    if prefix[:4] != b"RIFF" or prefix[8:16] != b"WAVEfmt " or prefix[36:40] != b"data":
        parser.error("Expected the local Dolphin 44-byte PCM WAV header")
    fmt = struct.unpack_from("<HHIIHH", prefix, 20)
    if fmt != (1, 2, 32000, 128000, 4, 16):
        parser.error(f"Expected original stereo 32 kHz PCM16, got {fmt}")
    pcm = memoryview(prefix)[44 : 44 + (len(prefix) - 44) // 4 * 4]
    sample_count = len(pcm) // 4
    archive = Archive(options.sound_archive)
    _, ideal = archive.sequence(archive.sounds["WIPL_BGM_MENU"], include_tracks=False)
    ticks = [round(ideal[name] * 114 * 48 / 60) for name in ("loopStart", "loopEnd")]
    if ticks != [383, 6527]:
        parser.error(
            "BGM sequence differs from the verified source fixture; re-audit native timing"
        )
    frames = native_tick_frames(ticks)
    canonical_start, canonical_end = [frames[tick] * 96 for tick in ticks]
    loop_start = canonical_start + options.phase_offset_samples
    loop_end = canonical_end + options.phase_offset_samples
    begin, end = options.start_sample, options.start_sample + loop_end
    if begin < 0 or begin % 96 or loop_start < 0 or end + 1024 > sample_count:
        parser.error(
            "BGM start must align with a 96-sample AX block and the complete loop/join must lie within the quiet prefix"
        )
    first_join, second_join = begin + loop_start, end
    before = pcm[(first_join - 1024) * 4 : (first_join + 1024) * 4]
    after = pcm[(second_join - 1024) * 4 : (second_join + 1024) * 4]
    if before != after:
        parser.error(
            "Loop does not have the required matching 64 ms PCM neighborhood. Inspect another phase; no smoothing or crossfade is applied."
        )
    # Independently compare the musical envelope across the proposed repeat.
    lag_ms = round((loop_end - loop_start) / 32)
    envelope = rms_envelope(pcm, begin, max_windows=50000 + lag_ms + 2)
    comparison_end = min(50000, len(envelope) - lag_ms - 2)
    repeat_correlation = None
    if comparison_end > 15000:
        first = envelope[5000:comparison_end]
        second = envelope[5000 + lag_ms : comparison_end + lag_ms]
        repeat_correlation = correlation(first, second)
    assets = options.assets.resolve()
    directory = assets / "audio"
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / "background-native.wav"
    with wave.open(str(destination), "wb") as output:
        output.setparams((2, 2, 32000, 0, "NONE", "not compressed"))
        output.writeframes(pcm[begin * 4 : end * 4])
    entry = {
        "src": "/assets/audio/background-native.wav",
        "sourceSymbol": "WIPL_BGM_MENU",
        "gain": 1,
        "rendering": "original-menu-emulated-ax-capture",
        "includesStartupWave": True,
        "loopStart": loop_start / 32000,
        "loopEnd": loop_end / 32000,
    }
    provenance = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceCapture": "Audio/" + source.name,
        "quietBoundary": "quiet-idle-boundary.json",
        "sourcePrefixBytes": prefix_bytes,
        "sourcePrefixSha256": hashlib.sha256(prefix).hexdigest(),
        "outputSha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
        "sourceBgmArchiveSha256": hashlib.sha256(archive.data).hexdigest(),
        "startSample": begin,
        "endSampleExclusive": end,
        "sampleRate": 32000,
        "channels": 2,
        "pcmSamplesPerChannel": end - begin,
        "samplesUnchanged": True,
        "canonicalSequenceLoopSamples": [canonical_start, canonical_end],
        "loopPhaseOffsetSamples": options.phase_offset_samples,
        "nativeSequenceTicks": ticks,
        "nativeAxFrames": [frames[tick] for tick in ticks],
        "axFrameSamples": 96,
        "loopMatchingNeighborhoodSamples": 2048,
        "loopMatchingNeighborhoodMaxDifference": 0,
        "repeatEnvelopeCorrelation": repeat_correlation,
        "repeatEnvelopeWindowSeconds": (
            [5, comparison_end / 1000] if repeat_correlation is not None else None
        ),
        "runtime": "Supplied System Menu executed in the recorded native emulator",
        "limitations": "Emulator capture, not a physical Wii recording. Repeating PCM preserves one recorded loop; it does not execute the live sequencer's subsequent random/modulator state.",
        "timingSource": "Original RSEQ ticks 383→6527; proposed AX loop boundaries independently verified against unchanged captured PCM",
    }
    session_path = capture / "capture-session.json"
    if session_path.exists():
        session = json.loads(session_path.read_text())
        provenance["referenceBuild"] = {
            key: session[key]
            for key in ("runtime", "runtimeVersion", "emulatorSha256", "wadSha256", "videoMode")
            if key in session
        }
    record = {"background": entry, "provenance": provenance}
    report = capture / "analysis/background"
    report.mkdir(parents=True, exist_ok=True)
    (report / "background-capture.json").write_text(format_json(record))
    if options.activate:
        (directory / "background-capture.json").write_text(format_json(record))
        audio_path = assets / "audio.json"
        audio = json.loads(audio_path.read_text()) if audio_path.exists() else {}
        audio["background"] = entry
        audio_path.write_text(format_json(audio))
        manifest_path = assets / "manifest.json"
        if manifest_path.exists():
            manifest = json.loads(manifest_path.read_text())
            manifest.setdefault("audio", {}).update(audio)
            manifest_path.write_text(format_json(manifest))
        provenance_path = directory / "provenance.json"
        combined = json.loads(provenance_path.read_text()) if provenance_path.exists() else {}
        combined.setdefault("sounds", {})["background"] = entry
        combined["nativeBackground"] = provenance
        combined["limitations"] = (
            "Effects retain their documented decoding/mixing limits. BGM uses unchanged emulator AX/DSP PCM; physical hardware equivalence is not independently verified."
        )
        provenance_path.write_text(format_json(combined))
    print(
        json.dumps(
            {
                "file": str(destination),
                "active": options.activate,
                "loopStart": entry["loopStart"],
                "loopEnd": entry["loopEnd"],
                "loopPeriod": (loop_end - loop_start) / 32000,
                "matchingJoinSamples": 2048,
                "gain": 1,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
