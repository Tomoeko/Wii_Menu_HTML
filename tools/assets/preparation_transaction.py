"""Recoverable publication of private imports and prepared browser resources."""
try:
    from tools.json_format import format_json
except ModuleNotFoundError:  # Direct execution from a tools subdirectory.
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from json_format import format_json

from contextlib import contextmanager
import errno
import json
import os
from pathlib import Path
import re
import shutil
import stat
import uuid


JOURNAL_NAME = ".prepare-transaction.json"
JOURNAL_LIMIT = 1024 * 1024
PRIVATE_FILES = {
    "layout": "nand-layout.bin",
    "sound": "IplSound.brsar",
    "state": "prepare.json",
}


def _checkpoint(callback, name):
    if callback is not None:
        callback(name)


def _sync_directory(path):
    # Windows does not expose directory fsync through the Python file API.
    # File flushes still precede each replace; no hardware power-loss claim is
    # made on platforms/filesystems that cannot persist directory ordering.
    if os.name == "nt":
        return
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _is_link(path):
    try:
        info = path.lstat()
    except FileNotFoundError:
        return False
    return (stat.S_ISLNK(info.st_mode)
            or bool(getattr(info, "st_file_attributes", 0) & 0x400))


def _safe_path(root, path):
    relative = path.relative_to(root)
    current = root
    for part in (None, *relative.parts):
        if part is not None:
            current /= part
        if _is_link(current):
            raise ValueError("Preparation recovery refuses symlink paths")


def _remove(path):
    if _is_link(path):
        raise ValueError("Preparation recovery refuses symlink paths")
    if path.is_dir():
        shutil.rmtree(path)
    elif path.exists():
        path.unlink()
    _sync_directory(path.parent)


