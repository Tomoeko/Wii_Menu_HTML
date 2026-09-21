import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from export_audio import load_captured_background


class CapturedBackgroundTests(unittest.TestCase):
    def test_absent_capture_allows_reference_export(self):
        with tempfile.TemporaryDirectory() as folder:
            self.assertIsNone(load_captured_background(Path(folder)))

    def test_native_entry_retains_gain_and_loop_points(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "audio").mkdir()
            data = b"native PCM fixture"
            (root / "audio/background-native.wav").write_bytes(data)
            entry = {
                "src": "/assets/audio/background-native.wav",
                "gain": 1,
                "loopStart": 5.194,
                "loopEnd": 72.454,
            }
            capture = {
                "background": entry,
                "provenance": {"outputSha256": hashlib.sha256(data).hexdigest()},
            }
            (root / "audio/background-capture.json").write_text(json.dumps(capture))
            self.assertEqual(load_captured_background(root)["background"], entry)
            (root / "audio/background-native.wav").write_bytes(b"overwritten")
            with self.assertRaisesRegex(ValueError, "checksum"):
                load_captured_background(root)
            (root / "audio/background-native.wav").unlink()
            with self.assertRaisesRegex(ValueError, "missing"):
                load_captured_background(root)


if __name__ == "__main__":
    unittest.main()
