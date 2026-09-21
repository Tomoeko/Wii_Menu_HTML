"""Authored audio fixtures exercise decoding without installed media converters."""

import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
import wave

from channel_audio import decode_channel_audio
from test_wad import make_u8


def bns_fixture(*, stereo=True, looping=True, history1=0, history2=0):
    channels = 2 if stereo else 1
    entries_offset = 24 + channels * 4
    contexts_offset = entries_offset + channels * 12
    info = bytearray(contexts_offset + channels * 48)
    info[:3] = bytes((0, int(looping), channels))
    struct.pack_into(">H", info, 4, 32000)
    struct.pack_into(">III", info, 8, 2, 6, 24)
    encoded = bytearray()
    for channel in range(channels):
        entry = entries_offset + channel * 12
        context = contexts_offset + channel * 48
        struct.pack_into(">I", info, 24 + channel * 4, entry)
        struct.pack_into(">II", info, entry, channel * 8, context)
        # Prediction by the previous sample makes initial-history mistakes audible.
        struct.pack_into(">16h", info, context, 2048, 0, *([0] * 14))
        struct.pack_into(">2h", info, context + 36, history1, history2)
        encoded.extend(bytes.fromhex("00178f0000000000" if channel == 0 else "00fff10000000000"))
    info_block = b"INFO" + struct.pack(">I", len(info) + 8) + info
    data_block = b"DATA" + struct.pack(">I", len(encoded) + 8) + encoded
    header = bytearray(b"BNS \xfe\xff\x01\x00" + bytes(24))
    struct.pack_into(">IHH", header, 8, 32 + len(info_block) + len(data_block), 32, 2)
    struct.pack_into(">4I", header, 16, 32, len(info_block), 32 + len(info_block), len(data_block))
    return header + info_block + data_block


