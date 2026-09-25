"""Small, bounded RGB PNG reader and writer for local reference captures.

This module uses only Python's standard library. It deliberately rejects PNG
features the capture pipeline does not produce instead of guessing at their
appearance. Analysis reports record the decoder and resampling method so that
results made with other image libraries are not silently treated as equivalent.
"""

from __future__ import annotations

from array import array
import math
from pathlib import Path
import struct
import zlib


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_PIXELS = 16 * 1024 * 1024
RESAMPLING = ("nearest", "bilinear", "bicubic", "lanczos")

# Captions in generated review sheets need only a small, deterministic font.
# Each row is five bits; lowercase captions use the same glyphs as uppercase.
GLYPHS = {
    " ": "00000/00000/00000/00000/00000/00000/00000",
    "?": "01110/10001/00001/00010/00100/00000/00100",
    "A": "01110/10001/10001/11111/10001/10001/10001",
    "B": "11110/10001/10001/11110/10001/10001/11110",
    "C": "01111/10000/10000/10000/10000/10000/01111",
    "D": "11110/10001/10001/10001/10001/10001/11110",
    "E": "11111/10000/10000/11110/10000/10000/11111",
    "F": "11111/10000/10000/11110/10000/10000/10000",
    "G": "01111/10000/10000/10111/10001/10001/01111",
    "H": "10001/10001/10001/11111/10001/10001/10001",
    "I": "11111/00100/00100/00100/00100/00100/11111",
    "J": "00111/00010/00010/00010/10010/10010/01100",
    "K": "10001/10010/10100/11000/10100/10010/10001",
    "L": "10000/10000/10000/10000/10000/10000/11111",
    "M": "10001/11011/10101/10101/10001/10001/10001",
    "N": "10001/11001/10101/10011/10001/10001/10001",
    "O": "01110/10001/10001/10001/10001/10001/01110",
    "P": "11110/10001/10001/11110/10000/10000/10000",
    "Q": "01110/10001/10001/10001/10101/10010/01101",
    "R": "11110/10001/10001/11110/10100/10010/10001",
    "S": "01111/10000/10000/01110/00001/00001/11110",
    "T": "11111/00100/00100/00100/00100/00100/00100",
    "U": "10001/10001/10001/10001/10001/10001/01110",
    "V": "10001/10001/10001/10001/10001/01010/00100",
    "W": "10001/10001/10001/10101/10101/10101/01010",
    "X": "10001/10001/01010/00100/01010/10001/10001",
    "Y": "10001/10001/01010/00100/00100/00100/00100",
    "Z": "11111/00001/00010/00100/01000/10000/11111",
    "0": "01110/10001/10011/10101/11001/10001/01110",
    "1": "00100/01100/00100/00100/00100/00100/01110",
    "2": "01110/10001/00001/00010/00100/01000/11111",
    "3": "11110/00001/00001/01110/00001/00001/11110",
    "4": "00010/00110/01010/10010/11111/00010/00010",
    "5": "11111/10000/10000/11110/00001/00001/11110",
    "6": "01110/10000/10000/11110/10001/10001/01110",
    "7": "11111/00001/00010/00100/01000/01000/01000",
    "8": "01110/10001/10001/01110/10001/10001/01110",
    "9": "01110/10001/10001/01111/00001/00001/01110",
    ":": "00000/00100/00100/00000/00100/00100/00000",
    ".": "00000/00000/00000/00000/00000/01100/01100",
    ",": "00000/00000/00000/00000/01100/01100/00100",
    "-": "00000/00000/00000/11111/00000/00000/00000",
    "/": "00001/00001/00010/00100/01000/10000/10000",
    "(": "00010/00100/01000/01000/01000/00100/00010",
    ")": "01000/00100/00010/00010/00010/00100/01000",
    "+": "00000/00100/00100/11111/00100/00100/00000",
    "=": "00000/11111/00000/11111/00000/00000/00000",
    "%": "11001/11010/00100/00100/01011/10011/00000",
    "_": "00000/00000/00000/00000/00000/00000/11111",
}


def _chunk(kind: bytes, payload: bytes) -> bytes:
    body = kind + payload
    return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body))


def _parse_color(value: tuple[int, int, int] | str) -> tuple[int, int, int]:
    if isinstance(value, str):
        named = {"black": (0, 0, 0), "white": (255, 255, 255)}
        if value in named:
            return named[value]
        if len(value) == 7 and value.startswith("#"):
            try:
                return tuple(bytes.fromhex(value[1:]))
            except ValueError:
                pass
        raise ValueError("Expected a named or six-digit RGB color")
    if len(value) != 3 or any(type(channel) is not int or not 0 <= channel <= 255
                              for channel in value):
        raise ValueError("RGB color requires three 8-bit channels")
    return value


