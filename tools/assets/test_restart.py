"""Synthetic embedded archive tests; no original executable bytes are included."""

import hashlib
import struct
import unittest

from export_restart import REQUIRED_MEMBERS, find_restart_archive
from test_wad import make_u8


def executable_fixture(address=0x81230000):
    archive = make_u8({name: b"synthetic resource" for name in REQUIRED_MEMBERS})
    prefix = b"not an archive U\xaa8-" + bytes(64)
    section = prefix + archive
    header = bytearray(0x100)
    struct.pack_into(">I", header, 7 * 4, 0x100)
    struct.pack_into(">I", header, 0x48 + 7 * 4, address)
    struct.pack_into(">I", header, 0x90 + 7 * 4, len(section))
    return bytes(header) + section, 0x100 + len(prefix)


class RestartExportTests(unittest.TestCase):
    def test_discovers_valid_archive_after_false_magic_and_derives_relocated_address(self):
        data, offset = executable_fixture()
        members, source = find_restart_archive(data)
        self.assertEqual(set(members), REQUIRED_MEMBERS)
        self.assertEqual(source["archiveOffset"], offset)
        self.assertEqual(source["archiveAddress"], f"0x{0x81230000 + offset - 0x100:08X}")
        self.assertEqual(source["sha256"], hashlib.sha256(data).hexdigest())
        self.assertNotIn("file", source)

    def test_rejects_truncated_archive_or_executable_section(self):
        data, _ = executable_fixture()
        with self.assertRaises(ValueError):
            find_restart_archive(data[:-30])
        invalid = bytearray(data)
        struct.pack_into(">I", invalid, 0x90 + 7 * 4, 1)
        with self.assertRaisesRegex(ValueError, "outside a valid executable"):
            find_restart_archive(bytes(invalid))

    def test_unrelated_archive_does_not_substitute_a_restart_display(self):
        with self.assertRaisesRegex(ValueError, "No supported embedded"):
            find_restart_archive(make_u8({"other": b"test"}))
