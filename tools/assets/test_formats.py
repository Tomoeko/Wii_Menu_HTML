"""Synthetic format fixtures: no copyrighted resource bytes are committed."""

import struct
import unittest
import zlib

from formats import (
    animation,
    ash0,
    bmg,
    decode_texture,
    font,
    huffman,
    layout,
    material,
    png,
    u8_files,
)


def block(kind, payload):
    return kind + struct.pack(">I", len(payload) + 8) + payload


def nw4r(kind, blocks):
    return (
        kind
        + struct.pack(">HHIHH", 0xFEFF, 8, 16 + sum(map(len, blocks)), 16, len(blocks))
        + b"".join(blocks)
    )


class TextureTests(unittest.TestCase):
    def test_huffman_big_endian_decisions_from_little_endian_words(self):
        data = b"\x28\x04\0\0\x01\xc0AB" + (0x50000000).to_bytes(4, "little")
        self.assertEqual(huffman(data), b"ABAB")

    def test_huffman_four_bit_symbols_pack_low_nibble_first(self):
        data = b"\x24\x02\0\0\x01\xc0\x01\x02" + (0x50000000).to_bytes(4, "little")
        self.assertEqual(huffman(data), b"\x21\x21")

    def test_ia4_alpha_high_nibble_and_intensity_low(self):
        self.assertEqual(decode_texture(bytes([0xA3]) * 32, 1, 1, 2), bytes([51, 51, 51, 170]))

    def test_padded_i4_tiles_keep_input_stride(self):
        data = bytes([0x12]) * 32 + bytes([0xEF]) * 32
        decoded = decode_texture(data, 9, 1, 0)
        self.assertEqual(decoded[:8], bytes([17] * 4 + [34] * 4))
        self.assertEqual(decoded[-4:], bytes([238] * 4))

    def test_rgba8_separate_ar_gb_planes(self):
        tile = bytes([17, 34]) * 16 + bytes([51, 68]) * 16
        self.assertEqual(decode_texture(tile, 1, 1, 6), bytes([34, 51, 68, 17]))

    def test_rgb565_bit_replication(self):
        tile = struct.pack(">H", 0x1020) * 16
        self.assertEqual(decode_texture(tile, 1, 1, 4), bytes([16, 4, 0, 255]))

    def test_cmpr_console_three_eighths_interpolation(self):
        tile = struct.pack(">HHI", 0xF800, 0x001F, 0xAAAAAAAA) * 4
        self.assertEqual(decode_texture(tile, 1, 1, 14), bytes([159, 0, 95, 255]))

    def test_cmpr_transparent_pixel_retains_average_rgb(self):
        tile = struct.pack(">HHI", 0x001F, 0xF800, 0xFFFFFFFF) * 4
        self.assertEqual(decode_texture(tile, 1, 1, 14), bytes([127, 0, 127, 0]))

    def test_ci4_palette_selection(self):
        palette = [[i, 2 * i, 3 * i, 255] for i in range(16)]
        self.assertEqual(
            decode_texture(bytes([0xAB]) * 32, 2, 1, 8, palette), bytes(palette[10] + palette[11])
        )

    def test_png_preserves_rgba_without_dependency(self):
        encoded = png(1, 1, b"\x10\x20\x30\x40")
        self.assertEqual(encoded[:8], b"\x89PNG\r\n\x1a\n")
        pos = encoded.index(b"IDAT")
        size = struct.unpack_from(">I", encoded, pos - 4)[0]
        self.assertEqual(zlib.decompress(encoded[pos + 4 : pos + 4 + size]), b"\0\x10\x20\x30\x40")


class ArchiveTests(unittest.TestCase):
    def test_bmg_retains_message_index_newline_and_opaque_control_packet(self):
        info = block(b"INF1", struct.pack(">HHII", 1, 4, 0, 2))
        control = bytes.fromhex("001a080102030405")
        text = b"\0\0" + "One\n".encode("utf-16-be") + control + "Two".encode("utf-16-be") + b"\0\0"
        body = info + block(b"DAT1", text)
        data = b"MESGbmg1" + struct.pack(">II", 32 + len(body), 2) + b"\x02" + bytes(15) + body
        parsed = bmg(data)
        self.assertEqual(parsed["messages"]["0"], "One\nTwo")
        self.assertEqual(
            parsed["records"][0]["tokens"][1], {"type": "control", "rawHex": control.hex()}
        )

    def test_u8_nested_directories_and_sibling(self):
        names = b"\0folder\0inner\0outer\0"
        root = 32
        table = b"".join(
            struct.pack(">III", *entry)
            for entry in [(0x1000000, 0, 4), (0x1000001, 0, 3), (8, 100, 3), (14, 103, 3)]
        )
        data = (
            struct.pack(">4I", 0x55AA382D, root, len(table) + len(names), 100)
            + bytes(16)
            + table
            + names
        )
        data = data.ljust(100, b"\0") + b"abcxyz"
        self.assertEqual(u8_files(data), {"folder/inner": b"abc", "outer": b"xyz"})

    def test_ash_literal_tree(self):
        # A single leaf code 65 requires no body bits; output four As.
        literal_tree = int("0" + format(65, "09b") + "0" * 22, 2)
        data = b"ASH0" + struct.pack(">III", 4, 16, literal_tree) + bytes(4)
        self.assertEqual(ash0(data), b"AAAA")

    def test_ash_rejects_truncated_tree(self):
        with self.assertRaises(ValueError):
            ash0(b"ASH0" + struct.pack(">II", 4, 12))


