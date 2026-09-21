"""Synthetic title allocation and metadata compatibility regressions."""

import hashlib
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest import mock

from channel_storage import nand_storage, validate_storage, wad_storage
from channels_export import read_metadata
from nand_import import active_banners, import_nand, nand_directory
from prepare import export_catalog, import_wad, upgrade_storage_metadata
from test_wad import KEY, TITLE, channel_fixture, make_wad
from wad import parse_wad


def write_nand(root, *, shared=False, extra=True):
    title = TITLE.hex()
    directory = root / "title" / title[:8] / title[8:] / "content"
    directory.mkdir(parents=True)
    banner = channel_fixture()
    program = bytes(0x1c001)
    metadata, sections, _ = parse_wad(make_wad([(7, banner), (9, program)]))
    tmd = bytearray(sections["tmd"])
    if shared:
        struct.pack_into(">H", tmd, 0x1e4 + 36 + 6, 0x8001)
    else:
        (directory / "0000002b.app").write_bytes(program)
    (directory / "title.tmd").write_bytes(tmd)
    (directory / "0000002a.app").write_bytes(banner)
    if extra:
        # NANDSecretGetUsage includes stale content and nested regular files,
        # independently of the current TMD content list.
        (directory / "retained").mkdir()
        (directory / "retained/old.app").write_bytes(bytes(0x4001))
        meta = root / "meta" / title[:8] / title[8:]
        meta.mkdir(parents=True)
        (meta / "title.met").write_bytes(bytes(0x4001))
    data = directory.parent / "data"
    data.mkdir()
    (data / "private-save.bin").write_bytes(bytes(0x40001))
    return directory, metadata, bytes(tmd)


