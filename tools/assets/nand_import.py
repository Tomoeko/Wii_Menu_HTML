"""Additive channel imports from extracted NAND directories or raw BootMii dumps."""

from contextlib import contextmanager
import hashlib
from pathlib import Path
import re
import shutil
import tempfile

from channel_storage import nand_storage, validate_content_file
from nand import NandReader
from wad import parse_tmd

SYSTEM_MENU = "0000000100000002"


def has_banner(path):
    with Path(path).open("rb") as stream:
        return b"IMET" in stream.read(0xA3)


def safe_file(path, root):
    if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
        raise ValueError("NAND content must be a regular file inside the supplied directory")
    if not path.is_file():
        raise ValueError("Missing NAND content file")
    return path


@contextmanager
def nand_directory(source, scratch, keys=None):
    source = Path(source).resolve()
    if source.is_dir() and (source / "title").is_dir():
        yield source
        return
    if source.is_dir():
        candidates = [path for path in source.glob("*.bin")
                      if path.stat().st_size in (0x21000000, 0x21000400)]
        if len(candidates) != 1:
            raise ValueError("NAND folder must contain title/ or exactly one BootMii NAND dump")
        source = candidates[0]
    with tempfile.TemporaryDirectory(prefix=".nand-input-", dir=scratch) as temporary:
        destination = Path(temporary)
        with NandReader(source, keys) as reader:
            reader.extract(destination, select=lambda path: (
                len(path.parts) >= 5 and path.parts[0] == "title"
                and path.parts[3] == "content"
            ) or (len(path.parts) == 4 and path.parts[0] == "meta"
                  and path.parts[3] == "title.met")
                or str(path) == "title/00000001/00000002/data/iplsave.bin")
        yield destination


def active_banners(directory, root, title):
    """Ignore stale .app versions when a TMD identifies the active content set."""
    present_banners = [safe_file(path, root) for path in sorted(directory.glob("*.app"))
                       if has_banner(safe_file(path, root))]
    if not present_banners:
        return []
    tmd = directory / "title.tmd"
    if tmd.exists():
        metadata = parse_tmd(safe_file(tmd, root).read_bytes())
        if metadata["titleId"] != title:
            raise ValueError("NAND title directory and TMD title ID disagree")
        candidates = []
        for content in metadata["contents"]:
            if content["type"] & 0x8000:
                continue
            path = directory / f'{content["id"]}.app'
            safe_file(path, root)
            if not has_banner(path):
                continue
            validate_content_file(path, content, title, verify_hash=True, label="NAND channel banner")
            candidates.append(path)
    else:
        candidates = present_banners
    if len(candidates) > 1:
        raise ValueError("NAND title has multiple active banner contents")
    return candidates


def import_nand(nand, state, local):
    """Copy channel assets into private managed storage; existing title IDs win."""
    nand = Path(nand)
    if not (nand / "title").is_dir():
        raise ValueError("Expected an extracted NAND directory containing title/")
    added = 0
    for directory in sorted((nand / "title").glob("*/*/content")):
        title = (directory.parent.parent.name + directory.parent.name).lower()
        if not re.fullmatch("[0-9a-f]{16}", title) or title == SYSTEM_MENU:
            continue
        if title in state["removedChannels"]:
            continue
        existing = state["channels"].get(title)
        if existing is not None and (existing.get("storage") is not None
                                     or existing.get("kind") != "nand"):
            continue
        banners = active_banners(directory, nand, title)
        if not banners:
            continue
        storage = nand_storage(directory, nand, title)
        if existing is not None:
            # A duplicate may fill missing accounting only when its active banner
            # and any retained TMD are identical. Never replace an imported version.
            stored = Path(existing.get("contentDirectory", "")) / banners[0].name.lower()
            stored_tmd = stored.parent / "title.tmd"
            source_tmd = directory / "title.tmd"
            metadata_matches = not stored_tmd.exists() or (
                source_tmd.is_file() and stored_tmd.read_bytes() == source_tmd.read_bytes()
            )
            if (storage is not None and metadata_matches and stored.is_file()
                    and hashlib.sha256(stored.read_bytes()).digest()
                    == hashlib.sha256(banners[0].read_bytes()).digest()):
                existing["storage"] = storage
            continue
        target = local / "nand-titles" / title
        target.mkdir(parents=True, exist_ok=True)
        for banner in banners:
            shutil.copyfile(banner, target / banner.name.lower())
        if (directory / "title.tmd").is_file():
            shutil.copyfile(directory / "title.tmd", target / "title.tmd")
        state["channels"][title] = {
            "contentDirectory": str(target.resolve()),
            "kind": "nand",
            "source": "local-nand",
            "sha256": hashlib.sha256(banners[0].read_bytes()).hexdigest(),
        }
        if storage is not None:
            state["channels"][title]["storage"] = storage
        added += 1
    saved = nand / "title/00000001/00000002/data/iplsave.bin"
    previous = state.get("savedLayoutFile")
    if not previous and state.get("nand"):
        previous = str(Path(state["nand"]) / "title/00000001/00000002/data/iplsave.bin")
    if previous and Path(previous).is_file():
        state["savedLayoutFile"] = previous
    elif saved.is_file():
        from channels_export import read_saved_layout

        safe_file(saved, nand)
        # Do not let an invalid placement file become the permanent source.
        read_saved_layout(saved.read_bytes())
        target = local / "nand-layout.bin"
        shutil.copyfile(saved, target)
        state["savedLayoutFile"] = str(target.resolve())
    print(f"Imported {added} unique NAND channels; existing titles and placement were preserved")
    return added
