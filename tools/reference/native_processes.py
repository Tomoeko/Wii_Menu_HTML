"""Inspect Dolphin user-directory arguments without parsing flattened command text."""

from __future__ import annotations

import ctypes
from dataclasses import dataclass
import errno
import os
from pathlib import Path
import struct
import subprocess
import sys
from typing import Iterable


DOLPHIN_NAMES = {"DolphinQt", "dolphin-emu", "dolphin-emu-nogui"}
VALUE_OPTIONS = {
    "-m", "--movie", "-e", "--exec", "-n", "--nand_title", "-C", "--config",
    "-s", "--save_state", "-v", "--video_backend", "-a", "--audio_emulation",
}


@dataclass(frozen=True)
class NativeProcess:
    pid: int
    executable: Path
    arguments: tuple[str, ...]
    working_directory: Path | None = None


def user_directory(arguments: Iterable[str]) -> str | None:
    """Read Dolphin's explicit user option, respecting option values and --."""
    arguments = iter(arguments)
    next(arguments, None)  # argv[0] is not an option.
    result = None
    for argument in arguments:
        if argument == "--":
            break
        if argument in ("-u", "--user"):
            result = next(arguments, None)
        elif argument.startswith("--user="):
            result = argument[len("--user="):]
        elif argument.startswith("-u") and not argument.startswith("--"):
            result = argument[2:]
        elif argument in VALUE_OPTIONS:
            next(arguments, None)
    return result


def matching_profile_process(
    processes: Iterable[NativeProcess], emulator: Path, profile: Path, caller_pid: int
) -> int | None:
    emulator = emulator.resolve()
    profile = profile.resolve()
    for process in processes:
        if process.pid == caller_pid:
            continue
        executable = process.executable.resolve()
        if executable != emulator and executable.name not in DOLPHIN_NAMES:
            continue
        selected = user_directory(process.arguments)
        if not selected:
            continue
        selected_path = Path(selected)
        if not selected_path.is_absolute():
            if process.working_directory is None:
                raise RuntimeError(
                    f"Cannot resolve the user directory of Dolphin PID {process.pid}."
                )
            selected_path = process.working_directory / selected_path
        if selected_path.resolve() == profile:
            return process.pid
    return None


def decode_macos_arguments(data: bytes) -> tuple[str, ...]:
    """KERN_PROCARGS2 contains argc, executable, padding, then NUL-separated argv."""
    if len(data) < 4:
        raise ValueError("Missing process argument count")
    count = struct.unpack_from("=i", data)[0]
    executable_end = data.find(b"\0", 4)
    if count < 1 or executable_end < 0:
        raise ValueError("Invalid process argument header")
    start = executable_end + 1
    while start < len(data) and data[start] == 0:
        start += 1
    values = data[start:].split(b"\0")
    if len(values) <= count:
        raise ValueError("Truncated process arguments")
    # Do not return the environment that follows argv in the same kernel buffer.
    return tuple(os.fsdecode(value) for value in values[:count])


def macos_arguments(pid: int) -> tuple[str, ...]:
    libc = ctypes.CDLL(None, use_errno=True)
    libc.sysctl.argtypes = [
        ctypes.POINTER(ctypes.c_int), ctypes.c_uint, ctypes.c_void_p,
        ctypes.POINTER(ctypes.c_size_t), ctypes.c_void_p, ctypes.c_size_t,
    ]
    libc.sysctl.restype = ctypes.c_int
    # Darwin's public sys/sysctl.h defines CTL_KERN=1 and KERN_PROCARGS2=49.
    request = (ctypes.c_int * 3)(1, 49, pid)
    buffer = ctypes.create_string_buffer(os.sysconf("SC_ARG_MAX"))
    size = ctypes.c_size_t(len(buffer))
    if libc.sysctl(request, 3, buffer, ctypes.byref(size), None, 0) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))
    return decode_macos_arguments(buffer.raw[:size.value])


def macos_executable(pid: int) -> Path:
    libproc = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
    libproc.proc_pidpath.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32]
    libproc.proc_pidpath.restype = ctypes.c_int
    buffer = ctypes.create_string_buffer(4096)  # PROC_PIDPATHINFO_MAXSIZE.
    if libproc.proc_pidpath(pid, buffer, len(buffer)) <= 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))
    return Path(os.fsdecode(buffer.value))


def process_working_directory(pid: int) -> Path:
    if sys.platform.startswith("linux"):
        return (Path("/proc") / str(pid) / "cwd").readlink()
    # NUL-delimited lsof fields preserve whitespace inside a relative profile's cwd.
    output = subprocess.check_output(
        ["/usr/sbin/lsof", "-a", "-p", str(pid), "-d", "cwd", "-F0n"],
        stderr=subprocess.DEVNULL,
        timeout=5,
    )
    for field in output.split(b"\0"):
        if field.startswith(b"n/"):
            return Path(os.fsdecode(field[1:]))
    raise RuntimeError(f"Cannot inspect the working directory of Dolphin PID {pid}.")


def running_emulators(emulator: Path, caller_pid: int) -> Iterable[NativeProcess]:
    if sys.platform != "darwin" and not sys.platform.startswith("linux"):
        raise RuntimeError("Native profile inspection currently supports macOS and Linux.")
    # comm is an executable name, not argv. Only known emulator candidates need
    # kernel argv inspection; Python/shell commands mentioning Dolphin are unrelated.
    table = subprocess.check_output(["ps", "-ww", "-axo", "pid=,comm="], text=True, timeout=5)
    names = DOLPHIN_NAMES | {emulator.name}
    if sys.platform.startswith("linux"):
        names |= {name[:15] for name in names}  # Linux comm can truncate the kernel name.
    for row in table.splitlines():
        fields = row.strip().split(maxsplit=1)
        if len(fields) != 2:
            continue
        pid = int(fields[0])
        if pid == caller_pid or Path(fields[1]).name not in names:
            continue
        try:
            if sys.platform == "darwin":
                executable = macos_executable(pid)
                arguments = macos_arguments(pid)
            else:
                process_root = Path("/proc") / str(pid)
                executable = (process_root / "exe").readlink()
                data = (process_root / "cmdline").read_bytes()
                arguments = tuple(os.fsdecode(value) for value in data.rstrip(b"\0").split(b"\0"))
            selected = user_directory(arguments)
            working_directory = None
            if selected and not Path(selected).is_absolute():
                working_directory = process_working_directory(pid)
            yield NativeProcess(pid, executable, arguments, working_directory)
        except OSError as error:
            if error.errno in (errno.ESRCH, errno.ENOENT):
                continue  # The process exited between enumeration and inspection.
            raise RuntimeError(f"Cannot inspect Dolphin PID {pid}: {error}") from error
        except (ValueError, subprocess.SubprocessError) as error:
            raise RuntimeError(f"Cannot inspect Dolphin PID {pid}: {error}") from error


def find_profile_process(emulator: Path, profile: Path) -> int | None:
    caller_pid = os.getpid()
    return matching_profile_process(
        running_emulators(emulator, caller_pid), emulator, profile, caller_pid
    )
