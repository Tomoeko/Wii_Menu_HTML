"""Synthetic RCHE/U8 inspection fixtures; no original bytecode is distributed."""

import contextlib
import io
import json
from pathlib import Path
import random
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from inspect_chans import (
    decode_instructions,
    decode_lz77,
    inspect_script,
    main,
    parse_rche,
    read_u8,
    unwrap_script,
)


def script_fixture(code=b"\x2c\x00\x00\x30\x00\x00\x02\xe0\x02\x01"):
    data = bytearray(0x64)
    data[:4] = b"RCHE"

    def field(offset, value):
        struct.pack_into(">I", data, offset, value)

    def names(count_field, offset_field, values):
        encoded = [value.encode("utf-8") for value in values]
        base = len(data)
        field(count_field, len(values))
        field(offset_field, base - 0x20)
        data.extend(bytes(4 * len(values)))
        for index, value in enumerate(encoded):
            entry = len(value) << 24 | (len(data) - base)
            struct.pack_into(">I", data, base + index * 4, entry)
            data.extend(value)

    field(0x2C, len(code))
    field(0x30, len(data) - 0x20)
    data.extend(code)
    names(0x34, 0x60, ["main"])
    names(0x48, 0x4C, ["find"])
    field(0x50, 2)
    field(0x54, len(data) - 0x20)
    for value in ("Hello", "日本語"):
        encoded = value.encode("utf-16-be")
        data.extend(struct.pack(">H", len(encoded)) + encoded)
    field(0x40, 1)
    field(0x44, len(data) - 0x20)
    data.extend(struct.pack(">IHBB", 0, 0, 2, 3))
    return bytes(data)


def literal_lz77(data):
    output = bytearray(b"\x10" + len(data).to_bytes(3, "little"))
    for offset in range(0, len(data), 8):
        output.extend(b"\x00" + data[offset:offset + 8])
    return bytes(output)


def archive_fixture(entries):
    """One original-format root and arc directory, followed by named files."""
    count, root = len(entries) + 2, 0x20
    names = bytearray(b"\0arc\0")
    name_offsets = []
    for name, _ in entries:
        name_offsets.append(len(names))
        names.extend(name.encode() + b"\0")
    data_start = (root + count * 12 + len(names) + 31) & ~31
    data = bytearray(data_start)
    data[:16] = struct.pack(">4sIII", b"U\xaa8-", root, data_start - root, data_start)
    struct.pack_into(">III", data, root, 0x01000000, 0, count)
    struct.pack_into(">III", data, root + 12, 0x01000001, 0, count)
    data[root + count * 12:root + count * 12 + len(names)] = names
    for index, ((_, payload), name_offset) in enumerate(zip(entries, name_offsets), 2):
        struct.pack_into(">III", data, root + index * 12, name_offset, len(data), len(payload))
        data.extend(payload)
    return bytes(data)


