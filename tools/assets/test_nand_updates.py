"""Selected NAND updates preserve older imports until a title is explicitly chosen."""

import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest

from nand_import import iter_nand_candidates, plan_nand
from test_wad import TITLE, channel_fixture, make_wad
from wad import parse_wad


def write_channel(nand, title, *, version=1, name="Synthetic Channel"):
    content = nand / "title" / title[:8] / title[8:] / "content"
    content.mkdir(parents=True, exist_ok=True)
    banner = bytearray(channel_fixture())
    title_offset = banner.index(b"IMET") + 28 + 84
    banner[title_offset:title_offset + 42] = name.encode("utf-16-be").ljust(42, b"\0")
    banner = bytes(banner)
    _, sections, _ = parse_wad(make_wad([(7, banner)], title=bytes.fromhex(title)))
    tmd = bytearray(sections["tmd"])
    struct.pack_into(">H", tmd, 0x1DC, version)
    (content / "title.tmd").write_bytes(tmd)
    (content / "0000002a.app").write_bytes(banner)
    return hashlib.sha256(banner).hexdigest()


def run_prepare(root, *arguments):
    return subprocess.run(
        [sys.executable, str(Path(__file__).with_name("prepare.py")), *arguments,
         "--local-dir", str(root / "local"), "--output", str(root / "assets")],
        capture_output=True,
        text=True,
    )