class ChannelStorageTests(unittest.TestCase):
    def test_nand_counts_cluster_rounding_stale_contents_and_meta_but_not_save_data(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            directory, _, tmd = write_nand(root)
            storage = nand_storage(directory, root, TITLE.hex())
            # Banner1 + program8 + TMD1 + stale2 + meta2 =14 clusters,2 blocks.
            self.assertEqual(storage["allocatedClusters"], 14)
            self.assertEqual(storage["blocks"], 2)
            self.assertEqual(storage["contentFileCount"], 4)
            self.assertEqual(storage["metaBytes"], 0x4001)
            self.assertEqual(storage["tmdSha256"], hashlib.sha256(tmd).hexdigest())
            self.assertNotIn(str(root), json.dumps(storage))
            self.assertNotIn("private-save", json.dumps(storage))

    def test_verified_zero_padding_counts_actual_allocation_and_preserves_banner_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            directory, _, _ = write_nand(root, shared=True, extra=False)
            banner = directory / "0000002a.app"
            payload = banner.read_bytes()
            padded = payload.ljust(0x20001, b"\0")
            banner.write_bytes(padded)
            storage = nand_storage(directory, root, TITLE.hex())
            self.assertEqual(storage["paddedContentCount"], 1)
            self.assertEqual(storage["allocatedClusters"], 10)
            self.assertEqual(storage["blocks"], 2)
            self.assertEqual(active_banners(directory, root, TITLE.hex()), [banner])
            local = root / "managed"
            local.mkdir()
            state = {"channels": {}, "removedChannels": []}
            import_nand(root, state, local)
            retained = Path(state["channels"][TITLE.hex()]["contentDirectory"]) / banner.name
            self.assertEqual(retained.read_bytes(), padded)
            for damaged in (payload + b"not zero padding", b"X" + padded[1:]):
                banner.write_bytes(damaged)
                with self.assertRaisesRegex(ValueError, TITLE.hex() + "/0000002a"):
                    nand_storage(directory, root, TITLE.hex())
                with self.assertRaisesRegex(ValueError, "TMD content hash"):
                    active_banners(directory, root, TITLE.hex())

    def test_shared_contents_are_not_counted_in_title_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            directory, _, _ = write_nand(root, shared=True, extra=False)
            shared = root / "shared1"
            shared.mkdir()
            (shared / "00000000.app").write_bytes(bytes(0x40001))
            storage = nand_storage(directory, root, TITLE.hex())
            self.assertEqual(storage["allocatedClusters"], 2)
            self.assertEqual(storage["blocks"], 1)

    def test_wad_predicts_installed_cluster_usage_and_distinguishes_estimate(self):
        metadata, sections, _ = parse_wad(make_wad([(7, bytes(0x1c001))]))
        storage = wad_storage(metadata, sections["tmd"])
        self.assertEqual(storage["method"], "wad-install-estimate")
        self.assertEqual(storage["allocatedClusters"], 9)
        self.assertEqual(storage["blocks"], 2)  # Not ceil(payload bytes /128KiB).
        metadata["contents"][0]["type"] |= 0x8000
        self.assertEqual(wad_storage(metadata, sections["tmd"])["allocatedClusters"], 1)

    def test_incomplete_source_never_becomes_banner_size_and_bad_accounting_fails(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            directory, _, _ = write_nand(root)
            (directory / "0000002b.app").unlink()
            self.assertIsNone(nand_storage(directory, root, TITLE.hex()))
        with self.assertRaisesRegex(ValueError, "storage"):
            validate_storage({"version": 1, "method": "invented"})
        metadata, sections, _ = parse_wad(make_wad([(7, b"x")]))
        storage = wad_storage(metadata, sections["tmd"])
        storage["blocks"] += 1
        with self.assertRaisesRegex(ValueError, "Inconsistent"):
            validate_storage(storage)

    def test_accounting_rejects_external_symlink_without_reading_it(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            directory, _, _ = write_nand(root)
            (directory / "foreign").symlink_to(root.parent, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, "symlinks"):
                nand_storage(directory, root, TITLE.hex())

    def test_full_legacy_sources_upgrade_read_only_and_catalog_retains_count(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, local, output = root / "source", root / "local", root / "assets"
            directory, _, _ = write_nand(source)
            before = {p.relative_to(source): p.read_bytes()
                      for p in source.rglob("*") if p.is_file()}
            local.mkdir()
            output.mkdir()
            state = {"channels": {TITLE.hex(): {
                "kind": "nand", "contentDirectory": str(directory), "extra": "preserved",
            }}, "language": "ENG", "removedChannels": []}
            catalog = export_catalog(local, state, output)
            self.assertEqual(catalog["channels"][0]["blocks"], 2)
            self.assertEqual(state["channels"][TITLE.hex()]["extra"], "preserved")
            self.assertEqual(before, {p.relative_to(source): p.read_bytes()
                                     for p in source.rglob("*") if p.is_file()})
            self.assertNotIn(str(source), json.dumps(catalog))

    def test_import_persists_tmd_and_accounting_after_source_is_unavailable(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, local, output = root / "source", root / "local", root / "assets"
            _, _, tmd = write_nand(source)
            local.mkdir()
            output.mkdir()
            state = {"channels": {}, "removedChannels": [], "language": "ENG"}
            self.assertEqual(import_nand(source, state, local), 1)
            descriptor = state["channels"][TITLE.hex()]
            managed = Path(descriptor["contentDirectory"])
            self.assertEqual((managed / "title.tmd").read_bytes(), tmd)
            self.assertEqual(len(list(managed.glob("*.app"))), 1)
            source.rename(root / "unavailable")
            self.assertEqual(export_catalog(local, state, output)["channels"][0]["blocks"], 2)
            self.assertEqual(descriptor["storage"]["contentFileCount"], 4)

    def test_duplicate_can_fill_missing_accounting_only_for_identical_banner(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, local = root / "source", root / "local"
            write_nand(source)
            local.mkdir()
            state = {"channels": {}, "removedChannels": []}
            import_nand(source, state, local)
            descriptor = state["channels"][TITLE.hex()]
            original = descriptor.pop("storage")
            descriptor["customNote"] = "keep"
            self.assertEqual(import_nand(source, state, local), 0)
            self.assertEqual(descriptor["storage"], original)
            self.assertEqual(descriptor["customNote"], "keep")
            descriptor.pop("storage")
            retained_tmd = Path(descriptor["contentDirectory"]) / "title.tmd"
            original_tmd = retained_tmd.read_bytes()
            changed_tmd = bytearray(original_tmd)
            struct.pack_into(">H", changed_tmd, 0x1dc, 2)
            retained_tmd.write_bytes(changed_tmd)
            self.assertEqual(import_nand(source, state, local), 0)
            self.assertNotIn("storage", descriptor, "same banner does not override a retained version")
            retained_tmd.write_bytes(original_tmd)
            stored = Path(descriptor["contentDirectory"]) / "0000002a.app"
            stored.write_bytes(channel_fixture() + b"different version")
            self.assertEqual(import_nand(source, state, local), 0)
            self.assertNotIn("storage", descriptor)
            self.assertTrue(stored.read_bytes().endswith(b"different version"))

    def test_wad_descriptor_and_legacy_wad_upgrade_keep_original_metadata(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "channel.wad"
            source.write_bytes(make_wad([(7, channel_fixture()), (9, bytes(0x1c001))]))
            title, descriptor = import_wad(source, root, KEY, 0)
            self.assertEqual(descriptor["storage"]["blocks"], 2)
            expected = descriptor.pop("storage")
            before = (Path(descriptor["contentDirectory"]).parent / "import.json").read_bytes()
            upgrade_storage_metadata({"channels": {title: descriptor}})
            self.assertEqual(descriptor["storage"], expected)
            self.assertEqual((Path(descriptor["contentDirectory"]).parent / "import.json").read_bytes(), before)

    def test_catalog_sanitizes_accounting_without_discarding_private_descriptor_fields(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, local, output = root / "source", root / "local", root / "assets"
            directory, _, _ = write_nand(source)
            local.mkdir()
            output.mkdir()
            storage = nand_storage(directory, source, TITLE.hex())
            storage["privateNote"] = str(source)
            state = {"channels": {TITLE.hex(): {
                "kind": "nand", "contentDirectory": str(directory), "storage": storage,
            }}, "language": "ENG", "removedChannels": []}
            catalog = export_catalog(local, state, output)
            self.assertEqual(state["channels"][TITLE.hex()]["storage"]["privateNote"], str(source))
            self.assertNotIn("privateNote", catalog["channels"][0]["storage"])
            self.assertNotIn(str(source), json.dumps(catalog))

    def test_raw_selection_includes_all_content_and_meta_without_private_save_data(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            reader = mock.MagicMock()
            reader.__enter__.return_value = reader
            with mock.patch("nand_import.NandReader", return_value=reader):
                with nand_directory(root / "nand.bin", root):
                    select = reader.extract.call_args.kwargs["select"]
                    for suffix in ("title.tmd", "0000002a.app", "nested/stale.app"):
                        self.assertTrue(select(Path("title/00010001/54455354/content") / suffix))
                    self.assertTrue(select(Path("meta/00010001/54455354/title.met")))
                    self.assertTrue(select(Path("title/00000001/00000002/data/iplsave.bin")))
                    self.assertFalse(select(Path("title/00010001/54455354/data/save.bin")))
                    self.assertFalse(select(Path("shared1/00000001.app")))
                    self.assertFalse(select(Path("ticket/00010001/54455354.tik")))
            self.assertEqual(list(root.glob(".nand-input-*")), [])

    def test_two_imet_title_fields_remain_distinct_without_changing_menu_title(self):
        payload = bytearray(channel_fixture())
        start = 64 + 28 + 84 + 42
        subtitle = "Second line".encode("utf-16-be")
        payload[start:start + len(subtitle)] = subtitle
        metadata = read_metadata(bytes(payload), "ENG")
        self.assertEqual(metadata["titleLines"]["ENG"], ["Synthetic Channel", "Second line"])
        self.assertEqual(metadata["titles"]["ENG"], "Synthetic Channel Second line")
        self.assertEqual(metadata["title"], "Synthetic Channel Second line")
        self.assertEqual(metadata["titleLines"]["JPN"], ["", ""])


if __name__ == "__main__":
    unittest.main()
