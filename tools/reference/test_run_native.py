"""Profile safety regressions for native capture launchers and process inspection."""

import contextlib
import errno
import io
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

from native_processes import (
    NativeProcess,
    decode_macos_arguments,
    matching_profile_process,
    process_working_directory,
    running_emulators,
    user_directory,
)
import run_native


class NativeProfileProcessTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.emulator = self.root / "Reference Build/DolphinQt"
        self.profile = self.root / "User Profiles/Board capture"
        self.profile.mkdir(parents=True)

    def match(self, processes, caller_pid=100):
        return matching_profile_process(processes, self.emulator, self.profile, caller_pid)

    def process(self, arguments, executable=None, pid=200, cwd=None):
        return NativeProcess(pid, executable or self.emulator, tuple(arguments), cwd)

    def test_launcher_and_shell_mentioning_emulator_are_not_emulator_processes(self):
        arguments = (
            "python3", "run_native.py", "--emulator", str(self.emulator),
            "--profile", str(self.profile), "-u", str(self.profile),
        )
        rows = [
            self.process(arguments, Path("/usr/bin/python3")),
            self.process(("sh", "-c", " ".join(arguments)), Path("/bin/sh")),
        ]
        self.assertIsNone(self.match(rows))

    def test_caller_pid_is_excluded_even_when_its_executable_is_a_candidate(self):
        row = self.process((str(self.emulator), "-u", str(self.profile)), pid=100)
        self.assertIsNone(self.match([row]))

    def test_spaces_and_quotes_in_paths_remain_part_of_one_argument(self):
        profile = self.root / "user's \"quoted\" capture"
        row = self.process((str(self.emulator), "-u", str(profile)))
        self.assertEqual(matching_profile_process([row], self.emulator, profile, 100), 200)

    def test_different_build_using_same_profile_is_also_rejected(self):
        for name in ("DolphinQt", "dolphin-emu", "dolphin-emu-nogui"):
            with self.subTest(name=name):
                executable = self.root / "Different Build" / name
                row = self.process((str(executable), "-u", str(self.profile)), executable)
                self.assertEqual(self.match([row]), 200)

    def test_explicit_custom_executable_is_recognized_by_path(self):
        executable = self.root / "Private Capture Runtime"
        row = self.process((str(executable), "-u", str(self.profile)), executable)
        self.assertEqual(matching_profile_process([row], executable, self.profile, 100), 200)

    def test_same_profile_aliases_resolve_to_the_same_directory(self):
        alias = self.root / "Alias"
        alias.symlink_to(self.profile, target_is_directory=True)
        for selected in (alias, self.profile / ".." / self.profile.name):
            with self.subTest(selected=selected):
                self.assertEqual(self.match([
                    self.process((str(self.emulator), "-u", str(selected))),
                ]), 200)

    def test_profile_prefix_and_incidental_paths_do_not_conflict(self):
        for arguments in (
            ("DolphinQt", "-u", str(self.profile) + " extra"),
            ("DolphinQt", "-e", str(self.profile), "-u", str(self.root / "Another")),
            ("DolphinQt", "-C", "Dolphin.General.DumpPath=" + str(self.profile)),
        ):
            with self.subTest(arguments=arguments):
                self.assertIsNone(self.match([self.process(arguments)]))

    def test_relative_user_path_uses_emulator_working_directory(self):
        row = self.process(("DolphinQt", "-u", "User Profiles/Board capture"), cwd=self.root)
        self.assertEqual(self.match([row]), 200)
        with self.assertRaisesRegex(RuntimeError, "Cannot resolve.*200"):
            self.match([self.process(row.arguments)])

    def test_user_option_forms_and_last_value_match_cli_semantics(self):
        for suffix in (
            ("-u", str(self.profile)),
            ("--user", str(self.profile)),
            ("--user=" + str(self.profile),),
            ("-u" + str(self.profile),),
        ):
            with self.subTest(suffix=suffix):
                row = self.process(("DolphinQt", "-u", "/different", *suffix))
                self.assertEqual(self.match([row]), 200)
        self.assertIsNone(user_directory(("DolphinQt", "--", "-u", str(self.profile))))
        self.assertIsNone(user_directory(("DolphinQt", "-e", "--user", str(self.profile))))

    def test_macos_kernel_arguments_preserve_boundaries_and_exclude_environment(self):
        arguments = (str(self.emulator), "-u", str(self.profile), "", "--debugger")
        data = (
            struct.pack("=i", len(arguments)) + str(self.emulator).encode() + b"\0\0\0"
            + b"\0".join(value.encode() for value in arguments)
            + b"\0SECRET=not-an-argument\0"
        )
        self.assertEqual(decode_macos_arguments(data), arguments)

    def test_malformed_kernel_argument_buffers_fail_closed(self):
        for data in (b"", struct.pack("=i", -1) + b"exe\0", struct.pack("=i", 2) + b"exe\0arg\0"):
            with self.subTest(data=data), self.assertRaises(ValueError):
                decode_macos_arguments(data)

    def test_process_table_filters_actual_identity_and_preserves_spaces(self):
        table = (
            "100 /Applications/Reference Build/DolphinQt\n"
            "101 /usr/bin/python3\n"
            "102 /bin/zsh\n"
            "200 /Applications/Reference Build/DolphinQt\n"
        )
        with (
            patch("native_processes.sys.platform", "darwin"),
            patch("native_processes.subprocess.check_output", return_value=table),
            patch("native_processes.macos_executable", return_value=self.emulator) as executable,
            patch("native_processes.macos_arguments", return_value=(
                "DolphinQt", "-u", str(self.profile),
            )) as arguments,
        ):
            rows = list(running_emulators(self.emulator, 100))
        executable.assert_called_once_with(200)
        arguments.assert_called_once_with(200)
        self.assertEqual(self.match(rows), 200)

    def test_vanished_process_is_ignored_but_permission_failure_is_not(self):
        for error, fails in ((errno.ESRCH, False), (errno.EPERM, True)):
            with (
                self.subTest(error=error),
                patch("native_processes.sys.platform", "darwin"),
                patch("native_processes.subprocess.check_output", return_value="200 /DolphinQt\n"),
                patch("native_processes.macos_executable", side_effect=OSError(error, "test")),
            ):
                if fails:
                    with self.assertRaisesRegex(RuntimeError, "Cannot inspect Dolphin PID 200"):
                        list(running_emulators(self.emulator, 100))
                else:
                    self.assertEqual(list(running_emulators(self.emulator, 100)), [])

    def test_linux_truncated_name_still_reads_exact_executable_and_nul_arguments(self):
        executable = self.root / "Other Build/dolphin-emu-nogui"
        arguments = (str(executable), "-u", str(self.profile))
        data = b"\0".join(value.encode() for value in arguments) + b"\0"
        with (
            patch("native_processes.sys.platform", "linux"),
            patch("native_processes.subprocess.check_output", return_value="200 dolphin-emu-nog\n"),
            patch("native_processes.Path.readlink", return_value=executable),
            patch("native_processes.Path.read_bytes", return_value=data),
        ):
            rows = list(running_emulators(self.emulator, 100))
        self.assertEqual(rows[0].arguments, arguments)
        self.assertEqual(self.match(rows), 200)

    def test_kernel_executable_overrides_misleading_process_name_and_argv_zero(self):
        with (
            patch("native_processes.sys.platform", "darwin"),
            patch("native_processes.subprocess.check_output", return_value="200 /DolphinQt\n"),
            patch("native_processes.macos_executable", return_value=Path("/usr/bin/python3")),
            patch("native_processes.macos_arguments", return_value=(
                "DolphinQt", "-u", str(self.profile),
            )),
        ):
            self.assertIsNone(self.match(running_emulators(self.emulator, 100)))

    def test_macos_cwd_field_keeps_spaces_and_newlines(self):
        cwd = self.root / "Working directory\nwith newline"
        output = b"p200\0\nfcwd\0n" + str(cwd).encode() + b"\0\n"
        with (
            patch("native_processes.sys.platform", "darwin"),
            patch("native_processes.subprocess.check_output", return_value=output),
        ):
            self.assertEqual(process_working_directory(200), cwd)


