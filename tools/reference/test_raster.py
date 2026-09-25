import struct
import tempfile
import unittest
from pathlib import Path
import zlib

from raster import PNG_SIGNATURE, RgbImage, _chunk, read_png


def png_fixture(width, height, color_type, rows, palette=b"", bit_depth=8):
    header = struct.pack(">IIBBBBB", width, height, bit_depth, color_type, 0, 0, 0)
    chunks = [_chunk(b"IHDR", header)]
    if palette:
        chunks.append(_chunk(b"PLTE", palette))
    chunks.extend((_chunk(b"IDAT", zlib.compress(rows)), _chunk(b"IEND", b"")))
    return PNG_SIGNATURE + b"".join(chunks)


class RasterTests(unittest.TestCase):
    def test_rgb_round_trip_and_nearest_pixel_centers(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "image.png"
            image = RgbImage(4, 1, bytes(range(12)))
            image.save(path)
            decoded = read_png(path)
            self.assertEqual(decoded.pixels, image.pixels)
            self.assertEqual(decoded.resize((2, 1)).getpixel((0, 0)), (3, 4, 5))
            self.assertEqual(decoded.resize((2, 1)).getpixel((1, 0)), (9, 10, 11))

    def test_rgba_and_indexed_png_drop_alpha_and_preserve_color(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "image.png"
            path.write_bytes(png_fixture(1, 1, 6, b"\0\x10\x20\x30\0"))
            self.assertEqual(read_png(path).getpixel((0, 0)), (16, 32, 48))
            path.write_bytes(png_fixture(2, 1, 3, b"\0\x40", b"\x01\x02\x03\x04\x05\x06", 1))
            self.assertEqual(read_png(path).pixels, bytearray((1, 2, 3, 4, 5, 6)))

    def test_row_filters_reconstruct_source_bytes(self):
        first = bytes((20, 40, 60, 80, 100, 120))
        second = bytes((30, 50, 70, 90, 110, 130))
        previous = first
        for method in range(5):
            encoded = bytearray()
            for index, value in enumerate(second):
                left = second[index - 3] if index >= 3 else 0
                above = previous[index]
                upper_left = previous[index - 3] if index >= 3 else 0
                if method == 1:
                    predictor = left
                elif method == 2:
                    predictor = above
                elif method == 3:
                    predictor = (left + above) // 2
                elif method == 4:
                    base = left + above - upper_left
                    distances = (abs(base - left), abs(base - above), abs(base - upper_left))
                    predictor = (left, above, upper_left)[distances.index(min(distances))]
                else:
                    predictor = 0
                encoded.append((value - predictor) & 255)
            with self.subTest(filter=method), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "image.png"
                path.write_bytes(png_fixture(2, 2, 2, b"\0" + first + bytes((method,)) + encoded))
                self.assertEqual(read_png(path).pixels, bytearray(first + second))

    def test_rejects_corrupt_crc_oversized_geometry_and_trailing_data(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "image.png"
            good = png_fixture(1, 1, 2, b"\0\x01\x02\x03")
            path.write_bytes(good[:-1] + b"\x01")
            with self.assertRaisesRegex(ValueError, "CRC"):
                read_png(path)
            path.write_bytes(png_fixture(5000, 5000, 2, b"\0"))
            with self.assertRaisesRegex(ValueError, "dimensions"):
                read_png(path)
            path.write_bytes(good + b"extra")
            with self.assertRaisesRegex(ValueError, "trailing"):
                read_png(path)


if __name__ == "__main__":
    unittest.main()
