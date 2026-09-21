"""Synthetic encrypted WAD fixtures contain no console keys or Nintendo assets."""

import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest

from wad import align, decrypt_contents, extract_wad, parse_wad, read_common_key
from common_keys import retail_common_key
from prepare import import_wad
from channels_export import unwrap_resource
from export import export_settings
from export_outline_fonts import browser_font, checksum, export_outline_fonts, split_collection

from aes import AesCbc

KEY = bytes(range(16))
TITLE = bytes.fromhex("0001000154455354")


def encrypted(data, key, iv):
    with AesCbc() as context:
        return context.crypt(data, key, iv, decrypt=False)


def make_wad(payloads, *, title=TITLE, key_index=0, common_key=KEY):
    title_key = bytes(range(16, 32))
    ticket = bytearray(0x2A4)
    struct.pack_into(">I", ticket, 0, 0x10001)
    ticket[0x1DC:0x1E4] = title
    ticket[0x1BF:0x1CF] = encrypted(title_key, common_key, title + bytes(8))
    ticket[0x1F1] = key_index
    tmd = bytearray(0x1E4 + 36 * len(payloads))
    struct.pack_into(">I", tmd, 0, 0x10001)
    tmd[0x18C:0x194] = title
    struct.pack_into(">HHH", tmd, 0x1DC, 1, len(payloads), 7)
    content = bytearray()
    for ordinal, (index, data) in enumerate(payloads):
        struct.pack_into(
            ">IHHQ20s",
            tmd,
            0x1E4 + ordinal * 36,
            ordinal + 42,
            index,
            1,
            len(data),
            hashlib.sha1(data).digest(),
        )
        encoded = encrypted(
            data.ljust(align(len(data), 16), b"\0"), title_key, index.to_bytes(2, "big") + bytes(14)
        )
        content.extend(encoded.ljust(align(len(data)), b"\0"))
    parts = [b"", b"", bytes(ticket), bytes(tmd), bytes(content), b""]
    header = struct.pack(">IHH6I", 32, 0x4973, 0, *(len(p) for p in parts))
    return header.ljust(64, b"\0") + b"".join(p.ljust(align(len(p)), b"\0") for p in parts)


def make_u8(files):
    tree = {}
    for name, data in files.items():
        branch = tree
        parts = name.split("/")
        for part in parts[:-1]:
            branch = branch.setdefault(part, {})
        branch[parts[-1]] = data
    names, nodes = bytearray(b"\0"), []

    def add(name, item, parent):
        name_offset = 0 if name == "" else len(names)
        if name:
            names.extend(name.encode() + b"\0")
        index = len(nodes)
        node = [name_offset, parent, 0, None]
        nodes.append(node)
        if isinstance(item, dict):
            node[0] |= 0x1000000
            for key, value in item.items():
                add(key, value, index)
            node[2] = len(nodes)
        else:
            node[3] = item
        return index

    add("", tree, 0)
    data_offset = align(32 + 12 * len(nodes) + len(names))
    body = bytearray()
    for node in nodes:
        if node[3] is not None:
            node[1], node[2] = data_offset + len(body), len(node[3])
            body.extend(node[3])
    table = b"".join(struct.pack(">III", *node[:3]) for node in nodes)
    header = struct.pack(">4I", 0x55AA382D, 32, len(table) + len(names), data_offset) + bytes(16)
    return (header + table + names).ljust(data_offset, b"\0") + body


def channel_fixture():
    # A minimal authored pane is sufficient to exercise the real layout exporter.
    pane = (
        bytes([1, 4, 255, 0])
        + b"root".ljust(24, b"\0")
        + struct.pack(">10f", 0, 0, 0, 0, 0, 0, 1, 1, 128, 96)
    )
    block = b"pan1" + struct.pack(">I", len(pane) + 8) + pane
    layout = b"RLYT" + struct.pack(">HHIHH", 0xFEFF, 8, len(block) + 16, 16, 1) + block
    archive = make_u8(
        {
            "meta/icon.bin": make_u8({"arc/blyt/icon.brlyt": layout}),
            "meta/banner.bin": make_u8({"arc/blyt/banner.brlyt": layout}),
        }
    )
    imet = bytearray(0x600)
    imet[64:68] = b"IMET"
    struct.pack_into(">II", imet, 68, 0x600, 3)
    name = "Synthetic Channel".encode("utf-16-be")
    imet[64 + 28 + 84 : 64 + 28 + 84 + len(name)] = name
    return bytes(imet) + archive