class NativeLauncherGuardTests(unittest.TestCase):
    def test_duplicate_guard_stops_before_creating_output_or_launching(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            executable = root / "DolphinQt"
            executable.write_bytes(b"placeholder")
            wad = root / "reference.wad"
            wad.write_bytes(b"placeholder")
            profile = root / "Profile with spaces"
            tmd = profile / "Wii/title/00000001/00000002/content/title.tmd"
            tmd.parent.mkdir(parents=True)
            tmd.write_bytes(b"placeholder")
            output = root / "new capture"
            argv = [
                "run_native.py", "--emulator", str(executable), "--wad", str(wad),
                "--profile", str(profile), "--output", str(output),
            ]
            for result, failure, expected in (
                (200, None, "already running (PID 200)"),
                (None, RuntimeError("inspection denied"), "Could not check"),
            ):
                with (
                    self.subTest(expected=expected),
                    patch("run_native.sys.argv", argv),
                    patch(
                        "run_native.find_profile_process", return_value=result, side_effect=failure,
                    ),
                    patch("run_native.subprocess.Popen") as launch,
                    contextlib.redirect_stderr(io.StringIO()) as errors,
                    self.assertRaises(SystemExit) as exit_result,
                ):
                    run_native.main()
                self.assertEqual(exit_result.exception.code, 2)
                self.assertIn(expected, errors.getvalue())
                launch.assert_not_called()
                self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
