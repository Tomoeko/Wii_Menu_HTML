"""Synthetic NAND fixtures exercise corruption and extraction without private data."""

import hashlib
import hmac
import json
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest

from aes import AesCbc
from nand import (
    CLUSTER_SIZE, DUMP_SIZE, FIRST_SUPERBLOCK, NandReader,
    PAGE_STRIDE, extract_nand, parse_entries,
)
from nand_import import active_banners, import_nand
from test_wad import channel_fixture, make_wad
from wad import parse_wad

AES_KEY = bytes(range(16))
HMAC_KEY = bytes(range(20))


def make_superblock(payload=b"synthetic file"):
    block = bytearray(0x40000)
    struct.pack_into(">4sII", block, 0, b"SFFS", 1, 16)
    for cluster in range(0x8000):
        struct.pack_into(">H", block, 12 + cluster * 2, 0xFFFE)
    struct.pack_into(">H", block, 12 + 0x40 * 2, 0xFFFB)
    struct.pack_into(">12sBBHHIIHI", block, 0x1000C,
                     b"/", 2, 0, 1, 0xFFFF, 0, 0, 0, 0)
    struct.pack_into(">12sBBHHIIHI", block, 0x1000C + 32,
                     b"test.bin", 1, 0, 0x40, 0xFFFF, len(payload), 5, 0, 0)
    return block


def write_cluster(stream, number, data, digest=None):
    raw = bytearray()
    for page in range(8):
        raw.extend(data[page * 0x800 : (page + 1) * 0x800])
        spare = bytearray(b"\xff" * 64)
        if digest is not None and page == 6:
            spare[1:21] = digest
            spare[21:33] = digest[:12]
        if digest is not None and page == 7:
            spare[1:9] = digest[12:]
        raw.extend(spare)
    stream.seek(number * 8 * PAGE_STRIDE)
    stream.write(raw)


def make_dump(root, *, footer=False, payload=b"synthetic file"):
    source = root / "nand.bin"
    keys = bytearray(1024)
    keys[0x144:0x158] = HMAC_KEY
    keys[0x158:0x168] = AES_KEY
    block = make_superblock(payload)
    plaintext = payload.ljust(CLUSTER_SIZE, b"\0")
    salt = struct.pack(">I12sIII", 5, b"test.bin", 0, 1, 0) + bytes(36)
    digest = hmac.digest(HMAC_KEY, salt + plaintext, "sha1")
    with AesCbc() as context:
        encrypted = context.crypt(plaintext, AES_KEY, bytes(16), decrypt=False)
    metadata_salt = bytes(16) + struct.pack(">I", FIRST_SUPERBLOCK) + bytes(44)
    metadata_digest = hmac.digest(HMAC_KEY, metadata_salt + block, "sha1")
    with source.open("wb") as stream:
        stream.truncate(DUMP_SIZE)
        write_cluster(stream, 0x40, encrypted, digest)
        for ordinal in range(16):
            write_cluster(stream, FIRST_SUPERBLOCK + ordinal,
                          block[ordinal * CLUSTER_SIZE : (ordinal + 1) * CLUSTER_SIZE],
                          metadata_digest if ordinal == 15 else None)
        if footer:
            stream.seek(DUMP_SIZE)
            stream.write(keys)
    if not footer:
        (root / "keys.bin").write_bytes(keys)
    return source


