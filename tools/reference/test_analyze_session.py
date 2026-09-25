"""Synthetic PNG and PCM fixtures for dependency-free reference analysis."""

from pathlib import Path
import struct
import tempfile
import unittest
import wave

from analyze_health_transition import analyze
from analyze_session import audio_energy, contact_sheet, frame_change_metrics, scan_frames
from raster import RgbImage, read_png


class ReferenceAnalysisTests(unittest.TestCase):
    def test_health_metrics_keep_presented_frame_order_and_stable_masks(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            frames = root / "Frames"
            frames.mkdir()
            for number, color in enumerate((255, 0, 200, 200), start=1):
                RgbImage.new((268, 201), (color, color, color)).save(
                    frames / f"framedump_{number}.png"
                )
            output = root / "analysis"
            info, rows = analyze(root, 1, 4, output)
            self.assertEqual(info["resolution"], [268, 201])
            self.assertEqual(info["blackFrames"], [2])
            self.assertEqual(info["healthMaskPixels"], 268 * 156)
            self.assertEqual(info["menuMaskPixels"], 268)
            self.assertEqual([row["changed_pixels"] for row in rows],
                             [0, 268 * 201, 268 * 201, 0])
            self.assertAlmostEqual(rows[-1]["health_alpha_fit"], 200 / 255)
            self.assertAlmostEqual(rows[-1]["menu_alpha_fit"], 1)
            self.assertTrue(read_png(output / "health-contact-sheet.png").width > 0)

    def test_session_frame_changes_and_contact_sheet_use_local_raster(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            frames = root / "Frames"
            frames.mkdir()
            before = RgbImage(2, 1, bytes((0, 10, 20, 20, 30, 40)))
            after = RgbImage(2, 1, bytes((3, 10, 20, 20, 32, 40)))
            before.save(frames / "framedump_1.png")
            after.save(frames / "framedump_2.png")
            metrics = frame_change_metrics(after, before)
            self.assertEqual(metrics["fraction_changed_gt_2"], 0.5)
            self.assertEqual(metrics["mean_rgb_delta"], round(5 / 6, 6))
            sheet = root / "sheet.png"
            contact_sheet(root, [1, 2], sheet, columns=2)
            self.assertEqual(read_png(sheet).size, (512, 148))
            rows = scan_frames(root, root, 2)
            self.assertEqual([row["frame"] for row in rows], [1, 2])
            self.assertEqual(rows[0]["mean_rgb_delta"], 0)
            self.assertGreater(rows[1]["mean_rgb_delta"], 0)

    def test_audio_energy_reads_complete_pcm_frames_without_array_packages(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            audio = root / "Audio"
            audio.mkdir()
            path = audio / "capture.wav"
            with wave.open(str(path), "wb") as writer:
                writer.setnchannels(1)
                writer.setsampwidth(2)
                writer.setframerate(8000)
                writer.writeframes(struct.pack("<4h", 0, 16384, -16384, 0))
            result = audio_energy(path, root)
            self.assertEqual(result["pcmBytesAnalyzed"], 8)
            self.assertEqual(result["sampleRate"], 8000)
            self.assertEqual(len(result["records"]), 1)
            self.assertAlmostEqual(result["records"][0]["peak_dbfs"], -6.0206, places=3)


if __name__ == "__main__":
    unittest.main()
