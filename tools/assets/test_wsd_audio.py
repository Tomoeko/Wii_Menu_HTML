"""Synthetic WSD extraction fixtures; no original sample/table bytes are authored."""
import hashlib
import json
from pathlib import Path
import struct
import tempfile
import unittest

from native_audio_tables import NativeAudioTables
from wsd_audio import export_wsd_resources, read_wsd_voice


class WsdArchive:
    def __init__(self):
        self.data = bytearray(400)
        self.data[:8] = b"RWSD\xfe\xff\x01\x02"
        self.data[80:90] = struct.pack(">f6B", 1, 64, 0, 0, 0, 0, 127)
        self.data[124:128] = bytes([127] * 4)
        self.data[132:140] = struct.pack(">4Bf", 60, 127, 64, 0, 1)
        self.sounds = {"WSD_SELECT": {"file": 0, "extra": 200, "type": 3, "volume": 96}}
        self.notes = [120]
        self.loop = False

    def file(self, index):
        return {"header": 0, "wave": 300}

    def u32(self, offset):
        return {16: 24, 24: 240, 200: 0, 120: 0, 252: 32}[offset]

    def refs(self, offset, base):
        return [40] if offset == 32 else self.notes

    def ref(self, offset, base):
        return {40: 80, 56: 100}[offset]

    def decode_wave(self, info, base):
        assert info == 272 and base == 300
        return [[1234, -2345], [-3456, 4567]], 44100, self.loop


class WsdTests(unittest.TestCase):
    def test_reads_original_field_offsets_and_preserves_pcm_without_gain(self):
        archive = WsdArchive()
        tables = NativeAudioTables((0.0,) * 128, (0,) * 128, (1.0,) * 965,
                                   (1.0,) * 257, "a" * 64)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            definition = export_wsd_resources(archive, tables, output,
                                              symbol="WSD_SELECT", name="page")
            self.assertEqual(definition["sourceKind"], "wsd")
            self.assertEqual(definition["archiveVolume"], 96)
            self.assertNotIn("events", definition)
            wave_bytes = (output / "audio/wsd/page/wave.pcm").read_bytes()
            self.assertEqual(struct.unpack("<4h", wave_bytes), (1234, -3456, -2345, 4567))
            self.assertEqual(definition["waves"][0]["sha256"], hashlib.sha256(wave_bytes).hexdigest())
            self.assertEqual(json.loads((output / "audio/page-wsd.json").read_text())["pitch"], 1)

    def test_refuses_looping_multi_note_and_altered_envelope_or_send(self):
        mutations = [
            lambda archive: setattr(archive, "loop", True),
            lambda archive: setattr(archive, "notes", [120, 120]),
            lambda archive: archive.data.__setitem__(124, 104),
            lambda archive: archive.data.__setitem__(86, 10),
            lambda archive: archive.data.__setitem__(84, 63),
            lambda archive: archive.data.__setitem__(7, 1),
        ]
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                archive = WsdArchive()
                mutate(archive)
                with self.assertRaises(ValueError):
                    read_wsd_voice(archive, "WSD_SELECT")

    def test_invalid_name_cannot_create_outside_staging(self):
        with self.assertRaisesRegex(ValueError, "asset name"):
            export_wsd_resources(WsdArchive(), None, Path("unused"),
                                 symbol="WSD_SELECT", name="../../outside")