class NandUpdateTests(unittest.TestCase):
    def test_plan_has_one_json_object_and_requires_no_menu_assets(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            nand = root / "nand"
            digest = write_channel(nand, TITLE.hex(), version=3)
            tmd = nand / "title" / TITLE.hex()[:8] / TITLE.hex()[8:] / "content/title.tmd"
            tmd_digest = hashlib.sha256(tmd.read_bytes()).hexdigest()
            result = run_prepare(root, "plan", "--nand", str(nand))
            self.assertEqual(result.returncode, 0, result.stderr)
            plan = json.loads(result.stdout)
            self.assertEqual(plan, {"rows": [{
                "id": TITLE.hex(),
                "title": "Synthetic Channel",
                "installed": False,
                "existingSha256": None,
                "incomingSha256": digest,
                "existingTmdSha256": None,
                "incomingTmdSha256": tmd_digest,
                "existingVersion": None,
                "incomingVersion": 3,
                "change": "new",
            }]})
            self.assertNotIn(str(root), result.stdout)
            self.assertFalse((root / "local/prepare.json").exists())

    def test_default_keep_explicit_replace_and_stale_plan_rejection(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "assets").mkdir()
            (root / "assets/manifest.json").write_text("{}\n")
            old_nand, new_nand = root / "old", root / "new"
            old_digest = write_channel(old_nand, TITLE.hex(), version=1)
            new_digest = write_channel(
                new_nand, TITLE.hex(), version=2, name="Updated Channel"
            )
            initial = run_prepare(root, "add", "--nand", str(old_nand))
            self.assertEqual(initial.returncode, 0, initial.stderr)

            plan_result = run_prepare(root, "plan", "--nand", str(new_nand))
            self.assertEqual(plan_result.returncode, 0, plan_result.stderr)
            plan = json.loads(plan_result.stdout)
            self.assertEqual(plan["rows"][0]["change"], "different")
            self.assertEqual(plan["rows"][0]["existingSha256"], old_digest)
            self.assertEqual(plan["rows"][0]["incomingSha256"], new_digest)
            self.assertEqual(plan["rows"][0]["existingVersion"], 1)
            self.assertEqual(plan["rows"][0]["incomingVersion"], 2)
            self.assertNotEqual(
                plan["rows"][0]["existingTmdSha256"],
                plan["rows"][0]["incomingTmdSha256"],
            )

            kept = run_prepare(root, "add", "--nand", str(new_nand))
            self.assertEqual(kept.returncode, 0, kept.stderr)
            state = json.loads((root / "local/prepare.json").read_text())
            self.assertEqual(state["channels"][TITLE.hex()]["sha256"], old_digest)

            expected = root / "expected.json"
            expected.write_text(plan_result.stdout)
            tmd = new_nand / "title" / TITLE.hex()[:8] / TITLE.hex()[8:] / "content/title.tmd"
            changed_tmd = bytearray(tmd.read_bytes())
            struct.pack_into(">H", changed_tmd, 0x1E0, 8)
            tmd.write_bytes(changed_tmd)
            changed_metadata = run_prepare(
                root, "add", "--nand", str(new_nand),
                "--replace-channel", TITLE.hex(), "--expect-plan", str(expected)
            )
            self.assertNotEqual(changed_metadata.returncode, 0)
            self.assertIn("scan again", changed_metadata.stderr)
            write_channel(new_nand, TITLE.hex(), version=3, name="Updated Channel")
            changed_source = run_prepare(
                root, "add", "--nand", str(new_nand),
                "--replace-channel", TITLE.hex(), "--expect-plan", str(expected)
            )
            self.assertNotEqual(changed_source.returncode, 0)
            self.assertIn("scan again", changed_source.stderr)
            unchanged = json.loads((root / "local/prepare.json").read_text())
            self.assertEqual(unchanged["channels"][TITLE.hex()]["sha256"], old_digest)
            write_channel(new_nand, TITLE.hex(), version=2, name="Updated Channel")
            replaced = run_prepare(
                root, "add", "--nand", str(new_nand),
                "--replace-channel", TITLE.hex().upper(), "--expect-plan", str(expected)
            )
            self.assertEqual(replaced.returncode, 0, replaced.stderr)
            state = json.loads((root / "local/prepare.json").read_text())
            self.assertEqual(state["channels"][TITLE.hex()]["sha256"], new_digest)
            catalog = json.loads((root / "assets/channels.json").read_text())
            self.assertEqual(catalog["channels"][0]["title"], "Updated Channel")
            before = (root / "local/prepare.json").read_bytes()
            stale = run_prepare(
                root, "add", "--nand", str(old_nand),
                "--replace-channel", TITLE.hex(), "--expect-plan", str(expected)
            )
            self.assertNotEqual(stale.returncode, 0)
            self.assertIn("scan again", stale.stderr)
            self.assertEqual((root / "local/prepare.json").read_bytes(), before)

    def test_keep_can_skip_new_and_override_bulk_replace(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "assets").mkdir()
            (root / "assets/manifest.json").write_text("{}\n")
            first = root / "first"
            second = root / "second"
            other = "000100014e455732"
            old_digest = write_channel(first, TITLE.hex(), version=1)
            write_channel(second, TITLE.hex(), version=2, name="Updated Channel")
            write_channel(second, other, version=1, name="Another Channel")
            self.assertEqual(run_prepare(root, "add", "--nand", str(first)).returncode, 0)
            result = run_prepare(
                root, "add", "--nand", str(second), "--nand-policy", "replace",
                "--keep-channel", TITLE.hex(), "--keep-channel", other
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            state = json.loads((root / "local/prepare.json").read_text())
            self.assertEqual(state["channels"][TITLE.hex()]["sha256"], old_digest)
            self.assertNotIn(other, state["channels"])
            invalid = run_prepare(
                root, "add", "--nand", str(second),
                "--replace-channel", TITLE.hex(), "--keep-channel", TITLE.hex()
            )
            self.assertNotEqual(invalid.returncode, 0)
            self.assertIn("both kept and replaced", invalid.stderr)

    def test_removed_titles_are_visible_in_plan_and_require_explicit_selection(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            nand = root / "nand"
            digest = write_channel(nand, TITLE.hex())
            state = {"channels": {}, "removedChannels": [TITLE.hex()], "language": "ENG"}
            candidates = list(iter_nand_candidates(nand))
            self.assertEqual(plan_nand(nand, state, candidates)["rows"][0]["change"], "removed")
            local, assets = root / "local", root / "assets"
            local.mkdir()
            assets.mkdir()
            (local / "prepare.json").write_text(json.dumps(state))
            (assets / "manifest.json").write_text("{}\n")
            default = run_prepare(root, "add", "--nand", str(nand), "--nand-policy", "replace")
            self.assertEqual(default.returncode, 0, default.stderr)
            retained = json.loads((local / "prepare.json").read_text())
            self.assertNotIn(TITLE.hex(), retained["channels"])
            self.assertEqual(retained["removedChannels"], [TITLE.hex()])
            selected = run_prepare(
                root, "add", "--nand", str(nand), "--replace-channel", TITLE.hex()
            )
            self.assertEqual(selected.returncode, 0, selected.stderr)
            restored = json.loads((local / "prepare.json").read_text())
            self.assertEqual(restored["channels"][TITLE.hex()]["sha256"], digest)
            self.assertEqual(restored["removedChannels"], [])

    def test_same_banner_and_version_still_detects_changed_tmd(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            old_nand, new_nand = root / "old", root / "new"
            old_digest = write_channel(old_nand, TITLE.hex(), version=1)
            self.assertEqual(write_channel(new_nand, TITLE.hex(), version=1), old_digest)
            tmd = new_nand / "title" / TITLE.hex()[:8] / TITLE.hex()[8:] / "content/title.tmd"
            changed = bytearray(tmd.read_bytes())
            struct.pack_into(">H", changed, 0x1E0, 8)
            tmd.write_bytes(changed)
            old_content = old_nand / "title" / TITLE.hex()[:8] / TITLE.hex()[8:] / "content"
            state = {"channels": {TITLE.hex(): {"contentDirectory": str(old_content)}},
                     "removedChannels": [], "language": "ENG"}
            row = plan_nand(new_nand, state)["rows"][0]
            self.assertEqual(row["existingSha256"], row["incomingSha256"])
            self.assertEqual(row["existingVersion"], row["incomingVersion"])
            self.assertNotEqual(row["existingTmdSha256"], row["incomingTmdSha256"])
            self.assertEqual(row["change"], "different")

    def test_channels_command_forwards_nand_plan(self):
        node = shutil.which("node")
        if node is None:
            self.skipTest("Node.js is unavailable")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            nand = root / "nand"
            digest = write_channel(nand, TITLE.hex())
            other = "000100014e455732"
            write_channel(nand, other, name="Another Channel")
            command = Path(__file__).resolve().parents[1] / "channels.mjs"
            result = subprocess.run(
                [node, str(command), "nand-plan", str(nand), "--local-dir", str(root / "local"),
                 "--assets", str(root / "assets")],
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            rows = {row["id"]: row for row in json.loads(result.stdout)["rows"]}
            self.assertEqual(rows[TITLE.hex()]["incomingSha256"], digest)
            (root / "assets").mkdir()
            (root / "assets/manifest.json").write_text("{}\n")
            imported = subprocess.run(
                [node, str(command), "nand-import", str(nand), "--keep-channel", TITLE.hex(),
                 "--keep-channel", other, "--local-dir", str(root / "local"),
                 "--assets", str(root / "assets")],
                capture_output=True,
                text=True,
            )
            self.assertEqual(imported.returncode, 0, imported.stderr)
            state = json.loads((root / "local/prepare.json").read_text())
            self.assertEqual(state["channels"], {})


if __name__ == "__main__":
    unittest.main()
