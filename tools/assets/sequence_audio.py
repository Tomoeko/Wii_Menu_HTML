"""Dependency-free rendering of the supplied menu's sequence and instrument bank.

Python extracts the original sequence and sample resources; the same JavaScript
engine renders offline PCM under Node and live audio in the browser worklet.
No third-party synthesis or codec package is used.
"""

from __future__ import annotations

from array import array
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys


SAMPLE_RATE = 32000
AX_BLOCK_SAMPLES = 96
AX_AUX_LATENCY_SAMPLES = 2 * AX_BLOCK_SAMPLES
RENDERER_VERSION = 11


def tick_sample_positions(last_tick, tempo_events):
    """Run SeqPlayer's integer 416-threshold clock, one update per 3 ms."""
    if not 0 <= last_tick <= 1_000_000:
        raise ValueError("Sequence tick count exceeds the renderer budget")
    changes = dict(tempo_events)
    if any(not 1 <= value <= 1000 for value in changes.values()):
        raise ValueError("Sequence tempo is outside the renderer budget")
    counter, tempo, tick, block = 416, 120, 0, 0
    positions = []
    while tick <= last_tick:
        due, counter = divmod(counter, 416)
        counter += tempo
        for _ in range(due):
            positions.append(block * AX_BLOCK_SAMPLES)
            tempo = changes.get(tick, tempo)
            tick += 1
        block += 1
        if block * AX_BLOCK_SAMPLES > SAMPLE_RATE * 600:
            raise ValueError("Background sequence exceeds ten minutes")
    return positions


CONTROLLERS = {
    "volume", "volume2", "pan", "mainVolume", "mainSend", "auxA", "auxB", "auxC",
    "attack", "decay", "sustain", "release",
}


def read_timeline(archive, sound, *, require_loop=True):
    events, tempos, loops = [], [], {}

    def observe(track, kind, seconds, value, tick):
        if kind == "note":
            events.append({"track": track, "tick": tick, "kind": kind, **value})
        elif kind in CONTROLLERS or kind == "tempo":
            events.append({"track": track, "tick": tick, "kind": kind, "value": value})
            if kind == "tempo":
                tempos.append((tick, value))
        elif kind == "timebase" and value != 48:
            raise ValueError("Built-in sequencing requires the original 48-tick timebase")
        elif kind == "loop":
            loops[track] = value

    archive.sequence(sound, on_event=observe, strict=require_loop)
    if not any(event["kind"] == "note" for event in events):
        raise ValueError("Sequence contains no notes")
    loop = loops.get(0)
    if require_loop and loop is None:
        raise ValueError("Background sequence has no primary loop")
    if loop and (loop[1] <= loop[0] or any(value != loop for value in loops.values())):
        raise ValueError("Sequence tracks do not share a bounded synchronized loop")
    if any(tick != 0 for tick, _ in tempos):
        raise ValueError("Sequence tempo changes after startup need a separate clock audit")
    # Stable sorting retains command order within each track at the same tick.
    # This matters when an ADSR write follows a note, or AuxA changes mid-note.
    events.sort(key=lambda event: (event["tick"], event["track"]))
    return events, tempos, loop


