#!/usr/bin/env python3
"""Export local IplSound effects and dependency-free sequenced menu music.

Wave decoding is lossless. Synthesized playback remains an explicitly
approximate mix; an activated local native capture is preserved by default.
"""

from __future__ import annotations

try:
    from tools.json_format import format_json
except ModuleNotFoundError:  # Direct execution from a tools subdirectory.
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from json_format import format_json

import argparse
from array import array
import hashlib
import json
from pathlib import Path
import struct
import sys
import wave

from export import ROOT
from native_audio_tables import load_native_audio_tables
from sequence_audio import (
    RENDERER_VERSION, export_sequence_resources, render_sequence_background, render_sequence_file,
)

SOUNDS = {
    # Wii Menu starts the looping BGM with this original one-shot phrase.
    # It is a separate BRSAR wave, so omitting it leaves the first startup
    # seconds silent even though the later BGM sequence is complete.
    "backgroundIntro": "WIPL_SE_WII_START",
    "hover": "WIPL_SE_CH_TARGETTING",
    "buttonHover": "WIPL_SE_BT_TARGETTING",
    "select": "WIPL_SE_CH_SELECT",
    "click": "WIPL_SE_BT_PUSH",
    "back": "WIPL_SE_CH_UNSELECT",
    "confirm": "WIPL_SE_DECIDE",
    "cancel": "WIPL_SE_CANCEL",
    "page": "WSD_SELECT",
    "balloon": "WIPL_SE_BALLOON",
    "infoWindow": "WIPL_SE_INFO_WINDOW",
    "grab": "WIPL_SE_CH_HOLD",
    "drop": "WIPL_SE_CH_SET",
    "invalidDrop": "WIPL_SE_CH_NOT_MOVE",
    "drag": "WIPL_SE_CH_DRAG",
    "discPreview": "WIPL_ME_NO_DISC_BANNER",
    "dateSelect": "WIPL_SE_DATE_SELECT",
}


