import struct
import unittest

from export_keyboard_dictionary import decode_oem_dictionary, decode_system_header


class KeyboardDictionaryTest(unittest.TestCase):
    def test_oem_offsets_utf16_and_order(self):
        first = "été".encode("utf-16-be") + b"\0\0"
        second = "sample".encode("utf-16-be") + b"\0\0"
        data = struct.pack(">III", 2, 12, 12 + len(first)) + first + second
        self.assertEqual(decode_oem_dictionary(data), ["été", "sample"])

    def test_rejects_invalid_oem_offsets_and_unterminated_words(self):
        for data in (b"", struct.pack(">I", 5), struct.pack(">II", 1, 4),
                     struct.pack(">II", 1, 9) + b"\0\0\0\0",
                     struct.pack(">II", 1, 8) + b"\0A"):
            with self.assertRaises(ValueError):
                decode_oem_dictionary(data)

    def test_system_table_flags_are_not_byte_lengths(self):
        data = bytearray(200)
        data[0] = 59
        data[1] = 128
        data[4:10] = (4).to_bytes(3, "big") + (196).to_bytes(3, "big")
        data[190:193] = (0xFFFFFF).to_bytes(3, "big")
        header = decode_system_header(data)
        self.assertEqual(header["languageId"], 59)
        self.assertEqual(header["tables"][0]["offset"], 196)
        self.assertEqual(header["tables"][31]["countOrFlags"], 0xFFFFFF)
        data[7:10] = (200).to_bytes(3, "big")
        with self.assertRaises(ValueError):
            decode_system_header(data)


if __name__ == "__main__":
    unittest.main()