def message_scroll_offline(events, tempos, loop, regions, dry_frames, has_aux):
    """Export one complete clock period for the audited dry reader movement cue.

    The 24-tick loop is not an integer number of 3 ms updates at tempo 120.
    Five musical cycles restore the 416-threshold accumulator phase; repeating
    one or two rendered cycles shifts later notes. This bounded special case
    requires voices to finish before the next cycle and has no reverb state.
    """
    notes = [event for event in events if event["kind"] == "note"]
    profile = [(event["track"], event["tick"], event["length"]) for event in notes]
    if (loop != (0, 24) or dict(tempos).get(0, 120) != 120 or has_aux
            or profile != [(0, 0, 1), (0, 6, 2)]
            or any(event["kind"] not in ("note", "tempo") for event in events)
            or any(region["envelope"] != [127, 127, 127, 127] for region in regions)):
        raise ValueError("MESSAGE_SCROLL has an unsupported sequence loop profile")
    if dry_frames >= tick_sample_positions(loop[1], tempos)[loop[1]]:
        raise ValueError("MESSAGE_SCROLL voices overlap its sequence loop boundary")
    cycles = 120 // math.gcd(120, 416 * (loop[1] - loop[0]))
    period_tick = cycles * loop[1]
    frames = tick_sample_positions(period_tick, tempos)[period_tick]
    return {"frames": frames, "loopStart": 0, "loopEnd": frames / SAMPLE_RATE,
            "loopSequenceCycles": cycles}


def export_sequence_resources(
    archive, tables, assets, *, symbol="WIPL_BGM_MENU", name="background", require_loop=True
):
    """Export bounded local sample/driver data shared by both playback modes."""
    sound = archive.sounds[symbol]
    events, tempos, loop = read_timeline(archive, sound, require_loop=require_loop)
    bank = archive.bank(archive.u32(sound["extra"] + 4))
    regions, region_indices, waves, wave_indices = [], {}, [], {}
    directory = assets / "audio/sequence" / name
    directory.mkdir(parents=True, exist_ok=True)
    last_tick = max(event["tick"] for event in events)
    positions = tick_sample_positions(last_tick, tempos)
    dry_frames = 0
    total_wave_frames = 0
    finish_waits = sum(event.get("waitForEnd", False) for event in events)
    if loop and finish_waits:
        raise ValueError("Looping tracks with voice-finish waits require a separate timing audit")
    for event in events:
        if event["kind"] != "note":
            continue
        _, program, key, velocity, *_ = event.pop("note")
        instrument = archive.instrument(bank, program, key, velocity)
        if instrument not in region_indices:
            wave_index = archive.u32(instrument)
            if wave_index not in wave_indices:
                info = archive.bank_wave(bank, wave_index)
                pcm, rate, looping = archive.decode_wave(info, bank["wave"])
                if looping:
                    raise ValueError("Sequence contains an unverified looping instrument")
                index = len(waves)
                wave_indices[wave_index] = index
                samples = array("h", (sample for frame in zip(*pcm) for sample in frame))
                if sys.byteorder != "little":
                    samples.byteswap()
                data = samples.tobytes()
                (directory / f"wave-{index}.pcm").write_bytes(data)
                waves.append({
                    "src": f"/assets/audio/sequence/{name}/wave-{index}.pcm",
                    "rate": rate,
                    "channels": len(pcm),
                    "frames": len(pcm[0]),
                    "sha256": hashlib.sha256(data).hexdigest(),
                })
            region_indices[instrument] = len(regions)
            root, volume, pan = archive.data[instrument + 12 : instrument + 15]
            regions.append({
                "wave": wave_indices[wave_index],
                "root": root,
                "volume": volume,
                "pan": pan,
                "tune": struct.unpack_from(">f", archive.data, instrument + 16)[0],
                "envelope": list(archive.data[instrument + 4 : instrument + 8]),
            })
        region = regions[region_indices[instrument]]
        wave = waves[region["wave"]]
        speed = wave["rate"] / SAMPLE_RATE * region["tune"] * 2 ** ((key - region["root"]) / 12)
        wave_frames = math.ceil(wave["frames"] / speed)
        total_wave_frames += wave_frames
        dry_frames = max(dry_frames, positions[event["tick"]] + wave_frames)
        event.update(
            key=key, velocity=velocity, length=event.pop("lengthTicks"),
            region=region_indices[instrument],
        )
    has_aux = any(event["kind"] == "auxA" and event["value"] for event in events)
    if has_aux and not tables.reverb:
        raise ValueError("AuxA sequence requires the original menu reverb parameters")
    if symbol == "WIPL_SE_MESSAGE_SCROLL" and not loop:
        raise ValueError("MESSAGE_SCROLL requires its original bounded sequence loop")
    if loop:
        loop_start, loop_end = loop
        second_end = loop_end + loop_end - loop_start
        positions = tick_sample_positions(second_end, tempos)
        offline = {
            "frames": positions[second_end],
            "loopStart": positions[loop_end] / SAMPLE_RATE,
            "loopEnd": positions[second_end] / SAMPLE_RATE,
        }
        if symbol == "WIPL_SE_MESSAGE_SCROLL":
            offline = message_scroll_offline(events, tempos, loop, regions, dry_frames, has_aux)
    else:
        loop_start = loop_end = None
        if finish_waits:
            # This is an allocation bound, not an altered musical timestamp.
            # Track-local waits are resolved by the shared runtime. Budget all
            # finite voices plus DSP feedback and one clock boundary per wait;
            # the offline writer trims the resulting trailing PCM zeros.
            minimum_tempo = min([120, *(value for _, value in tempos)])
            maximum_tick_frames = math.ceil(416 / minimum_tempo) * AX_BLOCK_SAMPLES
            dry_frames += total_wave_frames + finish_waits * (
                2 * AX_BLOCK_SAMPLES + maximum_tick_frames
            )
        # Three T60 periods retain the filter decay well below 16-bit PCM.
        tail_frames = (
            math.ceil(tables.reverb["preset"][1] * 3 * SAMPLE_RATE) + AX_AUX_LATENCY_SAMPLES
            if has_aux else 0
        )
        offline = {"frames": dry_frames + tail_frames, "trimSilence": True}
    definition = {
        "schemaVersion": 1,
        "sampleRate": SAMPLE_RATE,
        "loopStartTick": loop_start,
        "loopEndTick": loop_end,
        "gain": sound["volume"] / 127,
        "events": events,
        "regions": regions,
        "waves": waves,
        "tables": {
            "attack": tables.attack,
            "sustain": tables.sustain,
            "decibels": tables.decibels,
            "pan": tables.pan,
        },
        "reverb": tables.reverb if has_aux else None,
        "offline": offline,
        "rendererVersion": RENDERER_VERSION,
        "sourceArchiveSha256": hashlib.sha256(archive.data).hexdigest(),
        "sourceDriverSha256": tables.source_sha256,
    }
    path = assets / f"audio/{name}-sequence.json"
    path.write_text(json.dumps(definition, indent=2) + "\n")
    return definition