def _unpack_samples(row: bytes, width: int, bit_depth: int) -> list[int]:
    if bit_depth == 8:
        return list(row[:width])
    mask = (1 << bit_depth) - 1
    result = []
    for byte in row:
        for shift in range(8 - bit_depth, -1, -bit_depth):
            result.append((byte >> shift) & mask)
            if len(result) == width:
                return result
    raise ValueError("Truncated packed PNG row")


def _decode_rgb(row: bytes, width: int, color_type: int, bit_depth: int,
                palette: bytes | None) -> bytes:
    if color_type == 2:
        return row
    if color_type == 6:
        return b"".join(row[index : index + 3] for index in range(0, width * 4, 4))
    if color_type == 4:
        return b"".join(bytes((row[index],)) * 3 for index in range(0, width * 2, 2))
    samples = _unpack_samples(row, width, bit_depth)
    if color_type == 0:
        maximum = (1 << bit_depth) - 1
        return b"".join(bytes((round(sample * 255 / maximum),)) * 3
                        for sample in samples)
    if palette is None:
        raise ValueError("Indexed PNG has no palette")
    result = bytearray()
    for sample in samples:
        offset = sample * 3
        if offset + 3 > len(palette):
            raise ValueError("Indexed PNG refers outside its palette")
        result.extend(palette[offset : offset + 3])
    return bytes(result)