class WadTests(unittest.TestCase):
    def test_nonsequential_content_indices_and_block_padding(self):
        data = make_wad([(7, b"A" * 73), (2, b"B" * 17)])
        meta, contents, _ = decrypt_contents(data, KEY)
        self.assertEqual(meta["titleId"], TITLE.hex())
        self.assertEqual(contents, {"0000002a": b"A" * 73, "0000002b": b"B" * 17})

    def test_wrong_key_and_modified_content_fail_hash_check(self):
        data = make_wad([(7, b"original")])
        with self.assertRaisesRegex(ValueError, "SHA-1 mismatch"):
            decrypt_contents(data, bytes(16))
        modified = bytearray(data)
        modified[-64] ^= 1
        with self.assertRaisesRegex(ValueError, "SHA-1 mismatch"):
            decrypt_contents(modified, KEY)

    def test_truncated_headers_and_content_are_rejected(self):
        for data in [b"", bytes(32), make_wad([(7, b"A" * 73)])[:-64]]:
            with self.assertRaises(ValueError):
                parse_wad(data)

    def test_duplicate_indices_and_mismatched_title_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            parse_wad(make_wad([(7, b"A"), (7, b"B")]))
        data = bytearray(make_wad([(7, b"A")]))
        data[64 + 0x1DC] ^= 1
        with self.assertRaisesRegex(ValueError, "title IDs"):
            parse_wad(data)

    def test_common_key_index_is_explicit(self):
        with self.assertRaisesRegex(ValueError, "common-key index 1"):
            decrypt_contents(make_wad([(7, b"A")], key_index=1), KEY)

    def test_import_uses_ticket_index_for_default_retail_keys(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "menu.wad"
            for index in (0, 1):
                source.write_bytes(
                    make_wad(
                        [(7, b"synthetic menu resource")],
                        title=bytes.fromhex("0000000100000002"),
                        key_index=index,
                        common_key=retail_common_key(index),
                    )
                )
                title, descriptor = import_wad(source, root, None, None, menu=True)
                self.assertEqual(title, "0000000100000002")
                content = Path(descriptor["contentDirectory"]) / "0000002a.app"
                self.assertEqual(content.read_bytes(), b"synthetic menu resource")

    def test_unknown_ticket_key_requires_override_and_rejects_wrong_index(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "menu.wad"
            source.write_bytes(
                make_wad([(7, b"fixture")], title=bytes.fromhex("0000000100000002"), key_index=9)
            )
            with self.assertRaisesRegex(ValueError, "No built-in retail common key"):
                import_wad(source, root, None, None, menu=True)
            with self.assertRaisesRegex(ValueError, "WAD requires common-key index 9"):
                import_wad(source, root, KEY, 0, menu=True)
            title, descriptor = import_wad(source, root, KEY, None, menu=True)
            self.assertEqual(title, "0000000100000002")
            self.assertTrue(Path(descriptor["contentDirectory"]).is_dir())

    def test_failed_import_preserves_previously_validated_title(self):
        with tempfile.TemporaryDirectory() as temp:
            source, target = Path(temp) / "test.wad", Path(temp) / "titles"
            source.write_bytes(make_wad([(7, b"original")]))
            _, content = extract_wad(source, target, KEY)
            with self.assertRaises(ValueError):
                extract_wad(source, target, bytes(16))
            self.assertEqual((content / "0000002a.app").read_bytes(), b"original")

    def test_cli_add_remove_preserves_other_configuration_and_exports_catalog(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source, key, local, output = (
                root / "channel.wad",
                root / "key.bin",
                root / "local",
                root / "assets",
            )
            source.write_bytes(make_wad([(7, channel_fixture())]))
            key.write_bytes(KEY)
            output.mkdir()
            (output / "manifest.json").write_text("{}")
            (output / "channel-audio.json").write_text(
                json.dumps({TITLE.hex(): {"src": "/assets/stale.wav", "sourceSha256": "outdated"}})
            )
            command = [sys.executable, str(Path(__file__).with_name("prepare.py"))]
            common = [
                "--local-dir",
                str(local),
                "--output",
                str(output),
            ]
            added = subprocess.run(
                command + ["add", "--wad", str(source), "--common-key-file", str(key)] + common,
                capture_output=True,
                text=True,
            )
            self.assertEqual(added.returncode, 0, added.stderr)
            catalog = json.loads((output / "channels.json").read_text())
            self.assertEqual(catalog["defaultOrder"], [TITLE.hex()])
            self.assertEqual(catalog["channels"][0]["title"], "Synthetic Channel")
            self.assertNotIn("audio", catalog["channels"][0])
            self.assertTrue((output / catalog["channels"][0]["iconLayout"]).exists())
            removed = subprocess.run(
                command + ["remove", TITLE.hex()] + common, capture_output=True, text=True
            )
            self.assertEqual(removed.returncode, 0, removed.stderr)
            self.assertEqual(json.loads((output / "channels.json").read_text())["channels"], [])
            self.assertIn(
                TITLE.hex(), json.loads((local / "prepare.json").read_text())["removedChannels"]
            )


class InputTests(unittest.TestCase):
    def test_css_uses_literal_unicode_for_original_and_misdecoded_opera_aliases(self):
        # Tiny synthetic TTC name table is sufficient to exercise export names.
        family = "Wii NTLG PGothic".encode("utf-16-be")
        names = struct.pack(">3H6H", 0, 1, 18, 3, 1, 0x409, 1, len(family), 0) + family
        head = bytes(12)
        header = struct.pack(">4sI2I", b"ttcf", 0x10000, 1, 16)
        directory = struct.pack(">I4H", 0x10000, 2, 32, 1, 0)
        directory += struct.pack(">4sIII", b"head", checksum(head), 60, len(head))
        directory += struct.pack(">4sIII", b"name", checksum(names), 72, len(names))
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "fixture.ttc"
            source.write_bytes(header + directory + head + names)
            (root / "manifest.json").write_text("{}")
            result = export_outline_fonts(source, root)
            css = (root / result["css"]).read_text()
            self.assertNotIn("\\u", css)  # JSON escapes are not Unicode CSS escapes.
            for weight in ("DB", "M"):
                legacy = "FOT-ロダンNTLG Pro " + weight
                self.assertIn(legacy, css)
                self.assertIn(legacy.encode("cp932").decode("utf-8", errors="replace"), css)
            self.assertTrue((root / result["faces"][0]["rawUrl"]).is_file())

    def test_browser_font_repairs_only_invalid_terminal_cmap_sentinel(self):
        # Format 4 maps A to glyph 3 and the original invalid U+FFFF to 65535.
        # The browser copy must retain A while making the terminal .notdef valid.
        cmap4 = struct.pack(">7H", 4, 32, 0, 4, 4, 1, 0)
        cmap4 += struct.pack(">9H", 65, 65535, 0, 65, 65535, (3 - 65) & 65535, 0, 0, 0)
        cmap = struct.pack(">HHHHI", 0, 1, 3, 1, 12) + cmap4
        head = bytes(12)
        header = struct.pack(">4sI2I", b"ttcf", 0x10000, 1, 16)
        directory = struct.pack(">I4H", 0x10000, 2, 32, 1, 0)
        directory += struct.pack(">4sIII", b"head", checksum(head), 60, len(head))
        directory += struct.pack(">4sIII", b"cmap", checksum(cmap), 72, len(cmap))
        original = split_collection(header + directory + head + cmap)[0]["data"]
        converted, repairs = browser_font(original)
        self.assertEqual(checksum(converted), 0xB1B0AFBA)
        self.assertEqual(
            repairs,
            [
                {
                    "table": "cmap",
                    "format": 4,
                    "codepoint": 65535,
                    "beforeGlyph": 65535,
                    "afterGlyph": 0,
                }
            ],
        )
        _, _, at, length = struct.unpack_from(">4sIII", converted, 28)
        expected = bytearray(cmap)
        struct.pack_into(">H", expected, 12 + 26, 1)
        self.assertEqual(converted[at : at + length], expected)
        self.assertEqual(original[at : at + length], cmap)
        self.assertEqual(browser_font(converted), (converted, []))

    def test_ttc_split_preserves_table_bytes_and_recalculates_sfnt_checksum(self):
        # Synthetic head + glyph tables; no original font data in the fixture.
        header = struct.pack(">4sI2I", b"ttcf", 0x10000, 1, 16)
        head = bytes(12)
        glyph = bytes(range(24))
        directory = struct.pack(">I4H", 0x10000, 2, 32, 1, 0)
        directory += struct.pack(">4sIII", b"head", checksum(head), 60, len(head))
        directory += struct.pack(">4sIII", b"glyf", checksum(glyph), 72, len(glyph))
        font = split_collection(header + directory + head + glyph)[0]["data"]
        self.assertEqual(checksum(font), 0xB1B0AFBA)
        _, _, at, length = struct.unpack_from(">4sIII", font, 28)
        self.assertEqual(font[at : at + length], glyph)

    def test_key_file_binary_hex_and_invalid_length(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "key"
            for value in [KEY, KEY.hex().encode() + b"\n"]:
                path.write_bytes(value)
                self.assertEqual(read_common_key(path), KEY)
            path.write_bytes(b"invalid")
            with self.assertRaises(ValueError):
                read_common_key(path)

    def test_original_empty_settings_file_and_bridge_insertion(self):
        self.assertEqual(unwrap_resource(b"LZ77\x10" + bytes(7)), b"")
        html = b'<!doctype html><head><script src="old.js"></script></head><body>fixture</body>'
        files = {"html/TEST/iplsetting.ash": make_u8({"FIX/US/ENG/index01.html": html})}
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp)
            result = export_settings(files, output, "ENG")
            runtime = (output / result["defaultEntryPoint"]).read_bytes()
            self.assertLess(runtime.index(b"settings-bridge.js"), runtime.index(b"old.js"))
            self.assertEqual(
                (output / "settings-raw/TEST/FIX/US/ENG/index01.html").read_bytes(), html
            )

    def test_settings_widescreen_side_texture_is_extracted_from_menu_resource(self):
        texture = struct.pack(">3I2IHHII", 0x20AF30, 1, 12, 20, 0, 4, 4, 4, 32) + struct.pack(
            ">16H", *([0xFFFF] * 16)
        )
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp)
            result = export_settings({"html/BG_16x9.tpl": texture}, output, "ENG")
            self.assertEqual(result["background"]["width"], 4)
            self.assertEqual(result["background"]["height"], 4)
            self.assertEqual(result["background"]["format"], 4)
            self.assertEqual(result["background"]["source"], "html/BG_16x9.tpl")
            self.assertTrue(
                (output / result["background"]["url"]).read_bytes().startswith(b"\x89PNG")
            )


if __name__ == "__main__":
    unittest.main()