def render_sequence_file(definition_path, output):
    node = os.environ.get("WII_MENU_NODE") or shutil.which("node")
    if not node:
        raise RuntimeError("Sequence rendering requires the application's Node.js 20+ runtime")
    result = subprocess.run(
        [node, str(Path(__file__).with_name("render_sequence_audio.mjs")),
         str(definition_path), str(output)],
        check=True, capture_output=True, text=True,
    )
    return json.loads(result.stdout)


def render_sequence_background(definition, assets, output):
    measured = render_sequence_file(assets / "audio/background-sequence.json", output)
    return {
        "loopStart": definition["offline"]["loopStart"],
        "loopEnd": definition["offline"]["loopEnd"],
        "rendering": (
            "original-sequence-built-in-reverb-approximate"
            if definition["reverb"] else "original-sequence-built-in-dry-approximate"
        ),
        "rendererVersion": RENDERER_VERSION,
        "sourceArchiveSha256": definition["sourceArchiveSha256"],
        "sourceDriverSha256": definition["sourceDriverSha256"],
        "sequenceTicks": [definition["loopStartTick"], definition["loopEndTick"]],
        "noteCount": sum(event["kind"] == "note" for event in definition["events"]),
        "trackCount": len({event["track"] for event in definition["events"]}),
        "archiveGainApplied": definition["gain"],
        **measured,
    }
