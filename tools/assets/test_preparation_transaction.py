"""Process-exit fixtures validate generation recovery without private resources."""

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from preparation_transaction import (
    JOURNAL_NAME, preparation_workspace, publish_preparation, recover_preparation,
)


TITLE = "0001000154455354"
NEW_TITLE = "000100014e455731"
TOOLS = Path(__file__).resolve().parent
CHILD = '''
import json
import os
from pathlib import Path
import sys
from preparation_transaction import preparation_workspace, publish_preparation, recover_preparation

local, output = Path(sys.argv[1]), Path(sys.argv[2])
failure, recovery = sys.argv[3:5]
def checkpoint(name):
    if name == failure:
        os._exit(73)
if recovery == "recover":
    recover_preparation(local, output, checkpoint=checkpoint)
else:
    with preparation_workspace(local, output, checkpoint=checkpoint) as (staged, assets):
        for category, title in (("titles", "0001000154455354"),
                                ("nand-titles", "000100014e455731")):
            content = staged / category / title
            content.mkdir(parents=True)
            (content / "content.app").write_text("new")
        (staged / "nand-layout.bin").write_bytes(b"new-layout")
        (staged / "IplSound.brsar").write_bytes(b"new-sound")
        (assets / "catalog.json").write_text("new")
        state = {"generation": "new", "channels": {}, "removedChannels": [],
                 "language": "ENG", "menu": {"contentDirectory": str(staged / "titles" /
                 "0001000154455354")}}
        publish_preparation(staged, local, assets, output, state, checkpoint=checkpoint)
'''


