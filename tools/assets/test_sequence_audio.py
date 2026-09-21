"""Synthetic behavioral fixtures for local sequence synthesis and cache safety."""

from array import array
from dataclasses import replace
import hashlib
import json
from pathlib import Path
import struct
import tempfile
import unittest
import wave
from unittest.mock import patch

from export_audio import (
    SOUNDS, load_captured_background, local_asset_path, message_scroll_loop_metadata,
    prepare_background, walk_sequence,
)
from native_audio_tables import NativeAudioTables, read_dol_address
from sequence_audio import (
    RENDERER_VERSION,
    export_sequence_resources,
    render_sequence_background, render_sequence_file,
    tick_sample_positions,
)


def constant_tables():
    return NativeAudioTables(
        attack=(0.0,) * 128,
        sustain=(0,) * 128,
        decibels=(1.0,) * 965,
        pan=(1.0,) * 257,
        source_sha256="synthetic-driver",
    )


class SustainedFixture:
    def __init__(self):
        self.data = bytearray(32)
        self.data[4:8] = bytes([127, 127, 127, 127])
        self.data[12:15] = bytes([60, 127, 64])
        struct.pack_into(">f", self.data, 16, 1.0)
        self.sounds = {"WIPL_BGM_MENU": {"extra": 20, "volume": 32}}
        self.decoded = 0

    def u32(self, offset):
        return struct.unpack_from(">I", self.data, offset)[0]

    def bank(self, index):
        return {"wave": 0}

    def instrument(self, bank, program, key, velocity):
        return 0

    def bank_wave(self, bank, index):
        return 0

    def decode_wave(self, info, wave_base):
        self.decoded += 1
        return [array("h", [30000] * 1200)], 32000, False

    def sequence(self, sound, *, on_event, strict):
        on_event(0, "volume", 0, 127, 0)
        for _ in range(2):
            on_event(0, "note", 0, {"lengthTicks": 0, "note": (0, 0, 60, 127, 0, 127, 64)}, 0)
        on_event(0, "volume", 0, 0, 1)
        on_event(0, "loop", 0, (0, 2), 2)


