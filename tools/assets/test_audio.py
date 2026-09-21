"""Independent small fixtures for the audio format conversion boundaries."""

from array import array
import tempfile
from pathlib import Path
import unittest
import wave

from export_audio import decode_dsp, walk_sequence, write_wav


class AudioTests(unittest.TestCase):
    def test_signed_nibbles_and_partial_final_frame(self):
        frame = bytes.fromhex("00178f00ff000000")
        self.assertEqual(list(decode_dsp(frame, 6, [0] * 16)), [1, 7, -8, -1, 0, 0])

    def test_predictor_history_and_saturation(self):
        coefficients = [2048, 0] + [0] * 14
        self.assertEqual(
            list(decode_dsp(bytes.fromhex("0011000000000000"), 3, coefficients, 32766, 0)),
            [32767, 32767, 32767],
        )

    def test_rejects_truncated_frame_and_invalid_predictor(self):
        with self.assertRaises(ValueError):
            decode_dsp(b"\0", 1, [0] * 16)
        with self.assertRaises(ValueError):
            decode_dsp(bytes.fromhex("8000000000000000"), 1, [0] * 16)

    def test_sequence_keeps_note_timing_and_original_loop_boundary(self):
        # Wait 48 ticks at 120 BPM, then program 2 and one middle-C note;
        # wait 96 ticks and jump back to that program. There is no invented tune.
        sequence = bytes.fromhex("803081023c7f00806089000002")
        notes, loop = walk_sequence(sequence, 0, 0)
        self.assertEqual(notes[0][:4], (0.5, 2, 60, 127))
        self.assertEqual(loop, {"loopStart": 0.5, "loopEnd": 1.5})

    def test_opened_track_keeps_its_own_wait_pan_and_note_sequence(self):
        # Track zero plays two sequential notes on the left. Track one begins
        # after 48 ticks on the right; ending track zero must not discard it.
        primary = bytes.fromhex("88010000108101c0203c40303e4030ff")
        secondary = bytes.fromhex("80308102c060404030ff")
        notes, loop = walk_sequence(primary + secondary, 0, 0)
        self.assertEqual([note[0] for note in notes], [0.0, 0.5, 0.5])
        self.assertEqual([note[2] for note in notes], [60, 62, 64])
        self.assertEqual([note[6] for note in notes], [32, 32, 96])
        self.assertEqual(loop, {})

    def test_note_wait_disabled_preserves_chords_and_track_zero_only_mode(self):
        primary = bytes.fromhex("8801000010c7003c40303e4030ff0000")
        secondary = bytes.fromhex("404030ff")
        notes, _ = walk_sequence(primary + secondary, 0, 0, include_tracks=False)
        self.assertEqual([note[0] for note in notes], [0.0, 0.0])
        self.assertEqual([note[2] for note in notes], [60, 62])

    def test_forward_jump_skips_unused_sequence_bytes(self):
        sequence = bytes.fromhex("89000006ffff3c4030ff")
        notes, loop = walk_sequence(sequence, 0, 0)
        self.assertEqual(notes[0][:4], (0.0, 0, 60, 64))
        self.assertEqual(loop, {})

    def test_track_transposition_is_signed_and_clamped(self):
        sequence = bytes.fromhex("c3f43c4030c37f7f4030c380004030ff")
        notes, _ = walk_sequence(sequence, 0, 0)
        self.assertEqual([note[2] for note in notes], [48, 127, 0])
        self.assertEqual([note[0] for note in notes], [0.0, 0.5, 1.0])

    def test_wav_writes_interleaved_little_endian_pcm(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fixture.wav"
            write_wav(path, [[1, -2], [3, -4]], 32000)
            with wave.open(str(path), "rb") as result:
                self.assertEqual((result.getnchannels(), result.getframerate()), (2, 32000))
                self.assertEqual(result.readframes(2), bytes.fromhex("01000300fefffcff"))


if __name__ == "__main__":
    unittest.main()


class RandomizedEffectTests(unittest.TestCase):
    def test_message_display_pitch_bend_uses_explicit_center_variant(self):
        # Native MSG_DISP varies pitch bend; the prepared sample documents that
        # it keeps the middle variant, retaining the following note and timing.
        sequence = bytes.fromhex("a0c4ffe000203c7f008003ff")
        notes, loop = walk_sequence(sequence, 0, 0)
        self.assertEqual(notes[0][:4], (0.0, 0, 60, 127))
        self.assertEqual(loop, {})