def _roots(local, output):
    local, output = Path(local).resolve(), Path(output).resolve()
    if local == output or local.is_relative_to(output) or output.is_relative_to(local):
        raise ValueError("Asset output and private preparation storage must be separate directories")
    local.mkdir(parents=True, exist_ok=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    return local, output


def _lock_descriptor(descriptor, acquire):
    if os.name == "nt":
        import msvcrt
        os.lseek(descriptor, 0, os.SEEK_SET)
        mode = msvcrt.LK_NBLCK if acquire else msvcrt.LK_UNLCK
        msvcrt.locking(descriptor, mode, 1)
    else:
        import fcntl
        mode = fcntl.LOCK_EX | fcntl.LOCK_NB if acquire else fcntl.LOCK_UN
        fcntl.flock(descriptor, mode)


def _open_lock(path):
    if os.name != "nt":
        return os.open(path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    # Permit unlink while holding the lock, as on POSIX. Closing before unlink
    # would let a second process acquire the old file just before its removal.
    import ctypes
    from ctypes import wintypes
    import msvcrt
    create_file = ctypes.WinDLL("kernel32", use_last_error=True).CreateFileW
    create_file.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                           wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    create_file.restype = wintypes.HANDLE
    read_write = 0x80000000 | 0x40000000
    share_read_write_delete = 1 | 2 | 4
    open_always = 4
    normal_without_reparse = 0x80 | 0x00200000
    handle = create_file(str(path), read_write, share_read_write_delete, None,
                         open_always, normal_without_reparse, None)
    if handle == wintypes.HANDLE(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    return msvcrt.open_osfhandle(handle, os.O_RDWR | os.O_BINARY)


@contextmanager
def _preparation_lock(local):
    """An OS-held lock survives no process, including death before PID writing.

    Other local tools exclude preparation by creating this same path as a
    directory. Neither side removes the other kind of lock. After an interrupted
    preparation, this helper alone may recover and remove its stale lock file.
    """
    lock = local / ".prepare-lock"
    descriptor = None
    try:
        while True:
            _safe_path(local, lock)
            if lock.is_dir():
                raise ValueError("Another local operation owns .local/.prepare-lock")
            try:
                descriptor = _open_lock(lock)
                _lock_descriptor(descriptor, True)
            except OSError as error:
                if descriptor is not None:
                    os.close(descriptor)
                    descriptor = None
                if error.errno in (errno.EACCES, errno.EAGAIN, errno.EEXIST, errno.EISDIR):
                    raise ValueError("Another preparation or local operation is active") from error
                raise
            # A finishing process can unlink the old inode after this process
            # opens it. Do not acquire an obsolete inode beside a newer lock.
            try:
                matches = os.path.samestat(os.fstat(descriptor), lock.stat())
            except FileNotFoundError:
                matches = False
            if matches:
                break
            _lock_descriptor(descriptor, False)
            os.close(descriptor)
            descriptor = None
        os.ftruncate(descriptor, 0)
        os.write(descriptor, (str(os.getpid()) + "\n").encode("ascii"))
        os.fsync(descriptor)
        yield
    finally:
        if descriptor is not None:
            try:
                pending = any(os.path.lexists(local / name) for name in (
                    JOURNAL_NAME, JOURNAL_NAME + ".next",
                ))
                if (not pending and lock.exists()
                        and os.path.samestat(os.fstat(descriptor), lock.stat())):
                    lock.unlink()
                    _sync_directory(local)
            finally:
                _lock_descriptor(descriptor, False)
                os.close(descriptor)


def _write_journal(local, plan):
    journal = local / JOURNAL_NAME
    temporary = local / (JOURNAL_NAME + ".next")
    for path in (journal, temporary):
        _safe_path(local, path)
    payload = format_json(plan).encode("utf-8")
    if len(payload) > JOURNAL_LIMIT:
        raise ValueError("Preparation recovery journal is too large")
    if temporary.exists():
        temporary.unlink()
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(payload)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(journal)
    _sync_directory(local)


def _read_journal(local, output):
    journal = local / JOURNAL_NAME
    _safe_path(local, journal)
    if not journal.exists():
        return None
    if not journal.is_file() or journal.stat().st_size > JOURNAL_LIMIT:
        raise ValueError("Invalid preparation recovery journal")
    plan = json.loads(journal.read_text())
    if (not isinstance(plan, dict) or type(plan.get("version")) is not int
            or plan["version"] != 1 or not isinstance(plan.get("token"), str)
            or not re.fullmatch(r"[a-f0-9]{32}", plan["token"])
            or plan.get("phase") not in ("staging", "publishing", "committed")
            or not isinstance(plan.get("replacements"), list)):
        raise ValueError("Invalid preparation recovery journal")
    if plan.get("output") != str(output):
        raise ValueError("Pending preparation recovery requires its original --output directory")
    roles = []
    for replacement in plan["replacements"]:
        if not isinstance(replacement, dict) or type(replacement.get("existed")) is not bool:
            raise ValueError("Invalid preparation replacement record")
        role, name = replacement.get("role"), replacement.get("name")
        if not isinstance(role, str):
            raise ValueError("Invalid preparation replacement role")
        if role in ("titles", "nand-titles"):
            if not isinstance(name, str) or not re.fullmatch(r"[a-f0-9]{16}", name):
                raise ValueError("Invalid preparation title recovery path")
        elif role not in (*PRIVATE_FILES, "assets") or name is not None:
            raise ValueError("Invalid preparation replacement role")
        identity = (role, name)
        if identity in roles:
            raise ValueError("Duplicate preparation replacement record")
        roles.append(identity)
    if plan["phase"] == "staging" and roles:
        raise ValueError("Invalid preparation staging journal")
    if plan["phase"] != "staging" and roles[-2:] != [("assets", None), ("state", None)]:
        raise ValueError("Preparation recovery journal is missing its final publications")
    # Validate every owned path before recovery makes any change.
    for root in _scratch_roots(local, output, plan):
        _safe_path(root.parent, root)
    for replacement in plan["replacements"]:
        for root, path in _replacement_paths(local, output, plan, replacement):
            _safe_path(root, path)
    return plan


def _scratch_roots(local, output, plan):
    token = plan["token"]
    return local / (".prepare-" + token), output.parent / (".prepare-assets-" + token)


def _replacement_paths(local, output, plan, replacement):
    staged_local, staged_assets = _scratch_roots(local, output, plan)
    role, name = replacement["role"], replacement.get("name")
    if role == "assets":
        return ((staged_assets, staged_assets / "assets"), (output.parent, output),
                (staged_assets, staged_assets / "previous"))
    relative = Path(role) / name if name is not None else Path(PRIVATE_FILES[role])
    return ((staged_local, staged_local / relative), (local, local / relative),
            (staged_local, staged_local / "previous" / relative))


def _rename(source, destination):
    source.rename(destination)
    _sync_directory(source.parent)
    if destination.parent != source.parent:
        _sync_directory(destination.parent)


def _recover_unlocked(local, output, checkpoint=None):
    plan = _read_journal(local, output)
    if plan is not None:
        if plan["phase"] == "publishing":
            for replacement in reversed(plan["replacements"]):
                (_, staged), (_, destination), (_, backup) = _replacement_paths(
                    local, output, plan, replacement
                )
                if backup.exists():
                    if destination.exists():
                        _remove(destination)
                    _rename(backup, destination)
                elif replacement["existed"]:
                    if not destination.exists():
                        raise ValueError("Preparation recovery is missing an original backup")
                elif not staged.exists() and destination.exists():
                    _remove(destination)
                _checkpoint(checkpoint, "recovered-" + replacement["role"])
        # A staging journal never changed destinations. A committed journal
        # retains the complete new generation and only finishes scratch cleanup.
        for root in _scratch_roots(local, output, plan):
            _remove(root)
            _checkpoint(checkpoint, "scratch-removed")
        (local / JOURNAL_NAME).unlink()
        _sync_directory(local)
    temporary = local / (JOURNAL_NAME + ".next")
    _safe_path(local, temporary)
    if temporary.exists():
        _remove(temporary)


def recover_preparation(local, output, *, checkpoint=None):
    """Restore the prior generation, or finish cleanup after a recorded commit."""
    local, output = _roots(local, output)
    with _preparation_lock(local):
        _recover_unlocked(local, output, checkpoint)


def _sync_tree(root):
    if _is_link(root):
        raise ValueError("Preparation refuses symlink resources")
    if root.is_dir():
        for child in root.iterdir():
            _sync_tree(child)
        _sync_directory(root)
    else:
        with root.open("rb") as stream:
            os.fsync(stream.fileno())


def remap_private_paths(value, staged, destination):
    if isinstance(value, dict):
        return {key: remap_private_paths(item, staged, destination) for key, item in value.items()}
    if isinstance(value, list):
        return [remap_private_paths(item, staged, destination) for item in value]
    if isinstance(value, str) and value.startswith(str(staged) + "/"):
        return str(destination / Path(value).relative_to(staged))
    return value


@contextmanager
def preparation_workspace(local, output, *, checkpoint=None):
    """Recover before reading state, then record every scratch root before use."""
    local, output = _roots(local, output)
    with _preparation_lock(local):
        _recover_unlocked(local, output, checkpoint)
        plan = {"version": 1, "token": uuid.uuid4().hex, "phase": "staging",
                "output": str(output), "replacements": []}
        _write_journal(local, plan)
        try:
            _checkpoint(checkpoint, "workspace-recorded")
            staged_local, staged_assets = _scratch_roots(local, output, plan)
            staged_local.mkdir()
            staged_assets.mkdir()
            staged_output = staged_assets / "assets"
            if output.exists():
                shutil.copytree(output, staged_output, symlinks=True)
            else:
                staged_output.mkdir()
            _checkpoint(checkpoint, "workspace-ready")
            yield staged_local, staged_output
        finally:
            # Read the durable phase, not an in-memory guess after a failed
            # rename/fsync. Keep the journal if recovery itself fails.
            _recover_unlocked(local, output, checkpoint)


def publish_preparation(staged_local, local, staged_output, output, state, *, checkpoint=None):
    local, output = _roots(local, output)
    plan = _read_journal(local, output)
    if plan is None or plan["phase"] != "staging":
        raise ValueError("Preparation publication requires its active workspace")
    expected_local, expected_assets = _scratch_roots(local, output, plan)
    if staged_local != expected_local or staged_output != expected_assets / "assets":
        raise ValueError("Preparation publication does not match its workspace")
    replacements = []
    for category in ("titles", "nand-titles"):
        _safe_path(local, local / category)
        root = staged_local / category
        if root.exists():
            for path in sorted(root.iterdir()):
                if not re.fullmatch(r"[a-f0-9]{16}", path.name) or not path.is_dir():
                    raise ValueError("Invalid private title publication path")
                replacements.append({"role": category, "name": path.name})
    for role, filename in PRIVATE_FILES.items():
        if role != "state" and (staged_local / filename).exists():
            replacements.append({"role": role})
    final_state = remap_private_paths(state, staged_local, local)
    (staged_local / "prepare.json").write_text(format_json(final_state))
    replacements.extend([{"role": "assets"}, {"role": "state"}])
    for replacement in replacements:
        paths = _replacement_paths(local, output, plan, replacement)
        for root, path in paths:
            _safe_path(root, path)
        (_, staged), (_, destination), (_, backup) = paths
        destination.parent.mkdir(parents=True, exist_ok=True)
        backup.parent.mkdir(parents=True, exist_ok=True)
        replacement["existed"] = destination.exists()
        _sync_tree(staged)
    plan.update(phase="publishing", replacements=replacements)
    _write_journal(local, plan)
    _checkpoint(checkpoint, "publication-recorded")
    for replacement in replacements:
        (_, staged), (_, destination), (_, backup) = _replacement_paths(
            local, output, plan, replacement
        )
        if replacement["existed"]:
            _rename(destination, backup)
        _checkpoint(checkpoint, "backup-" + replacement["role"])
        _rename(staged, destination)
        _checkpoint(checkpoint, "installed-" + replacement["role"])
    plan["phase"] = "committed"
    _write_journal(local, plan)
    _checkpoint(checkpoint, "committed")