class NandTests(unittest.TestCase):
    def test_aes_nist_cbc_vector_and_chunk_boundaries(self):
        key = bytes.fromhex("2b7e151628aed2a6abf7158809cf4f3c")
        iv = bytes(range(16))
        plain = bytes.fromhex("6bc1bee22e409f96e93d7e117393172a")
        encrypted = bytes.fromhex("7649abac8119b246cee98e9b12e9197d")
        with AesCbc() as context:
            self.assertEqual(context.crypt(encrypted, key, iv), plain)
            self.assertEqual(context.crypt(plain, key, iv, decrypt=False), encrypted)
            large = plain * 65537
            encoded = context.crypt(large, key, iv, decrypt=False)
            self.assertEqual(context.crypt(encoded, key, iv), large)

    def test_separate_keys_and_embedded_footer_extract_without_copying_keys(self):
        for footer in (False, True):
            with self.subTest(footer=footer), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                source = make_dump(root, footer=footer)
                destination = root / "extracted"
                self.assertEqual(extract_nand(source, destination), 1)
                self.assertEqual((destination / "test.bin").read_bytes(), b"synthetic file")
                self.assertFalse((destination / "keys.bin").exists())
                self.assertEqual(list(root.glob(".nand-extract-*")), [])

    def test_wrong_keys_or_damaged_ciphertext_never_publish_partial_files(self):
        for wrong_keys in (False, True):
            with self.subTest(wrong_keys=wrong_keys), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                source = make_dump(root)
                if wrong_keys:
                    (root / "keys.bin").write_bytes(bytes(1024))
                else:
                    with source.open("r+b") as stream:
                        stream.seek(0x40 * 8 * PAGE_STRIDE)
                        stream.write(b"\0" * 16)
                with self.assertRaisesRegex(ValueError, "HMAC mismatch"):
                    extract_nand(source, root / "extracted")
                self.assertFalse((root / "extracted").exists())
                self.assertEqual(list(root.glob(".nand-extract-*")), [])

    def test_existing_destination_is_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            destination = root / "extracted"
            destination.mkdir()
            (destination / "keep").write_text("existing data")
            with self.assertRaisesRegex(ValueError, "already exist"):
                extract_nand(root / "missing.bin", destination)
            self.assertEqual((destination / "keep").read_text(), "existing data")

    def test_unsafe_names_cycles_truncated_chains_and_oversized_nodes_fail(self):
        for kind in ("path", "cycle", "chain", "node"):
            with self.subTest(kind=kind):
                block = make_superblock()
                if kind == "path":
                    block[0x1002C:0x10038] = b"../escape\0\0\0"
                elif kind == "cycle":
                    struct.pack_into(">H", block, 0x1002C + 16, 1)
                elif kind == "chain":
                    struct.pack_into(">I", block, 0x1002C + 18, CLUSTER_SIZE + 1)
                else:
                    struct.pack_into(">H", block, 0x1000C + 14, 0x1800)
                with self.assertRaises(ValueError):
                    parse_entries(block)

    def test_unsupported_size_is_rejected_before_key_read(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "nand.bin"
            source.write_bytes(b"not a NAND")
            with self.assertRaisesRegex(ValueError, "512 MiB"):
                with NandReader(source):
                    self.fail("Invalid dump was accepted")


class NandImportTests(unittest.TestCase):
    def test_multi_input_import_is_additive_deduplicated_and_independent_of_sources(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            local, output = root / "local", root / "assets"
            output.mkdir()
            (output / "manifest.json").write_text("{}")
            first, second = root / "first", root / "second"
            titles = ["0001000154455354", "000100014e455732"]
            for directory, title in ((first, titles[0]), (second, titles[0]), (second, titles[1])):
                content = directory / "title" / title[:8] / title[8:] / "content"
                content.mkdir(parents=True)
                (content / "00000001.app").write_bytes(channel_fixture())
            command = [sys.executable, str(Path(__file__).with_name("prepare.py")), "add",
                       "--nand", str(first), "--nand", str(second), "--nand", str(first),
                       "--local-dir", str(local), "--output", str(output)]
            for iteration in range(2):
                result = subprocess.run(command, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                state = json.loads((local / "prepare.json").read_text())
                self.assertEqual(set(state["channels"]), set(titles))
                catalog = json.loads((output / "channels.json").read_text())
                self.assertEqual(set(catalog["defaultOrder"]), set(titles))
                self.assertEqual(len(catalog["channels"]), 2)
            shutil.rmtree(first)
            shutil.rmtree(second)
            for descriptor in state["channels"].values():
                self.assertTrue(Path(descriptor["contentDirectory"]).is_dir())
            self.assertEqual(list(local.glob(".prepare*")), [])
            self.assertEqual(list(root.glob(".prepare-assets-*")), [])

    def test_tmd_selects_active_banner_and_checks_its_hash(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            title = "0001000154455354"
            payload = channel_fixture()
            _, sections, _ = parse_wad(make_wad([(7, payload)]))
            (root / "title.tmd").write_bytes(sections["tmd"])
            (root / "0000002a.app").write_bytes(payload)
            (root / "000000ff.app").write_bytes(payload)
            self.assertEqual([path.name for path in active_banners(root, root, title)],
                             ["0000002a.app"])
            (root / "0000002a.app").write_bytes(payload + b"changed")
            with self.assertRaisesRegex(ValueError, "TMD content hash"):
                active_banners(root, root, title)

    def test_removed_titles_stay_removed_and_existing_imports_win(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            title = "0001000154455354"
            source = root / "source"
            content = source / "title" / title[:8] / title[8:] / "content"
            content.mkdir(parents=True)
            (content / "00000001.app").write_bytes(channel_fixture())
            local = root / "local"
            local.mkdir()
            state = {"channels": {}, "removedChannels": [title]}
            self.assertEqual(import_nand(source, state, local), 0)
            state = {"channels": {title: {"kind": "wad"}}, "removedChannels": []}
            self.assertEqual(import_nand(source, state, local), 0)
            self.assertEqual(state["channels"][title], {"kind": "wad"})

if __name__ == "__main__":
    unittest.main()