def wave_fixture(samples, *, channels=1, bits=16, codec=1, loop=None, extras=()):
    alignment = channels * (bits // 8)
    fmt = struct.pack("<HHIIHH", codec, channels, 32000, 32000 * alignment, alignment, bits)
    chunks = [(b"fmt ", fmt), *extras, (b"data", samples)]
    if loop is not None:
        sampler = bytearray(36)
        struct.pack_into("<I", sampler, 28, 1)
        sampler.extend(struct.pack("<6I", 0, 0, loop[0], loop[1], 0, 0))
        chunks.append((b"smpl", sampler))
    payload = b"WAVE"
    for name, data in chunks:
        payload += name + struct.pack("<I", len(data)) + data + bytes(len(data) & 1)
    return b"RIFF" + struct.pack("<I", len(payload)) + payload


class ChannelAudioTests(unittest.TestCase):
    def test_bns_channel_order_initial_history_and_sample_loop(self):
        audio = decode_channel_audio(bns_fixture(history1=100))
        self.assertEqual(list(audio.pcm[0]), [101, 108, 100, 99, 99, 99])
        self.assertEqual(list(audio.pcm[1]), [99, 98, 97, 98, 98, 98])
        self.assertEqual(audio.metadata(), {
            "sampleRate": 32000,
            "channels": 2,
            "samples": 6,
            "duration": 6 / 32000,
            "loop": True,
            "loopStart": 2 / 32000,
            "loopEnd": 6 / 32000,
        })

    def test_bns_mono_one_shot_has_no_invented_loop_or_tail(self):
        audio = decode_channel_audio(bns_fixture(stereo=False, looping=False))
        self.assertEqual(len(audio.pcm), 1)
        self.assertEqual(audio.sample_count, 6)
        self.assertFalse(audio.metadata()["loop"])
        self.assertNotIn("loopStart", audio.metadata())

    def test_bns_rejects_wrong_headers_codec_and_loop(self):
        for offset, replacement in (
            (4, b"\xff\xfe"),
            (7, b"\x01"),
            (11, b"\x00"),
            (15, b"\x03"),
            (32, b"FAIL"),
            (40, b"\x01"),
            (41, b"\x02"),
            (42, b"\x03"),
            (48, struct.pack(">I", 6)),
        ):
            with self.subTest(offset=offset):
                data = bns_fixture()
                data[offset : offset + len(replacement)] = replacement
                with self.assertRaises(ValueError):
                    decode_channel_audio(data)

    def test_bns_rejects_truncation_and_offsets_outside_their_block(self):
        for cut in (0, 15, 31, 60, 100, 197):
            with self.subTest(cut=cut), self.assertRaises(ValueError):
                decode_channel_audio(bns_fixture()[:cut])
        for offset in (16, 24, 56, 64, 72, 76):
            with self.subTest(offset=offset):
                data = bns_fixture()
                struct.pack_into(">I", data, offset, 0xFFFFFFF0)
                with self.assertRaises(ValueError):
                    decode_channel_audio(data)

    def test_wave_stereo_preserves_pcm_and_skips_padded_metadata(self):
        raw = struct.pack("<6h", -32768, 32767, 123, -456, 7, 9)
        audio = decode_channel_audio(wave_fixture(
            raw, channels=2, extras=[(b"JUNK", b"odd")], loop=(1, 2)
        ))
        self.assertEqual(list(audio.pcm[0]), [-32768, 123, 7])
        self.assertEqual(list(audio.pcm[1]), [32767, -456, 9])
        self.assertEqual((audio.loop_start, audio.loop_end), (1, 3))

    def test_wave_converts_integer_precision_without_changing_rate(self):
        for bits, raw, expected in (
            (8, bytes([0, 128, 255]), [-32768, 0, 32512]),
            (24, bytes.fromhex("000080000000ffff7f"), [-32768, 0, 32767]),
            (32, struct.pack("<3i", -2147483648, 0, 2147483647), [-32768, 0, 32767]),
        ):
            with self.subTest(bits=bits):
                audio = decode_channel_audio(wave_fixture(raw, bits=bits))
                self.assertEqual(list(audio.pcm[0]), expected)
                self.assertEqual(audio.sample_rate, 32000)

    def test_wave_float_saturates_and_rejects_non_finite_samples(self):
        audio = decode_channel_audio(wave_fixture(
            struct.pack("<5f", -2, -0.5, 0, 0.5, 2), bits=32, codec=3
        ))
        self.assertEqual(list(audio.pcm[0]), [-32768, -16384, 0, 16384, 32767])
        for value in (float("nan"), float("inf"), float("-inf")):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "non-finite"):
                decode_channel_audio(wave_fixture(struct.pack("<f", value), bits=32, codec=3))

    def test_wave_extensible_pcm_keeps_stereo_channel_order(self):
        original = wave_fixture(struct.pack("<2h", -123, 456), channels=2)
        extension = struct.pack("<HHI", 22, 16, 3)
        extension += bytes.fromhex("0100000000001000800000aa00389b71")
        data = bytearray(original[:36] + extension + original[36:])
        struct.pack_into("<I", data, 4, len(data) - 8)
        struct.pack_into("<I", data, 16, 40)
        struct.pack_into("<H", data, 20, 0xFFFE)
        audio = decode_channel_audio(data)
        self.assertEqual([list(channel) for channel in audio.pcm], [[-123], [456]])
        data[40:44] = struct.pack("<I", 0x33)
        with self.assertRaisesRegex(ValueError, "channel order"):
            decode_channel_audio(data)

    def test_wave_rejects_partial_frames_unsupported_codec_and_invalid_loops(self):
        for data in (
            wave_fixture(b"\x00", bits=16),
            wave_fixture(bytes(4), codec=2),
            wave_fixture(bytes(4), loop=(0, 2)),
            wave_fixture(bytes(4), loop=(1, 0)),
            wave_fixture(bytes(4))[:-1],
            wave_fixture(bytes(4), extras=[(b"data", bytes(4))]),
            b"unknown-format",
        ):
            with self.subTest(header=data[:16]), self.assertRaises(ValueError):
                decode_channel_audio(data)

    def test_exporter_runs_with_empty_path_and_preserves_wrapper_provenance(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            nand, output = root / "nand", root / "assets"
            source = "title/00010001/54455354/content/00000001.app"
            target = nand / source
            target.parent.mkdir(parents=True)
            payload = bns_fixture()
            resource = b"IMD5" + struct.pack(">I", len(payload)) + bytes(8)
            resource += hashlib.md5(payload).digest() + payload
            imet = bytearray(0x600)
            imet[64:68] = b"IMET"
            struct.pack_into(">II", imet, 68, 0x600, 3)
            content = bytes(imet) + make_u8({"meta/sound.bin": resource})
            target.write_bytes(content)
            output.mkdir()
            channel = {
                "id": "0001000154455354",
                "shortId": "TEST",
                "source": {"file": source, "sha256": hashlib.sha256(content).hexdigest()},
            }
            (output / "channels.json").write_text(json.dumps({"channels": [channel]}))
            completed = subprocess.run(
                [sys.executable, str(Path(__file__).with_name("export_channel_audio.py")),
                 "--nand", str(nand), "--output", str(output)],
                env={**os.environ, "PATH": ""},
                capture_output=True,
                text=True,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            exported = json.loads((output / "channel-audio.json").read_text())[channel["id"]]
            self.assertEqual(exported["sha256"], hashlib.sha256(resource).hexdigest())
            self.assertEqual(exported["sourceSha256"], channel["source"]["sha256"])
            self.assertEqual(exported["loopStart"], 2 / 32000)
            self.assertEqual(exported["loopEnd"], 6 / 32000)
            with wave.open(str(output / "channel-audio" / f'{channel["id"]}.wav'), "rb") as sound:
                self.assertEqual(sound.getnframes(), 6)
                self.assertEqual(sound.getnchannels(), 2)
                self.assertEqual(sound.readframes(1), struct.pack("<2h", 1, -1))


if __name__ == "__main__":
    unittest.main()
