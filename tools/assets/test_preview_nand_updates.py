import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from preview_nand_updates import stage_active_channels
from test_nand_updates import write_channel
from test_wad import TITLE


class PreviewNandUpdatesTests(unittest.TestCase):
    def test_scan_exports_real_icon_and_banner_layouts_with_one_public_plan(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            nand = root / "nand"
            digest = write_channel(nand, TITLE.hex(), version=2)
            local = root / "local"
            local.mkdir()
            assets = root / "assets"
            assets.mkdir()
            preview = assets / "channel-updates" / "staging"
            result = subprocess.run(
                [sys.executable, str(Path(__file__).with_name("preview_nand_updates.py")),
                 "--nand", str(nand), "--output", str(preview),
                 "--scratch", str(local), "--assets", str(assets)],
                capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            plan = json.loads(result.stdout)
            self.assertEqual(plan["rows"][0]["incomingSha256"], digest)
            self.assertNotIn(str(root), result.stdout)
            catalog = json.loads((preview / "channels.json").read_text())
            channel = catalog["channels"][0]
            self.assertEqual(channel["source"]["sha256"], digest)
            for kind in ("icon", "banner"):
                self.assertTrue((preview / channel[f"{kind}Layout"]).is_file())

    def test_preview_copies_only_the_selected_banner_and_metadata(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            title = "0001000148414241"
            source = root / "nand" / "title" / title[:8] / title[8:] / "content"
            source.mkdir(parents=True)
            banner = source / "00000001.app"
            banner.write_bytes(b"synthetic active banner")
            (source / "00000002.app").write_bytes(b"private unrelated content")
            (source / "title.tmd").write_bytes(b"synthetic TMD")
            candidate = {
                "id": title,
                "banner": banner,
                "sha256": hashlib.sha256(banner.read_bytes()).hexdigest(),
                "tmdSha256": hashlib.sha256((source / "title.tmd").read_bytes()).hexdigest(),
            }

            def inspect_export(nand, output, language):
                selected = nand / "title" / title[:8] / title[8:] / "content"
                self.assertEqual(sorted(path.name for path in selected.iterdir()),
                                 ["00000001.app", "title.tmd"])
                self.assertEqual((selected / "00000001.app").read_bytes(), banner.read_bytes())
                return {"channels": []}

            with patch("preview_nand_updates.export_channels", side_effect=inspect_export):
                stage_active_channels(root / "nand", root / "preview", root, [candidate])

    def test_preview_rejects_source_change_before_export(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "nand" / "title" / "00010001" / "48414241" / "content"
            source.mkdir(parents=True)
            banner = source / "00000001.app"
            banner.write_bytes(b"new data")
            candidate = {"id": "0001000148414241", "banner": banner,
                         "sha256": "0" * 64, "tmdSha256": None}
            with self.assertRaisesRegex(ValueError, "changed during preview"):
                stage_active_channels(root / "nand", root / "preview", root, [candidate])


if __name__ == "__main__":
    unittest.main()