class NW4RTests(unittest.TestCase):
    def test_material_flags_follow_original_nw4r_header(self):
        flags = (1 << 25) | (1 << 27) | (1 << 18) | (1 << 23) | (1 << 24)
        body = (
            b"fixture".ljust(20, b"\0")
            + struct.pack(">12h", *range(12))
            + bytes(16)
            + struct.pack(">I", flags)
        )
        body += (
            bytes([1, 0, 0, 0])
            + bytes([8, 9, 10, 11])
            + bytes(range(16))
            + bytes([12, 13, 14, 15])
            + bytes([1, 4, 5, 15])
        )
        parsed = material(body, 0)
        self.assertEqual(parsed["colors"][1], [4, 5, 6, 7])
        self.assertEqual(parsed["channelControl"], [1, 0, 0, 0])
        self.assertEqual(parsed["materialColor"], [8, 9, 10, 11])
        self.assertEqual(parsed["tevStages"], [list(range(16))])
        self.assertEqual(parsed["blendMode"], [1, 4, 5, 15])

    def test_animation_step_u16_and_property_byte(self):
        track = struct.pack(">4BHHI", 3, 7, 1, 0, 1, 0, 12) + struct.pack(">fHH", 2.0, 257, 0)
        tag = b"RLVI" + struct.pack(">B3xI", 1, 12) + track
        target = b"pane".ljust(20, b"\0") + struct.pack(">BBHI", 1, 0, 0, 28) + tag
        pai = block(b"pai1", struct.pack(">HBBHHII", 60, 1, 0, 0, 1, 20, 24) + target)
        parsed = animation(nw4r(b"RLAN", [pai]))
        self.assertEqual(parsed["frames"], 60)
        track = parsed["targets"][0]["tracks"][0]
        self.assertEqual((track["id"], track["target"]), (3, 7))
        self.assertEqual(track["keys"], [{"frame": 2.0, "value": 257}])

    def test_font_code_map_metrics_and_one_pixel_sheet_inset(self):
        info = block(
            b"FINF", struct.pack(">BbHbBbBIII4B", 1, 4, 0, -1, 2, 3, 1, 56, 120, 140, 3, 3, 2, 0)
        )
        glyph = block(
            b"TGLP",
            struct.pack(">BBbBIHHHHHHI", 3, 3, 2, 3, 32, 1, 2, 2, 1, 8, 4, 80) + bytes([0xF0]) * 32,
        )
        widths = block(b"CWDH", struct.pack(">HHIbBbB", 0, 0, 0, -1, 2, 3, 0))
        mapping = block(b"CMAP", struct.pack(">4HIHH", 65, 65, 0, 0, 0, 0, 0))
        parsed = font(nw4r(b"RFNT", [info, glyph, widths, mapping]))
        self.assertEqual(parsed["characters"], {"65": 0})
        self.assertEqual(
            parsed["glyphs"]["0"],
            {"sheet": 0, "x": 1, "y": 1, "width": 2, "height": 3, "left": -1, "advance": 3},
        )
        self.assertEqual(parsed["sheets"][0]["pixels"][:4], bytes([0, 0, 0, 255]))

    def test_archive_font_expands_original_sheet_before_gx_decode(self):
        compressed = b"\x28\x20\0\0\x01\xc0\xf0\xf0" + bytes(4)
        info = block(
            b"FINF", struct.pack(">BbHbBbBIII4B", 1, 4, 0, -1, 2, 3, 1, 56, 104, 124, 3, 3, 2, 0)
        )
        glyph = block(
            b"TGLP",
            struct.pack(">BBbBIHHHHHHI", 3, 3, 2, 3, 32, 1, 0x8002, 2, 1, 8, 4, 80)
            + struct.pack(">I", len(compressed))
            + compressed,
        )
        widths = block(b"CWDH", struct.pack(">HHIbBbB", 0, 0, 0, -1, 2, 3, 0))
        mapping = block(b"CMAP", struct.pack(">4HIHH", 65, 65, 0, 0, 0, 0, 0))
        parsed = font(nw4r(b"RFNA", [info, glyph, widths, mapping]))
        self.assertEqual(parsed["sheets"][0]["format"], 2)
        self.assertEqual(parsed["sheets"][0]["pixels"], bytes([0, 0, 0, 255]) * 32)

    def test_pane_hierarchy_and_coordinates(self):
        def pane(name, x):
            return block(
                b"pan1",
                bytes([1, 4, 255, 0])
                + name.encode().ljust(16, b"\0")
                + bytes(8)
                + struct.pack(">10f", x, 2, 0, 0, 0, 0, 1, 1, 100, 50),
            )

        parsed = layout(
            nw4r(
                b"RLYT",
                [
                    block(b"lyt1", bytes([1, 0, 0, 0]) + struct.pack(">2f", 608, 456)),
                    pane("root", 0),
                    block(b"pas1", b""),
                    pane("child", 10),
                    block(b"pae1", b""),
                ],
            )
        )
        self.assertEqual((parsed["width"], parsed["height"]), (608, 456))
        self.assertEqual(parsed["root"]["children"][0]["translation"], [10, 2, 0])


if __name__ == "__main__":
    unittest.main()
