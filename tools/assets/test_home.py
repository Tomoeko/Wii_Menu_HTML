"""HOME table parsing and remote PCM retain their original data boundaries."""

import csv
import io
from pathlib import Path
import struct
import tempfile
import unittest
import wave

from export_home import parse_home_messages, write_speaker_pcm


class HomeResourceTests(unittest.TestCase):
    def test_multiline_caption_uses_requested_language_column(self):
        stream = io.StringIO(newline="")
        writer = csv.writer(stream, delimiter="\t")
        for row in range(4):
            writer.writerow(
                [f"language-{language} row-{row}\r\nsecond line" for language in range(10)]
            )
        result = parse_home_messages(stream.getvalue().encode("utf-16"), "ENG")
        self.assertEqual(result["returnToMenu"], "language-1 row-2\nsecond line")
        self.assertEqual(result["disconnecting"], "language-1 row-1\nsecond line")

    def test_caption_table_rejects_truncated_rows(self):
        with self.assertRaises(ValueError):
            parse_home_messages("a\tb\n".encode("utf-16"))

    def test_speaker_pcm_preserves_signed_samples_and_original_rate(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "speaker.wav"
            write_speaker_pcm(struct.pack(">4h", -32768, -1, 0, 32767), path)
            with wave.open(str(path), "rb") as output:
                self.assertEqual(
                    (output.getnchannels(), output.getsampwidth(), output.getframerate()),
                    (1, 2, 6000),
                )
                self.assertEqual(output.readframes(4), struct.pack("<4h", -32768, -1, 0, 32767))
            with self.assertRaises(ValueError):
                write_speaker_pcm(b"\x00", path)


if __name__ == "__main__":
    unittest.main()