class PreparationTransactionTests(unittest.TestCase):
    def fixture(self, root):
        local, output = root / "local", root / "assets"
        content = local / "titles" / TITLE
        content.mkdir(parents=True)
        (content / "content.app").write_text("old")
        (local / "prepare.json").write_text(json.dumps({
            "generation": "old", "language": "ENG", "channels": {}, "removedChannels": [],
        }) + "\n")
        (local / "nand-layout.bin").write_bytes(b"old-layout")
        (local / "IplSound.brsar").write_bytes(b"old-sound")
        (local / "channel-layout.json").write_bytes(b"original-user-placements")
        (local / "config.json").write_bytes(b"original-user-configuration")
        output.mkdir()
        (output / "catalog.json").write_text("old")
        (output / "unrelated.txt").write_text("retained")
        return local, output

    def child(self, local, output, failure="", *, recovery=False):
        result = subprocess.run(
            [sys.executable, "-c", CHILD, str(local), str(output), failure,
             "recover" if recovery else "publish"],
            cwd=TOOLS, capture_output=True, text=True, timeout=20,
        )
        self.assertEqual(result.returncode, 73 if failure else 0, result.stderr)

    def assert_generation(self, local, output, generation):
        self.assertEqual((local / "titles" / TITLE / "content.app").read_text(), generation)
        self.assertEqual((output / "catalog.json").read_text(), generation)
        self.assertEqual(json.loads((local / "prepare.json").read_text())["generation"], generation)
        self.assertEqual((local / "nand-layout.bin").read_bytes(), (generation + "-layout").encode())
        self.assertEqual((local / "IplSound.brsar").read_bytes(), (generation + "-sound").encode())
        self.assertEqual((local / "nand-titles" / NEW_TITLE).exists(), generation == "new")
        self.assertEqual((local / "channel-layout.json").read_bytes(), b"original-user-placements")
        self.assertEqual((local / "config.json").read_bytes(), b"original-user-configuration")
        self.assertEqual((output / "unrelated.txt").read_text(), "retained")

    def assert_clean(self, local, output):
        self.assertEqual(list(local.glob(".prepare*")), [])
        self.assertEqual(list(output.parent.glob(".prepare-assets-*")), [])

    def test_process_death_before_commit_restores_every_previous_generation_then_retries(self):
        boundaries = [
            "workspace-recorded", "workspace-ready", "publication-recorded",
            "backup-titles", "installed-titles", "installed-nand-titles",
            "installed-layout", "installed-sound", "backup-assets", "installed-assets",
            "backup-state", "installed-state",
        ]
        for boundary in boundaries:
            with self.subTest(boundary=boundary), tempfile.TemporaryDirectory() as temporary:
                local, output = self.fixture(Path(temporary).resolve())
                self.child(local, output, boundary)
                self.child(local, output, recovery=True)
                self.assert_generation(local, output, "old")
                self.assert_clean(local, output)
                self.child(local, output)
                self.assert_generation(local, output, "new")
                self.assert_clean(local, output)
                state = json.loads((local / "prepare.json").read_text())
                self.assertEqual(state["menu"]["contentDirectory"], str(local / "titles" / TITLE))

    def test_committed_generation_survives_death_and_cleanup_is_restartable(self):
        for boundary in ("committed", "scratch-removed"):
            with self.subTest(boundary=boundary), tempfile.TemporaryDirectory() as temporary:
                local, output = self.fixture(Path(temporary).resolve())
                self.child(local, output, boundary)
                self.child(local, output, recovery=True)
                self.assert_generation(local, output, "new")
                self.assert_clean(local, output)

    def test_first_install_interruption_restores_absent_destinations(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            local, output = root / "local", root / "assets"
            self.child(local, output, "installed-state")
            self.child(local, output, recovery=True)
            self.assertFalse(output.exists())
            self.assertFalse((local / "prepare.json").exists())
            self.assertFalse((local / "titles" / TITLE).exists())
            self.assertFalse((local / "nand-titles" / NEW_TITLE).exists())
            self.assertFalse((local / "nand-layout.bin").exists())
            self.assertFalse((local / "IplSound.brsar").exists())
            self.assert_clean(local, output)
            self.child(local, output)
            self.assertEqual((output / "catalog.json").read_text(), "new")
            self.assert_clean(local, output)

    def test_recovery_itself_can_be_interrupted_and_resumed(self):
        with tempfile.TemporaryDirectory() as temporary:
            local, output = self.fixture(Path(temporary).resolve())
            self.child(local, output, "installed-state")
            self.child(local, output, "recovered-assets", recovery=True)
            self.child(local, output, recovery=True)
            self.assert_generation(local, output, "old")
            self.assert_clean(local, output)

    def test_handled_publish_failure_restores_original_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            local, output = self.fixture(Path(temporary).resolve())
            previous_state = (local / "prepare.json").read_bytes()
            with self.assertRaisesRegex(OSError, "Synthetic publication failure"):
                with preparation_workspace(local, output) as (staged, assets):
                    (assets / "catalog.json").write_text("new")
                    original = Path.rename

                    def fail_state(path, destination):
                        if path == staged / "prepare.json":
                            raise OSError("Synthetic publication failure")
                        return original(path, destination)

                    with patch.object(Path, "rename", fail_state):
                        publish_preparation(staged, local, assets, output, {"generation": "new"})
            self.assertEqual((local / "prepare.json").read_bytes(), previous_state)
            self.assert_generation(local, output, "old")
            self.assert_clean(local, output)

    def test_active_preparation_and_foreign_directory_locks_are_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            local, output = self.fixture(Path(temporary).resolve())
            with preparation_workspace(local, output):
                result = subprocess.run(
                    [sys.executable, "-c", CHILD, str(local), str(output), "", "recover"],
                    cwd=TOOLS, capture_output=True, text=True, timeout=20,
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Another preparation", result.stderr)
                self.assertTrue((local / JOURNAL_NAME).exists())
            lock = local / ".prepare-lock"
            lock.mkdir()
            (lock / "custom-owner.json").write_text('{"pid":1}')
            with self.assertRaisesRegex(ValueError, "Another local operation"):
                recover_preparation(local, output)
            self.assertTrue((lock / "custom-owner.json").exists())

    def test_empty_dead_lock_and_unpublished_journal_write_are_cleaned(self):
        with tempfile.TemporaryDirectory() as temporary:
            local, output = self.fixture(Path(temporary).resolve())
            (local / ".prepare-lock").write_bytes(b"")
            (local / (JOURNAL_NAME + ".next")).write_bytes(b"interrupted write")
            recover_preparation(local, output)
            self.assert_generation(local, output, "old")
            self.assert_clean(local, output)

    def test_invalid_journal_or_changed_output_never_deletes_resources(self):
        for kind in ("title", "output", "symlink", "missing-role"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary).resolve()
                local, output = self.fixture(root)
                self.child(local, output, "publication-recorded")
                journal = local / JOURNAL_NAME
                plan = json.loads(journal.read_text())
                target = output
                if kind == "title":
                    plan["replacements"][0]["name"] = "../../unrelated"
                    journal.write_text(json.dumps(plan))
                elif kind == "output":
                    target = root / "different-assets"
                elif kind == "missing-role":
                    plan["replacements"].pop()
                    journal.write_text(json.dumps(plan))
                else:
                    staged = local / (".prepare-" + plan["token"])
                    (staged / "previous").rename(staged / "saved-previous")
                    (staged / "previous").symlink_to(root, target_is_directory=True)
                with self.assertRaises(ValueError):
                    recover_preparation(local, target)
                self.assert_generation(local, output, "old")
                self.assertTrue(journal.exists())
                self.assertTrue((local / ".prepare-lock").is_file())

    def test_list_operation_recovers_before_reading_state(self):
        with tempfile.TemporaryDirectory() as temporary:
            local, output = self.fixture(Path(temporary).resolve())
            self.child(local, output, "backup-state")
            result = subprocess.run(
                [sys.executable, str(TOOLS / "prepare.py"), "list", "--local-dir", str(local),
                 "--output", str(output)],
                cwd=TOOLS, capture_output=True, text=True, timeout=20,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assert_generation(local, output, "old")
            self.assert_clean(local, output)


if __name__ == "__main__":
    unittest.main()