def read_png(path: Path | str) -> "RgbImage":
    source = Path(path)
    with source.open("rb") as stream:
        data = stream.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        raise ValueError("PNG exceeds the supported capture file size")
    if not data.startswith(PNG_SIGNATURE):
        raise ValueError("Expected a PNG image")
    position = len(PNG_SIGNATURE)
    header = None
    palette = None
    compressed = bytearray()
    ended = False
    while position + 12 <= len(data):
        length = struct.unpack_from(">I", data, position)[0]
        position += 4
        if length > len(data) - position - 8:
            raise ValueError("Truncated PNG chunk")
        kind = data[position : position + 4]
        payload = data[position + 4 : position + 4 + length]
        expected_crc = struct.unpack_from(">I", data, position + 4 + length)[0]
        if zlib.crc32(kind + payload) != expected_crc:
            raise ValueError("PNG chunk CRC mismatch")
        position += length + 8
        if kind == b"IHDR":
            if header is not None or length != 13 or position != 33:
                raise ValueError("Invalid PNG header")
            width, height, bit_depth, color_type, compression, filtering, interlace = (
                struct.unpack(">IIBBBBB", payload)
            )
            if (not width or not height or width * height > MAX_PIXELS
                    or compression or filtering or interlace):
                raise ValueError("Unsupported PNG dimensions or encoding")
            valid_depths = {0: (1, 2, 4, 8), 2: (8,), 3: (1, 2, 4, 8),
                            4: (8,), 6: (8,)}
            if bit_depth not in valid_depths.get(color_type, ()):
                raise ValueError("Unsupported PNG color format")
            header = (width, height, bit_depth, color_type)
        elif kind == b"PLTE":
            if header is None or not length or length % 3 or length > 768:
                raise ValueError("Invalid PNG palette")
            palette = payload
        elif kind == b"IDAT":
            if header is None:
                raise ValueError("PNG image data precedes its header")
            compressed.extend(payload)
            if len(compressed) > MAX_FILE_BYTES:
                raise ValueError("PNG compressed data exceeds the supported size")
        elif kind == b"IEND":
            if length or header is None or not compressed:
                raise ValueError("Invalid PNG end marker")
            ended = True
            break
        elif kind in (b"acTL", b"fcTL", b"fdAT") or kind[0] & 0x20 == 0:
            raise ValueError("Unsupported critical or animated PNG chunk")
    if not ended or position != len(data):
        raise ValueError("PNG is truncated or has trailing data")
    width, height, bit_depth, color_type = header
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color_type]
    row_bytes = (width * channels * bit_depth + 7) // 8
    bytes_per_pixel = max(1, (channels * bit_depth + 7) // 8)
    expected_size = (row_bytes + 1) * height
    decoder = zlib.decompressobj()
    raw = decoder.decompress(compressed, expected_size + 1)
    if (len(raw) != expected_size or not decoder.eof or decoder.unused_data
            or decoder.unconsumed_tail):
        raise ValueError("PNG decompressed size does not match its dimensions")
    pixels = bytearray(width * height * 3)
    previous = bytearray(row_bytes)
    offset = 0
    for y in range(height):
        filter_type = raw[offset]
        row = bytearray(raw[offset + 1 : offset + 1 + row_bytes])
        offset += row_bytes + 1
        if filter_type > 4:
            raise ValueError("Unsupported PNG row filter")
        if filter_type:
            for index in range(row_bytes):
                left = row[index - bytes_per_pixel] if index >= bytes_per_pixel else 0
                above = previous[index]
                upper_left = previous[index - bytes_per_pixel] if index >= bytes_per_pixel else 0
                if filter_type == 1:
                    predictor = left
                elif filter_type == 2:
                    predictor = above
                elif filter_type == 3:
                    predictor = (left + above) // 2
                else:
                    base = left + above - upper_left
                    distances = (abs(base - left), abs(base - above), abs(base - upper_left))
                    predictor = (left, above, upper_left)[distances.index(min(distances))]
                row[index] = (row[index] + predictor) & 255
        pixels[y * width * 3 : (y + 1) * width * 3] = _decode_rgb(
            row, width, color_type, bit_depth, palette
        )
        previous = row
    return RgbImage(width, height, pixels)


def _kernel(method: str, distance: float) -> float:
    distance = abs(distance)
    if method == "bilinear":
        return max(0.0, 1.0 - distance)
    if method == "bicubic":
        if distance < 1:
            return (1.5 * distance - 2.5) * distance * distance + 1
        if distance < 2:
            return ((-0.5 * distance + 2.5) * distance - 4) * distance + 2
        return 0.0
    if method == "lanczos" and distance < 3:
        if distance == 0:
            return 1.0
        return (math.sin(math.pi * distance) * math.sin(math.pi * distance / 3)
                / (math.pi * math.pi * distance * distance / 3))
    return 0.0


def _weights(source_size: int, target_size: int, method: str):
    support = {"bilinear": 1, "bicubic": 2, "lanczos": 3}[method]
    scale = max(1.0, source_size / target_size)
    result = []
    for target in range(target_size):
        center = (target + 0.5) * source_size / target_size - 0.5
        lower = max(0, math.ceil(center - support * scale))
        upper = min(source_size - 1, math.floor(center + support * scale))
        values = [(source, _kernel(method, (source - center) / scale))
                  for source in range(lower, upper + 1)]
        divisor = math.fsum(weight for _, weight in values)
        if not divisor:
            result.append([(min(source_size - 1, max(0, round(center))), 1.0)])
        else:
            result.append([(source, weight / divisor) for source, weight in values])
    return result


class RgbImage:
    """Mutable, row-major 8-bit RGB image with explicit bounded operations."""

    def __init__(self, width: int, height: int, pixels: bytes | bytearray):
        if (type(width) is not int or type(height) is not int or width <= 0
                or height <= 0 or width * height > MAX_PIXELS
                or len(pixels) != width * height * 3):
            raise ValueError("Invalid RGB image dimensions or pixel data")
        self.width = width
        self.height = height
        self.pixels = bytearray(pixels)

    @property
    def size(self) -> tuple[int, int]:
        return self.width, self.height

    @classmethod
    def new(cls, size: tuple[int, int], color=(0, 0, 0)) -> "RgbImage":
        red, green, blue = _parse_color(color)
        width, height = size
        return cls(width, height, bytes((red, green, blue)) * (width * height))

    def copy(self) -> "RgbImage":
        return RgbImage(self.width, self.height, self.pixels)

    def getpixel(self, xy: tuple[int, int]) -> tuple[int, int, int]:
        x, y = xy
        if not (0 <= x < self.width and 0 <= y < self.height):
            raise ValueError("Pixel is outside the image")
        offset = (y * self.width + x) * 3
        return tuple(self.pixels[offset : offset + 3])

    def putpixel(self, xy: tuple[int, int], color) -> None:
        x, y = xy
        if not (0 <= x < self.width and 0 <= y < self.height):
            raise ValueError("Pixel is outside the image")
        offset = (y * self.width + x) * 3
        self.pixels[offset : offset + 3] = bytes(_parse_color(color))

    def crop(self, box: tuple[int, int, int, int]) -> "RgbImage":
        left, top, right, bottom = box
        if not (0 <= left < right <= self.width and 0 <= top < bottom <= self.height):
            raise ValueError("Crop is outside the image")
        width = right - left
        pixels = b"".join(self.pixels[(y * self.width + left) * 3 :
                                       (y * self.width + right) * 3]
                          for y in range(top, bottom))
        return RgbImage(width, bottom - top, pixels)

    def paste(self, image: "RgbImage", xy: tuple[int, int]) -> None:
        x, y = xy
        if not (0 <= x and 0 <= y and x + image.width <= self.width
                and y + image.height <= self.height):
            raise ValueError("Pasted image is outside the destination")
        for row in range(image.height):
            start = ((y + row) * self.width + x) * 3
            source = row * image.width * 3
            self.pixels[start : start + image.width * 3] = (
                image.pixels[source : source + image.width * 3]
            )

    def draw_line(self, points, color=(0, 0, 0)) -> None:
        """Draw connected one-pixel line segments with clipped endpoints."""
        if len(points) == 4 and all(isinstance(value, (int, float)) for value in points):
            points = [(points[0], points[1]), (points[2], points[3])]
        ink = bytes(_parse_color(color))
        for first, second in zip(points, points[1:]):
            x0, y0 = (round(value) for value in first)
            x1, y1 = (round(value) for value in second)
            dx, dy = abs(x1 - x0), abs(y1 - y0)
            step_x, step_y = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
            error = dx - dy
            while True:
                if 0 <= x0 < self.width and 0 <= y0 < self.height:
                    offset = (y0 * self.width + x0) * 3
                    self.pixels[offset : offset + 3] = ink
                if x0 == x1 and y0 == y1:
                    break
                doubled = error * 2
                if doubled > -dy:
                    error -= dy
                    x0 += step_x
                if doubled < dx:
                    error += dx
                    y0 += step_y

    def draw_rectangle(self, box: tuple[int, int, int, int], color=(0, 0, 0)) -> None:
        left, top, right, bottom = box
        self.draw_line([(left, top), (right, top), (right, bottom),
                        (left, bottom), (left, top)], color)

    def draw_text(self, xy: tuple[int, int], label: str, color=(0, 0, 0)) -> None:
        x, y = xy
        ink = bytes(_parse_color(color))
        for character in label.upper():
            rows = GLYPHS.get(character, GLYPHS["?"]).split("/")
            for row_number, row in enumerate(rows):
                for column, bit in enumerate(row):
                    if bit == "1" and 0 <= x + column < self.width and 0 <= y + row_number < self.height:
                        offset = ((y + row_number) * self.width + x + column) * 3
                        self.pixels[offset : offset + 3] = ink
            x += 6

    def resize(self, size: tuple[int, int], method: str = "nearest") -> "RgbImage":
        width, height = size
        if method not in RESAMPLING:
            raise ValueError("Unsupported image resampling method")
        if width <= 0 or height <= 0 or width * height > MAX_PIXELS:
            raise ValueError("Invalid target image dimensions")
        if size == self.size:
            return self.copy()
        if method == "nearest":
            result = bytearray(width * height * 3)
            for y in range(height):
                source_y = min(self.height - 1, (2 * y + 1) * self.height // (2 * height))
                for x in range(width):
                    source_x = min(self.width - 1, (2 * x + 1) * self.width // (2 * width))
                    source = (source_y * self.width + source_x) * 3
                    target = (y * width + x) * 3
                    result[target : target + 3] = self.pixels[source : source + 3]
            return RgbImage(width, height, result)
        horizontal = _weights(self.width, width, method)
        vertical = _weights(self.height, height, method)
        intermediate = array("f", [0.0]) * (width * self.height * 3)
        for y in range(self.height):
            for x, weights in enumerate(horizontal):
                target = (y * width + x) * 3
                for source_x, weight in weights:
                    source = (y * self.width + source_x) * 3
                    for channel in range(3):
                        intermediate[target + channel] += self.pixels[source + channel] * weight
        result = bytearray(width * height * 3)
        for y, weights in enumerate(vertical):
            for x in range(width):
                target = (y * width + x) * 3
                for channel in range(3):
                    value = math.fsum(intermediate[(source_y * width + x) * 3 + channel] * weight
                                      for source_y, weight in weights)
                    result[target + channel] = min(255, max(0, math.floor(value + 0.5)))
        return RgbImage(width, height, result)

    def save(self, path: Path | str) -> None:
        rows = b"".join(b"\0" + self.pixels[y * self.width * 3 : (y + 1) * self.width * 3]
                        for y in range(self.height))
        header = struct.pack(">IIBBBBB", self.width, self.height, 8, 2, 0, 0, 0)
        Path(path).write_bytes(
            PNG_SIGNATURE + _chunk(b"IHDR", header)
            + _chunk(b"IDAT", zlib.compress(rows, 9)) + _chunk(b"IEND", b"")
        )