class RcheTests(unittest.TestCase):
    def test_import_has_no_cli_side_effect_or_external_dependency(self):
        result = subprocess.run(
            [sys.executable, "-c", "import inspect_chans"],
            cwd=Path(__file__).parent, capture_output=True, text=True, check=True,
        )
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr, "")

    def test_tables_unicode_unknown_fields_and_bytecode_are_preserved(self):
        data = script_fixture()
        parsed = parse_rche(data)
        self.assertEqual(parsed["symbols"], ["main"])
        self.assertEqual(parsed["methods"], ["find"])
        self.assertEqual(parsed["strings"], ["Hello", "日本語"])
        self.assertEqual(parsed["functions"][0]["attributeBytes"], [2, 3])
        self.assertEqual(parsed["code"]["hex"], data[0x64:0x6E].hex())
        self.assertNotIn("instructions", parsed)
        self.assertEqual(len(parsed["sha256"]), 64)

    def test_optional_instruction_profile_labels_bytes_without_vm_semantics(self):
        parsed = parse_rche(script_fixture(), instructions=True)
        self.assertEqual(
            [(item["offset"], item["label"], item["size"]) for item in parsed["instructions"]],
            [(0, "OP_2C", 3), (3, "OP_30", 4), (7, "OP_E0", 2), (9, "OP_01", 1)],
        )
        self.assertIn("Provisional", parsed["instructionWarning"])
        self.assertEqual(parsed["instructions"][1]["operandHex"], "000002")
        for code in (b"\x30\0", b"\x80", b"\x29\0\0"):
            with self.subTest(code=code), self.assertRaisesRegex(ValueError, "Instruction"):
                decode_instructions(code)
        # A table inspection does not reject unknown bytecode under an unverified profile.
        self.assertEqual(parse_rche(script_fixture(b"\x80"))["code"]["size"], 1)

    def test_empty_name_entry_preserves_its_method_index(self):
        data = bytearray(script_fixture())
        table = len(data)
        struct.pack_into(">I", data, 0x48, 2)
        struct.pack_into(">I", data, 0x4C, table - 0x20)
        data.extend(struct.pack(">II", 0, 0x04000008) + b"find")
        self.assertEqual(parse_rche(data)["methods"], ["", "find"])
        # A nonempty payload at offset zero remains an invalid overlap.
        struct.pack_into(">I", data, table, 0x01000000)
        with self.assertRaisesRegex(ValueError, "overlaps entry table"):
            parse_rche(data)

    def test_truncated_header_magic_and_out_of_range_code_rejected(self):
        for data in (b"", b"RCHE", b"XXXX" + script_fixture()[4:]):
            with self.subTest(data=data[:4]), self.assertRaises(ValueError):
                parse_rche(data)
        for field, value in ((0x2C, 0xFFFFFFFF), (0x30, 0), (0x30, 0xFFFFFFF0)):
            data = bytearray(script_fixture())
            struct.pack_into(">I", data, field, value)
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                parse_rche(data)

    def test_name_table_range_count_relative_offset_and_utf8_rejected(self):
        original = script_fixture()
        table = 0x20 + struct.unpack_from(">I", original, 0x60)[0]
        mutations = [
            (0x34, ">I", 0xFFFFFFFF),
            (0x60, ">I", 0),
            (table, ">I", 0x04000000),
            (table, ">I", 0x04FFFFFF),
            (table + 4, ">B", 0xFF),
        ]
        for offset, fmt, value in mutations:
            data = bytearray(original)
            struct.pack_into(fmt, data, offset, value)
            with self.subTest(offset=offset, value=value), self.assertRaises(ValueError):
                parse_rche(data)

    def test_string_length_encoding_and_function_references_rejected(self):
        original = script_fixture()
        strings = 0x20 + struct.unpack_from(">I", original, 0x54)[0]
        functions = 0x20 + struct.unpack_from(">I", original, 0x44)[0]
        mutations = [
            (strings, ">H", 3),
            (strings, ">H", 65534),
            (strings + 2, ">H", 0xD800),
            (functions, ">I", 10000),
            (functions + 4, ">H", 2),
            (0x40, ">I", 0xFFFFFFFF),
        ]
        for offset, fmt, value in mutations:
            data = bytearray(original)
            struct.pack_into(fmt, data, offset, value)
            with self.subTest(offset=offset, value=value), self.assertRaises(ValueError):
                parse_rche(data)

    def test_bounded_random_inputs_only_raise_documented_validation_error(self):
        randomizer = random.Random(714)
        for _ in range(200):
            data = bytearray(randomizer.randbytes(randomizer.randrange(0, 256)))
            if len(data) >= 4:
                data[:4] = b"RCHE"
            try:
                parse_rche(data, instructions=True)
            except ValueError:
                pass

    def test_json_cli_reads_requested_file_only(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "script.cs"
            path.write_bytes(script_fixture())
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                self.assertEqual(main([str(path), "--json"]), 0)
            result = json.loads(output.getvalue())
            self.assertEqual(result["symbols"], ["main"])
            self.assertIsNone(result["archiveMember"])
            self.assertEqual(path.read_bytes(), script_fixture())


class EnvelopeTests(unittest.TestCase):
    def test_literal_compression_raw_wrapped_and_archived_selection(self):
        script = script_fixture()
        compressed = literal_lz77(script)
        self.assertEqual(decode_lz77(compressed), script)
        self.assertEqual(unwrap_script(b"LZ77" + compressed)[0], script)
        archive = archive_fixture([("icon.cs.lz7", compressed), ("texture.tpl", b"ignored")])
        result = inspect_script(archive)
        self.assertEqual(result["archiveMember"], "arc/icon.cs.lz7")
        self.assertEqual(result["methods"], ["find"])
        self.assertNotEqual(result["inputSha256"], result["sha256"])

    def test_lz77_overlap_and_invalid_back_references(self):
        # Literal A followed by a three-byte overlapping copy at distance one.
        self.assertEqual(decode_lz77(b"\x10\x04\0\0\x40A\0\0"), b"AAAA")
        for data in (
            b"\x10", b"\x10\0\0\0", b"\x10\x04\0\0\x80\0\0",
            b"\x10\x04\0\0\0A", b"\x10\x04\0\0\x80\0",
        ):
            with self.subTest(data=data), self.assertRaises(ValueError):
                decode_lz77(data)

    def test_ambiguous_missing_and_explicit_members(self):
        archive = archive_fixture([("icon.cs", script_fixture()), ("banner.cs", script_fixture())])
        with self.assertRaisesRegex(ValueError, "found 2"):
            inspect_script(archive)
        self.assertEqual(
            inspect_script(archive, member="arc/banner.cs")["archiveMember"], "arc/banner.cs"
        )
        with self.assertRaisesRegex(ValueError, "not found"):
            inspect_script(archive, member="arc/absent.cs")
        with self.assertRaisesRegex(ValueError, "requires a U8"):
            inspect_script(script_fixture(), member="arc/icon.cs")
        with self.assertRaisesRegex(ValueError, "found 0"):
            inspect_script(archive_fixture([("icon.cs.backup", script_fixture())]))

    def test_archive_root_directory_payload_and_names_rejected(self):
        original = archive_fixture([("icon.cs", script_fixture())])
        mutations = [
            (4, ">I", 0xFFFFFFFF),
            (0x20 + 8, ">I", 0xFFFFFFFF),
            (0x20 + 12 + 8, ">I", 1),
            (0x20 + 24 + 4, ">I", 0),
            (0x20 + 24 + 8, ">I", 0xFFFFFFFF),
            (0x20 + 24, ">I", 0x03000000),
            (12, ">I", 10),
        ]
        for offset, fmt, value in mutations:
            data = bytearray(original)
            struct.pack_into(fmt, data, offset, value)
            with self.subTest(offset=offset, value=value), self.assertRaises(ValueError):
                read_u8(data)
        with self.assertRaisesRegex(ValueError, "component"):
            read_u8(archive_fixture([("../icon.cs", b"x")]))
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            read_u8(archive_fixture([("icon.cs", b"a"), ("icon.cs", b"b")]))
        for size in (0, 4, 31, 50):
            with self.subTest(size=size), self.assertRaises(ValueError):
                read_u8(original[:size])

    def test_archive_path_and_repeated_payload_allocations_are_bounded(self):
        with self.assertRaisesRegex(ValueError, "name exceeds"):
            read_u8(archive_fixture([("x" * 4097, b"x")]))
        original = archive_fixture([("a.cs", b"A" * 8), ("b.cs", b"B" * 8)])
        with patch("inspect_chans.MAX_INPUT_BYTES", 12):
            with self.assertRaisesRegex(ValueError, "cumulative payload"):
                read_u8(original)


if __name__ == "__main__":
    unittest.main()