class MessageScrollFixture(SustainedFixture):
    """Authored finite PCM with the audited cue's tick/ADSR shape."""

    def __init__(self):
        super().__init__()
        self.sounds = {"WIPL_SE_MESSAGE_SCROLL": {"extra": 20, "volume": 80}}
        self.aux = False
        self.frames = 172

    def decode_wave(self, info, wave_base):
        return [array("h", [12000, -8000] * (self.frames // 2))], 32000, False

    def sequence(self, sound, *, on_event, strict):
        if self.aux:
            on_event(0, "auxA", 0, 1, 0)
        for tick, key, velocity, length in ((0, 59, 90, 1), (6, 60, 120, 2)):
            on_event(0, "note", 0, {
                "lengthTicks": length,
                "note": (0, 25, key, velocity, 0, 127, 64),
            }, tick)
        on_event(0, "loop", 0, (0, 24), 24)


class SequenceAudioTests(unittest.TestCase):
    def test_menu_audio_catalog_retains_the_original_startup_wave(self):
        self.assertEqual(SOUNDS["backgroundIntro"], "WIPL_SE_WII_START")

    def test_background_metadata_preserves_the_sequence_effect_profile(self):
        definition = {
            "offline": {"loopStart": 0.0, "loopEnd": 1.0},
            "reverb": {"delayFrames": [101, 149, 193, 29, 11, 7, 13, 17]},
            "rendererVersion": RENDERER_VERSION,
            "sourceArchiveSha256": "a" * 64,
            "sourceDriverSha256": "b" * 64,
            "loopStartTick": 0,
            "loopEndTick": 96,
            "events": [{"kind": "note", "track": 0}],
            "gain": 1,
        }
        with patch("sequence_audio.render_sequence_file", return_value={"frames": 32000}):
            metadata = render_sequence_background(definition, Path("assets"), Path("out.wav"))
        self.assertEqual(metadata["rendering"], "original-sequence-built-in-reverb-approximate")

    def test_python_export_retains_native_note_gain_at_integer_pcm_boundaries(self):
        for velocity, volume, coefficient in ((39, 127, 3090), (50, 115, 4598)):
            with self.subTest(velocity=velocity, volume=volume):
                fixture = SustainedFixture()
                fixture.data[13] = volume
                fixture.sounds["WIPL_BGM_MENU"]["volume"] = 127

                def sequence(sound, *, on_event, strict):
                    on_event(0, "note", 0, {
                        "lengthTicks": 0,
                        "note": (0, 0, 60, velocity, 0, 127, 64),
                    }, 0)

                def decode_wave(info, wave_base):
                    return [array("h", [-32768, 32767] * 96)], 32000, False

                with tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    with patch.object(fixture, "sequence", side_effect=sequence), \
                            patch.object(fixture, "decode_wave", side_effect=decode_wave):
                        export_sequence_resources(
                            fixture, constant_tables(), root, require_loop=False,
                        )
                    output = root / "note-gain.wav"
                    render_sequence_file(root / "audio/background-sequence.json", output)
                    with wave.open(str(output)) as source:
                        actual = struct.unpack("<hhhh", source.readframes(2))
                    self.assertEqual(actual, (
                        -coefficient, -coefficient, coefficient - 1, coefficient - 1,
                    ))

    def test_python_export_uses_the_shared_native_envelope_lookup_rounding(self):
        fixture = SustainedFixture()
        fixture.data[4:8] = bytes([127, 108, 0, 127])
        fixture.sounds['WIPL_BGM_MENU']['volume'] = 127
        decibels = [0.0] * 965
        decibels[878], decibels[879] = 0.75, 0.25
        tables = replace(constant_tables(), sustain=(-904,) * 128,
                         decibels=tuple(decibels))

        def sequence(sound, *, on_event, strict):
            on_event(0, 'note', 0, {
                'lengthTicks': 0, 'note': (0, 0, 60, 127, 0, 127, 64),
            }, 0)

        def decode_wave(info, wave_base):
            return [array('h', [16384] * 1500)], 32000, False

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(fixture, 'sequence', side_effect=sequence), \
                    patch.object(fixture, 'decode_wave', side_effect=decode_wave):
                definition = export_sequence_resources(
                    fixture, tables, root, require_loop=False,
                )
            output = root / 'threshold.wav'
            render_sequence_file(root / 'audio/background-sequence.json', output)
            with wave.open(str(output)) as source:
                source.setpos(14 * 96)
                left, right = struct.unpack('<hh', source.readframes(1))
            # Original divide/multiply stages select 878 after thirteen decay
            # updates; direct envelope truncation selects 879 and yields 4095.
            self.assertEqual((left, right), (12287, 12287))
            self.assertEqual(definition['rendererVersion'], RENDERER_VERSION)

    def test_message_scroll_export_repeats_the_shared_clock_without_later_drift(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture = MessageScrollFixture()
            name = "WIPL_SE_MESSAGE_SCROLL"
            definition = export_sequence_resources(
                fixture, constant_tables(), root, symbol=name, name=name, require_loop=False,
            )
            self.assertEqual(message_scroll_loop_metadata(definition), {
                "loop": True, "loopStart": 0, "loopEnd": 1.248,
                "loopFrames": 39936, "loopSequenceCycles": 5,
            })
            positions = tick_sample_positions(144, [])
            self.assertEqual([positions[index] for index in range(0, 145, 24)],
                             [0, 8064, 16032, 24000, 31968, 39936, 48000])
            short_path = root / "period.wav"
            measured = render_sequence_file(root / f"audio/{name}-sequence.json", short_path)
            self.assertEqual(measured["frames"], 39936)
            definition["offline"] = {"frames": 640000}
            continuous = root / "audio/continuous-sequence.json"
            continuous.write_text(json.dumps(definition))
            long_path = root / "continuous.wav"
            render_sequence_file(continuous, long_path)
            with wave.open(str(short_path)) as source:
                period_pcm = source.readframes(source.getnframes())
            with wave.open(str(long_path)) as source:
                continuous_pcm = source.readframes(source.getnframes())
            repeats, remainder = divmod(len(continuous_pcm), len(period_pcm))
            self.assertEqual(period_pcm * repeats + period_pcm[:remainder], continuous_pcm)
            old_period = period_pcm[:16032 * 4]
            repeats, remainder = divmod(len(continuous_pcm), len(old_period))
            self.assertNotEqual(old_period * repeats + old_period[:remainder], continuous_pcm)

    def test_periodic_export_is_limited_to_message_scroll_and_rejects_overlapping_voices(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture = MessageScrollFixture()
            fixture.sounds["OTHER_LOOP"] = fixture.sounds["WIPL_SE_MESSAGE_SCROLL"]
            other = export_sequence_resources(
                fixture, constant_tables(), root, symbol="OTHER_LOOP", name="other", require_loop=False,
            )
            self.assertEqual(other["offline"], {
                "frames": 16032, "loopStart": 0.252, "loopEnd": 0.501,
            })
            fixture.frames = 32000
            with self.assertRaisesRegex(ValueError, "overlap"):
                export_sequence_resources(
                    fixture, constant_tables(), root, symbol="WIPL_SE_MESSAGE_SCROLL",
                    name="scroll", require_loop=False,
                )
            fixture.frames = 172
            fixture.data[4:8] = bytes([127, 127, 127, 100])
            with self.assertRaisesRegex(ValueError, "unsupported sequence loop profile"):
                export_sequence_resources(
                    fixture, constant_tables(), root, symbol="WIPL_SE_MESSAGE_SCROLL",
                    name="scroll", require_loop=False,
                )

    def test_tracks_opened_before_global_tempo_change_keep_identical_tick_clocks(self):
        # The child is opened at tempo 120 before track zero sets 60. Both
        # notes still belong to tick 48 on the shared player clock.
        primary = bytes.fromhex("8801000010e1003cc70080303c4000ff")
        child = bytes.fromhex("c70080303e4000ff")
        events = []
        walk_sequence(primary + child, 0, 0, on_event=lambda *event: events.append(event))
        notes = [event for event in events if event[1] == "note"]
        self.assertEqual([event[4] for event in notes], [48, 48])
        positions = tick_sample_positions(48, [(0, 60)])
        self.assertGreater(positions[48], 31000)
        self.assertLess(positions[48], 32000)

    def test_native_tick_fixture_stays_aligned_to_ax_blocks(self):
        positions = tick_sample_positions(6527, [(0, 114)])
        self.assertEqual(positions[383], 134208)
        self.assertEqual(positions[6527], 2286528)
        self.assertTrue(all(position % 96 == 0 for position in positions))

    def test_zero_length_note_wait_is_preserved_without_retiming_source_ticks(self):
        events = []
        # Default note-wait, explicit one-tick rest, then note-wait disabled.
        walk_sequence(bytes.fromhex("3c5a008001c7003c7800ff"), 0, 0,
                      on_event=lambda *event: events.append(event))
        notes = [event for event in events if event[1] == "note"]
        self.assertEqual([event[4] for event in notes], [0, 1])
        self.assertEqual([event[3]["waitForEnd"] for event in notes], [True, False])
        self.assertEqual([event[3]["lengthTicks"] for event in notes], [0, 0])

    def test_unknown_sequence_controller_is_rejected_for_background(self):
        with self.assertRaisesRegex(ValueError, "Unsupported background controller"):
            walk_sequence(bytes.fromhex("c6403c7f00ff"), 0, 0, strict=True)

    def test_resource_plan_retains_controller_order_and_original_pcm(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = SustainedFixture()
            definition = export_sequence_resources(fixture, constant_tables(), Path(directory))
            self.assertEqual([event["kind"] for event in definition["events"]],
                             ["volume", "note", "note", "volume"])
            self.assertEqual(fixture.decoded, 1)
            self.assertEqual(definition["waves"][0]["frames"], 1200)
            self.assertIsNone(definition["reverb"])
            wave = Path(directory) / definition["waves"][0]["src"].removeprefix("/assets/")
            self.assertEqual(len(wave.read_bytes()), 2400)

    def test_virtual_reads_reject_unmapped_or_truncated_sections(self):
        executable = bytearray(0x110)
        struct.pack_into(">I", executable, 0, 0x100)
        struct.pack_into(">I", executable, 0x48, 0x80001000)
        struct.pack_into(">I", executable, 0x90, 16)
        executable[0x100:] = bytes(range(16))
        self.assertEqual(read_dol_address(executable, 0x80001004, 4), bytes([4, 5, 6, 7]))
        with self.assertRaises(ValueError):
            read_dol_address(executable, 0x8000100F, 2)
        with self.assertRaises(ValueError):
            read_dol_address(executable[:-1], 0x80001004, 4)

    def test_background_resources_cannot_escape_the_assets_root(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(ValueError):
                local_asset_path(root, "/assets/../../private.wav")
            with self.assertRaises(ValueError):
                local_asset_path(root, "https://example.invalid/music.wav")

    def test_activated_capture_is_preserved_only_when_its_pcm_hash_matches(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            audio = root / "audio"
            audio.mkdir()
            pcm = audio / "background-native.wav"
            pcm.write_bytes(b"synthetic captured PCM")
            capture = {
                "background": {"src": "/assets/audio/background-native.wav"},
                "provenance": {"outputSha256": hashlib.sha256(pcm.read_bytes()).hexdigest()},
            }
            (audio / "background-capture.json").write_text(json.dumps(capture))
            self.assertEqual(load_captured_background(root), capture)
            pcm.write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "checksum changed"):
                load_captured_background(root)

    def test_cache_checks_source_versions_and_pcm_integrity(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            audio = root / "audio"
            audio.mkdir()
            pcm = audio / "background.wav"
            pcm.write_bytes(b"original synthetic PCM")
            fixture = SustainedFixture()
            entry = {
                "src": "/assets/audio/background.wav",
                "rendererVersion": RENDERER_VERSION,
                "sourceArchiveSha256": hashlib.sha256(fixture.data).hexdigest(),
                "sourceDriverSha256": "synthetic-driver",
                "outputSha256": hashlib.sha256(pcm.read_bytes()).hexdigest(),
            }
            marker = audio / "background-build.json"
            marker.write_text(json.dumps(entry))
            with patch("export_audio.load_native_audio_tables", return_value=constant_tables()):
                with patch("export_audio.render_sequence_background") as render:
                    self.assertEqual(prepare_background(fixture, root, root), entry)
                    render.assert_not_called()
                for field in ("rendererVersion", "sourceArchiveSha256", "sourceDriverSha256"):
                    with self.subTest(changed=field):
                        marker.write_text(json.dumps({**entry, field: "changed"}))
                        with patch("export_audio.render_sequence_background", side_effect=ValueError("rebuild")):
                            with self.assertRaisesRegex(ValueError, "rebuild"):
                                prepare_background(fixture, root, root)
                marker.write_text(json.dumps(entry))
                pcm.write_bytes(b"damaged")
                with patch("export_audio.render_sequence_background", side_effect=ValueError("rebuild")):
                    with self.assertRaisesRegex(ValueError, "rebuild"):
                        prepare_background(fixture, root, root)


if __name__ == "__main__":
    unittest.main()