class Archive:
    def __init__(self, path):
        self.data = Path(path).read_bytes()
        if self.data[:8] != b"RSAR\xfe\xff\x01\x01":
            raise ValueError("Expected the supplied big-endian RSAR 1.1 archive")
        self.info = self.u32(24) + 8
        symb = self.u32(16) + 8
        table = symb + self.u32(symb)
        self.names = [
            self.data[symb + self.u32(table + 4 + i * 4) :].split(b"\0", 1)[0].decode()
            for i in range(self.u32(table))
        ]
        self.sounds = {}
        for entry in self.refs(self.ref(self.info), self.info):
            self.sounds[self.names[self.u32(entry)]] = {
                "file": self.u32(entry + 4),
                "volume": self.data[entry + 20],
                "type": self.data[entry + 22],
                "extra": self.ref(entry + 24),
            }

    def u32(self, offset):
        return struct.unpack_from(">I", self.data, offset)[0]

    def ref(self, offset, base=None):
        return (self.info if base is None else base) + self.u32(offset + 4)

    def refs(self, offset, base):
        return [self.ref(offset + 4 + 8 * i, base) for i in range(self.u32(offset))]

    def file(self, index):
        file_info = self.refs(self.ref(self.info + 24), self.info)[index]
        file_group = self.refs(self.ref(file_info + 20), self.info)[0]
        group = self.refs(self.ref(self.info + 32), self.info)[self.u32(file_group)]
        item_index = self.u32(file_group + 4)
        item = self.refs(self.ref(group + 32), self.info)[item_index]
        return {
            "header": self.u32(group + 16) + self.u32(item + 4),
            "wave": self.u32(group + 24) + self.u32(item + 12),
            "group": self.names[self.u32(group)],
            "item": item_index,
        }

    def bank(self, index):
        entry = self.refs(self.ref(self.info + 8), self.info)[index]
        return self.file(self.u32(entry + 4))

    def instrument(self, bank, program, key, velocity):
        base = bank["header"] + self.u32(bank["header"] + 16) + 8
        ref = base + 4 + program * 8
        for value in (key, velocity):
            kind = self.data[ref + 1]
            target = self.ref(ref, base)
            if kind == 1:
                return target
            if kind == 2:
                count = self.data[target]
                slot = next(i for i in range(count) if value <= self.data[target + 1 + i])
                ref = target + ((count + 4) // 4) * 4 + slot * 8
            elif kind == 3:
                low, high = self.data[target : target + 2]
                if not low <= value <= high:
                    raise ValueError("Note outside instrument range")
                ref = target + 4 + (value - low) * 8
            else:
                raise ValueError(f"Unsupported instrument region {kind}")
        if self.data[ref + 1] != 1:
            raise ValueError("Instrument has no direct wave region")
        return self.ref(ref, base)

    def bank_wave(self, bank, index):
        base = bank["header"] + self.u32(bank["header"] + 24) + 8
        return self.ref(base + 4 + index * 8, base)

    def decode_wave(self, info, wave_base):
        codec, loop, channels = self.data[info : info + 3]
        rate = int.from_bytes(self.data[info + 3 : info + 6], "big")
        last_address = self.u32(info + 12)
        count = (
            last_address // 16 * 14 + last_address % 16 - 2 if codec == 2 else last_address
        ) + 1
        if channels not in (1, 2) or not 0 < count < 20_000_000 or not 0 < rate < 192001:
            raise ValueError("Invalid wave metadata")
        table = info + self.u32(info + 16)
        pcm = []
        for channel in range(channels):
            meta = info + self.u32(table + channel * 4)
            start = wave_base + self.u32(info + 20) + self.u32(meta)
            if codec == 2:
                adpcm = info + self.u32(meta + 4)
                coefficients = struct.unpack_from(">16h", self.data, adpcm)
                history = struct.unpack_from(">2h", self.data, adpcm + 36)
                pcm.append(
                    decode_dsp(
                        self.data[start : start + (count + 13) // 14 * 8],
                        count,
                        coefficients,
                        *history,
                    )
                )
            elif codec == 1:
                pcm.append(array("h", struct.unpack_from(f">{count}h", self.data, start)))
            elif codec == 0:
                pcm.append(
                    array(
                        "h", (x * 256 for x in struct.unpack_from(f">{count}b", self.data, start))
                    )
                )
            else:
                raise ValueError(f"Unsupported wave codec {codec}")
        return pcm, rate, bool(loop)

    def sequence(self, sound, *, include_tracks=True, on_event=None, strict=False):
        header = self.file(sound["file"])["header"]
        data = header + self.u32(header + 16)
        base = data + self.u32(data + 8)
        return walk_sequence(
            self.data, base, self.u32(sound["extra"]), include_tracks=include_tracks,
            on_event=on_event, strict=strict,
        )


def decode_dsp(data, count, coefficients, history1=0, history2=0):
    """Nintendo DSP ADPCM: 8 bytes encode 14 samples, rounded then saturated."""
    samples = array("h")
    for block in range(0, len(data), 8):
        header = data[block]
        predictor, scale = header >> 4, 1 << (header & 15)
        if predictor > 7:
            raise ValueError("Invalid ADPCM predictor")
        a, b = coefficients[predictor * 2 : predictor * 2 + 2]
        for packed in data[block + 1 : block + 8]:
            for nibble in (packed >> 4, packed & 15):
                value = nibble if nibble < 8 else nibble - 16
                sample = (value * scale * 2048 + a * history1 + b * history2 + 1024) >> 11
                sample = max(-32768, min(32767, sample))
                samples.append(sample)
                history2, history1 = history1, sample
                if len(samples) == count:
                    return samples
    raise ValueError("Truncated ADPCM data")


def walk_sequence(data, base, start, *, include_tracks=True, on_event=None, strict=False):
    """Read effect tracks, preserving their independent clocks and note-wait state.

    Legacy note tuples expose ideal seconds for effect export. An optional
    observer receives exact track ticks, including controller writes, so the
    background renderer can apply the player's shared native tempo clock.
    """
    pending = [(0, start, 0.0, 120, 0)]
    events, visited_tracks, primary_loop = [], set(), {}

    def open_track(track, offset, seconds, tempo, tick):
        if include_tracks:
            pending.append((track, offset, seconds, tempo, tick))

    while pending:
        track, offset, seconds, tempo, tick = pending.pop(0)
        if track in visited_tracks or not 0 <= track < 16:
            raise ValueError("Effect reopens a track or exceeds the native track count")
        visited_tracks.add(track)
        def observe(kind, time, value, event_tick):
            if on_event is not None:
                on_event(track, kind, time, value, event_tick)

        notes, loop = _walk_track(
            data, base, offset, seconds, tempo, tick, open_track, observe, strict
        )
        events.extend(notes)
        if track == 0:
            primary_loop = loop
    return sorted(events, key=lambda note: note[0]), primary_loop


def _walk_track(
    data, base, start, initial_time, initial_tempo, initial_tick, open_track, observe, strict
):
    offset, seconds, program = start, initial_time, 0
    tick = initial_tick
    # USA 4.3 binary: MmlSeqTrack constructor 0x81502B44 stores 1 at +0xC1;
    # parser 0x81501D88 tests it before assigning the note length to +0x58.
    tempo, timebase, note_wait = initial_tempo, 48, True
    calls, visited, events = [], {}, []
    volume, pan, transpose = 127, 64, 0

    def variable():
        nonlocal offset
        result = 0
        for _ in range(5):
            value = data[base + offset]
            offset += 1
            result = result * 128 + (value & 127)
            if value < 128:
                return result
        raise ValueError("Invalid sequence integer")

    for _ in range(100_000):
        visited.setdefault(offset, (seconds, tick))
        command = data[base + offset]
        offset += 1
        if command < 0x80:
            velocity = data[base + offset]
            offset += 1
            length_ticks = variable()
            duration = length_ticks * 60 / tempo / timebase
            key = min(127, max(0, command + transpose))
            note = (seconds, program, key, velocity, duration, volume, pan)
            events.append(note)
            observe("note", seconds, {
                "note": note,
                "lengthTicks": length_ticks,
                # MmlParser 0x81501D88–0x81501DA4 sets noteFinishWait for a
                # zero-length note while note-wait is enabled. The following
                # commands retain their source ticks; playback owns the wait.
                "waitForEnd": note_wait and length_ticks == 0,
            }, tick)
            if note_wait:
                seconds += duration
                tick += length_ticks
        elif command == 0x80:
            wait_ticks = variable()
            seconds += wait_ticks * 60 / tempo / timebase
            tick += wait_ticks
        elif command == 0x81:
            program = variable()
        elif command == 0x88:
            track = data[base + offset]
            destination = int.from_bytes(data[base + offset + 1 : base + offset + 4], "big")
            open_track(track, destination, seconds, tempo, tick)
            offset += 4
        elif command in (0x89, 0x8A):
            destination = int.from_bytes(data[base + offset : base + offset + 3], "big")
            offset += 3
            if command == 0x89:
                if destination in visited:
                    loop_start, loop_tick = visited[destination]
                    loop = {"loopStart": loop_start, "loopEnd": seconds}
                    observe("loop", seconds, (loop_tick, tick), tick)
                    return events, loop
                offset = destination
                continue
            calls.append(offset)
            offset = destination
        elif command == 0xFD:
            if not calls:
                return events, {}
            offset = calls.pop()
        elif command == 0xA0:
            if strict:
                raise ValueError("Built-in background rendering does not support random commands")
            # MSG_DISP and CHAR_INPUT/DELETE/DECIDE randomize pitch bend. A
            # prepared PCM effect uses the center value; runtime AX modulation
            # remains a documented approximation, not a substitute tone.
            target = data[base + offset]
            if target != 0xC4:
                raise ValueError(f"Unsupported randomized instruction {target:#x}")
            offset += 5
        elif command == 0xFE:
            offset += 2
        elif command == 0xFF:
            return events, {}
        elif command == 0xC3:
            # Original command dispatch 0x815022EC stores signed transposition
            # at track+0x87; note parsing 0x81501D18 adds it and clamps to MIDI.
            transpose = int.from_bytes(data[base + offset : base + offset + 1], "big", signed=True)
            offset += 1
        elif command == 0xE1:
            tempo = int.from_bytes(data[base + offset : base + offset + 2], "big")
            offset += 2
            if tempo == 0:
                raise ValueError("Sequence tempo must be positive")
            observe("tempo", seconds, tempo, tick)
        elif command in (0xE0, 0xE3):
            if strict:
                raise ValueError(f"Unsupported background controller {command:#x}")
            offset += 2
        elif command in (
            0xB0,
            0xB1,
            0xC0,
            0xC1,
            0xC2,
            0xC6,
            0xC7,
            0xCA,
            0xCB,
            0xCC,
            0xCD,
            0xD0,
            0xD1,
            0xD2,
            0xD3,
            0xD5,
            0xD7,
            0xD8,
            0xD9,
            0xDA,
            0xDB,
            0xDE,
        ):
            value = data[base + offset]
            offset += 1
            if command == 0xB0:
                if not value:
                    raise ValueError("Sequence timebase must be positive")
                timebase = value
                observe("timebase", seconds, value, tick)
            elif command == 0xC0:
                pan = value
                observe("pan", seconds, value, tick)
            elif command in (0xC1, 0xC2):
                volume = value
                observe("volume" if command == 0xC1 else "mainVolume", seconds, value, tick)
            elif command == 0xC7:
                note_wait = bool(value)
            elif command in (0xD0, 0xD1, 0xD2, 0xD3):
                observe(("attack", "decay", "sustain", "release")[command - 0xD0], seconds, value, tick)
            elif command == 0xD5:
                observe("volume2", seconds, value, tick)
            elif command == 0xDB:
                observe("mainSend", seconds, value, tick)
            elif command in (0xD9, 0xDA, 0xDE):
                observe({0xD9: "auxA", 0xDA: "auxB", 0xDE: "auxC"}[command], seconds, value, tick)
            elif strict:
                raise ValueError(f"Unsupported background controller {command:#x}")
        else:
            raise ValueError(f"Unsupported sequence instruction {command:#x} at {offset - 1:#x}")
    raise ValueError("Sequence instruction budget exceeded")


def write_wav(path, pcm, rate):
    interleaved = array(
        "h", (max(-32768, min(32767, round(value))) for frame in zip(*pcm) for value in frame)
    )
    if sys.byteorder != "little":
        interleaved.byteswap()
    with wave.open(str(path), "wb") as output:
        output.setparams((len(pcm), 2, rate, 0, "NONE", "not compressed"))
        output.writeframes(interleaved.tobytes())


def render_effect(archive, sound, path, *, tables, assets, symbol, name):
    if sound["type"] == 3:
        file = archive.file(sound["file"])
        data = file["header"] + archive.u32(file["header"] + 16) + 8
        wsd = archive.refs(data, data)[archive.u32(sound["extra"])]
        note = archive.refs(archive.ref(wsd + 16, data), data)[0]
        wave_table = file["header"] + archive.u32(file["header"] + 24)
        info = wave_table + archive.u32(wave_table + 12 + archive.u32(note) * 4)
        pcm, rate, _ = archive.decode_wave(info, file["wave"])
        write_wav(path, pcm, rate)
        return "decoded-original-wave"
    if sound["type"] != 1:
        raise ValueError("Unsupported sound type")
    bank = archive.bank(archive.u32(sound["extra"] + 4))
    events, _ = archive.sequence(sound)
    if len(events) == 1:
        time, program, key, velocity, duration, *_ = events[0]
        instrument = archive.instrument(bank, program, key, velocity)
        info = archive.bank_wave(bank, archive.u32(instrument))
        pcm, source_rate, looping = archive.decode_wave(info, bank["wave"])
        pitch = struct.unpack_from(">f", archive.data, instrument + 16)[0]
        if looping and time == 0 and duration == 0 and pitch == 1 and key == archive.data[instrument + 12]:
            # The movement loop retains its original sample boundaries. Its
            # attack/release remain controlled by the browser drag lifecycle.
            write_wav(path, pcm, source_rate)
            return "original-looping-wave-without-AX-envelope"
    definition = export_sequence_resources(
        archive, tables, assets, symbol=symbol, name=name, require_loop=False,
    )
    render_sequence_file(assets / f"audio/{name}-sequence.json", path)
    return "original-sequence-built-in-reverb-approximate" if definition["reverb"] else (
        "original-sequence-built-in-dry-approximate"
    )


def message_scroll_loop_metadata(definition):
    """Publish the cue's verified periodic region for owned browser loops."""
    offline = definition["offline"]
    return {
        "loop": True,
        "loopStart": offline["loopStart"],
        "loopEnd": offline["loopEnd"],
        "loopFrames": offline["frames"],
        "loopSequenceCycles": offline["loopSequenceCycles"],
    }


def local_asset_path(assets, source):
    if not isinstance(source, str) or not source.startswith("/assets/"):
        raise ValueError("Background must reference a local /assets/ resource")
    path = (assets / source.removeprefix("/assets/")).resolve()
    if not path.is_relative_to(assets.resolve()):
        raise ValueError("Background resource escapes the prepared assets directory")
    return path


def load_captured_background(assets):
    """An explicit local capture survives ordinary asset regeneration."""
    marker = assets / "audio/background-capture.json"
    if not marker.exists():
        return None
    capture = json.loads(marker.read_text())
    entry = capture["background"]
    path = local_asset_path(assets, entry["src"])
    if not path.is_file():
        raise ValueError(
            "Captured BGM is missing. Re-export the capture or choose --background-source builtin."
        )
    expected = capture["provenance"]["outputSha256"]
    if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        raise ValueError("Captured BGM checksum changed; re-export it before regenerating assets.")
    return capture


def prepare_background(archive, assets, content, *, force=False, definition=None):
    if definition is None:
        tables = load_native_audio_tables(content)
        definition = export_sequence_resources(archive, tables, assets)
    directory = assets / "audio"
    marker = directory / "background-build.json"
    archive_hash = hashlib.sha256(archive.data).hexdigest()
    if marker.is_file() and not force:
        try:
            previous = json.loads(marker.read_text())
        except (OSError, ValueError):
            previous = {}
        if not isinstance(previous, dict):
            previous = {}
        expected = (
            previous.get("rendererVersion") == RENDERER_VERSION
            and previous.get("sourceArchiveSha256") == archive_hash
            and previous.get("sourceDriverSha256") == definition["sourceDriverSha256"]
        )
        if expected:
            path = local_asset_path(assets, previous.get("src"))
            matches_output = (
                path.is_file()
                and hashlib.sha256(path.read_bytes()).hexdigest() == previous.get("outputSha256")
            )
            if matches_output:
                return previous
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / "background.wav"
    temporary = directory / ".background.pending.wav"
    try:
        metadata = render_sequence_background(definition, assets, temporary)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    entry = {
        "src": "/assets/audio/background.wav",
        "sourceSymbol": "WIPL_BGM_MENU",
        "gain": 1,
        **metadata,
        "outputSha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
    }
    marker.write_text(format_json(entry))
    return entry


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / ".local/IplSound.brsar")
    parser.add_argument("--output", type=Path, default=ROOT / "web/public/assets")
    parser.add_argument(
        "--background",
        action="store_true",
        help="Compatibility option: background music is now prepared by default",
    )
    parser.add_argument(
        "--background-source",
        choices=("auto", "capture", "builtin"),
        default="auto",
        help="auto preserves activated native PCM, otherwise renders the original sequence locally",
    )
    parser.add_argument(
        "--native-content", type=Path,
        default=ROOT / ".local/titles/0000000100000002/content",
        help="Supplied System Menu executable or extracted content directory for native audio tables",
    )
    args = parser.parse_args()
    archive = Archive(args.source)
    directory = args.output / "audio"
    directory.mkdir(parents=True, exist_ok=True)
    manifest = {}
    tables = load_native_audio_tables(args.native_content)
    sounds = dict(SOUNDS)
    for symbol in archive.sounds:
        if symbol.startswith(
            ("WIPL_SE_SK_", "WIPL_SE_CHAR_", "WIPL_SE_BOARD_", "HOMESE_")
        ) or symbol in {
            "WIPL_SE_MSG_DISP",
            "WIPL_SE_LINE_SCROLL",
            "WIPL_SE_SYMBOL_PAGE_OPEN",
            "WIPL_SE_MESSAGE_SCROLL",
            "WIPL_SE_CHOICE_CHG",
            "WIPL_SE_OUTPUT_MODE_SELECT",
            "WIPL_SE_FL_PAGE_INC",
            "WIPL_SE_FL_PAGE_DEC",
        }:
            sounds[symbol] = symbol
    for name, symbol in sounds.items():
        sound = archive.sounds[symbol]
        path = directory / f"{name}.wav"
        rendering = render_effect(
            archive, sound, path, tables=tables, assets=args.output, symbol=symbol, name=name,
        )
        manifest[name] = {
            "src": f"/assets/audio/{name}.wav",
            "sourceSymbol": symbol,
            # snd_SoundArchivePlayer.cpp: SetInitialVolume(volume / 127.0f).
            "gain": 1 if rendering.startswith("original-sequence-built-in-") else sound["volume"] / 127,
            "rendering": rendering,
        }
        if rendering == "original-looping-wave-without-AX-envelope":
            events, _ = archive.sequence(sound)
            _, program, key, velocity, *_ = events[0]
            bank = archive.bank(archive.u32(sound["extra"] + 4))
            instrument = archive.instrument(bank, program, key, velocity)
            info = archive.bank_wave(bank, archive.u32(instrument))
            pcm, rate, _ = archive.decode_wave(info, bank["wave"])
            start = archive.u32(info + 8)
            if archive.data[info] == 2:
                start = start // 16 * 14 + start % 16 - 2
            manifest[name].update(
                loop=True, loopStart=max(0, start) / rate, loopEnd=len(pcm[0]) / rate
            )
        elif symbol == "WIPL_SE_MESSAGE_SCROLL":
            definition = json.loads((directory / f"{name}-sequence.json").read_text())
            manifest[name].update(message_scroll_loop_metadata(definition))
    capture = (
        load_captured_background(args.output) if args.background_source != "builtin" else None
    )
    definition = export_sequence_resources(archive, tables, args.output)
    if capture:
        manifest["background"] = capture["background"]
        print(
            "Preserving activated native BGM capture (choose --background-source builtin to regenerate)."
        )
    elif args.background_source == "capture":
        parser.error(
            "No activated native BGM capture. Run tools/reference/export_captured_bgm.py first."
        )
    else:
        manifest["background"] = prepare_background(
            archive, args.output, args.native_content,
            force=args.background_source == "builtin",
            definition=definition,
        )
        print("Prepared original menu sequence with the built-in renderer (AX mix comparison pending).")
    sequence_path = args.output / "audio/background-sequence.json"
    manifest["background"]["sequence"] = {
        "src": "/assets/audio/background-sequence.json",
        "rendering": "original-sequence-realtime-reverb-approximate" if definition["reverb"] else (
            "original-sequence-realtime-dry-approximate"
        ),
        "sha256": hashlib.sha256(sequence_path.read_bytes()).hexdigest(),
    }
    (args.output / "audio.json").write_text(format_json(manifest))
    provenance = {
        "source": "sound/IplSound.brsar",
        "sha256": hashlib.sha256(archive.data).hexdigest(),
        "limitations": (
            "Sample decoding is exact; sequenced PCM is not verified native AX output. "
            "Built-in BGM retains native lookup tables, clocks and automation, "
            "with original AuxA ReverbHi routing, two-block bus latency and "
            "zero-length note-completion waits for effects. "
            "Integer envelope/send stages, separate float32 note-gain and envelope arithmetic "
            "including the decibel-table lookup, "
            "96-sample envelope ramps and 16.16 source stepping "
            "follow original instructions; "
            "sample interpolation and complete native mix equivalence remain unverified; "
            "randomized pitch is centered."
        ),
        "sounds": manifest,
    }
    if capture:
        provenance["nativeBackground"] = capture["provenance"]
        provenance["limitations"] = (
            "Effects and live synthesis follow original integer volume stages, "
            "separate float32 note-gain and envelope arithmetic and decibel-table lookup, "
            "96-sample envelope ramps, 16.16 source stepping, AuxA routing and ReverbHi. Interpolation "
            "and complete native mix equivalence remain unverified; randomized pitch is centered. "
            "Prepared BGM is unchanged PCM "
            "from original menu AX output in the local RecompCore emulator; "
            "physical hardware equivalence is not independently verified."
        )
    (directory / "provenance.json").write_text(format_json(provenance))
    print(f"Exported {len(manifest)} original-source sounds to {directory}")


if __name__ == "__main__":
    main()
