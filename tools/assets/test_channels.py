"""Synthetic RIPL save tests; source saves remain local and unchanged."""

import hashlib
import struct
import unittest

from channels_export import read_saved_layout


def save_fixture():
    data = bytearray(0x4C0)
    data[:16] = b"RIPL" + struct.pack(">III", len(data), 3, 2)
    data[0x10:0x20] = struct.pack(">BBHIII", 1, 1, 0, 15, 0, 0)
    # A channel on page 2 proves the reader preserves gaps, not just list order.
    data[0xE0:0xF0] = struct.pack(">BBHIII", 3, 0, 0, 14, 0x10002, 0x48414341)
    data[-16:] = hashlib.md5(data[:-16]).digest()
    return data


class PlacementTests(unittest.TestCase):
    def test_original_slot_positions_and_disc_are_retained(self):
        parsed = read_saved_layout(save_fixture())
        self.assertEqual(parsed["previousPage"], 2)
        self.assertEqual(len(parsed["slots"]), 48)
        self.assertEqual(parsed["slots"][0]["id"], "disc")
        self.assertIsNone(parsed["slots"][1]["id"])
        self.assertEqual(parsed["slots"][13]["id"], "0001000248414341")
        self.assertEqual((parsed["slots"][13]["page"], parsed["slots"][13]["index"]), (1, 1))

    def test_modified_save_is_not_used_as_placement_evidence(self):
        data = save_fixture()
        data[0x1F] ^= 1
        with self.assertRaisesRegex(ValueError, "checksum"):
            read_saved_layout(data)


if __name__ == "__main__":
    unittest.main()
