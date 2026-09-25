import math
import struct
import unittest

from export_captured_bgm import correlation, rms_envelope


class CapturedBgmMetricsTests(unittest.TestCase):
    def test_stereo_pcm_envelope_uses_signed_little_endian_samples(self):
        frames = [(32767, -32768), (0, 0), (16384, -16384), (0, 0)]
        pcm = memoryview(b"".join(struct.pack("<hh", *frame) for frame in frames))

        actual = rms_envelope(pcm, start=1, window_samples=2)

        self.assertEqual(len(actual), 1)
        self.assertAlmostEqual(actual[0], math.sqrt(2 * 16384 ** 2 / 4) / 32768)

    def test_correlation_preserves_perfect_and_inverse_alignment(self):
        self.assertAlmostEqual(correlation([1, 2, 3], [3, 4, 5]), 1)
        self.assertAlmostEqual(correlation([1, 2, 3], [5, 4, 3]), -1)
        self.assertIsNone(correlation([1, 1, 1], [2, 2, 2]))
        with self.assertRaises(ValueError):
            correlation([1, 2], [1])


if __name__ == "__main__":
    unittest.main()
