"""Selectable channel imports from extracted NAND directories or raw BootMii dumps."""

from contextlib import contextmanager
import hashlib
from pathlib import Path
import re
import shutil
import tempfile

from channel_storage import nand_storage, validate_content_file
from channels_export import read_metadata
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


def iter_nand_candidates(nand, language="ENG"):
    """Yield selected active banners without publishing any files."""
    nand = Path(nand)
    if not (nand / "title").is_dir():
        raise ValueError("Expected an extracted NAND directory containing title/")
    for directory in sorted((nand / "title").glob("*/*/content")):
        title = (directory.parent.parent.name + directory.parent.name).lower()
        if not re.fullmatch("[0-9a-f]{16}", title) or title == SYSTEM_MENU:
            continue
        banners = active_banners(directory, nand, title)
        if not banners:
            continue
        banner = banners[0]
        data = banner.read_bytes()
        metadata = read_metadata(data, language)
        channel_title = title
        if metadata and metadata["title"]:
            channel_title = metadata["title"]
        tmd = directory / "title.tmd"
        tmd_data = safe_file(tmd, nand).read_bytes() if tmd.exists() else None
        version = parse_tmd(tmd_data)["version"] if tmd_data is not None else None
        yield {
            "id": title,
            "title": channel_title,
            "banner": banner,
            "sha256": hashlib.sha256(data).hexdigest(),
            "version": version,
            "tmdSha256": hashlib.sha256(tmd_data).hexdigest() if tmd_data is not None else None,
        }


def _installed_metadata(descriptor):
    """Read the retained active banner, even for older banner-only imports."""
    source = descriptor.get("contentDirectory")
    if not isinstance(source, str) or not source:
        return None, None, None
    directory = Path(source)
    if not directory.is_dir():
        return None, None, None
    banners = sorted(path for path in directory.glob("*.app") if path.is_file()
                     and not path.is_symlink() and has_banner(path))
    digest = hashlib.sha256(banners[0].read_bytes()).hexdigest() if len(banners) == 1 else None
    tmd = directory / "title.tmd"
    version = None
    tmd_digest = None
    if tmd.is_file() and not tmd.is_symlink():
        tmd_data = tmd.read_bytes()
        version = parse_tmd(tmd_data)["version"]
        tmd_digest = hashlib.sha256(tmd_data).hexdigest()
    return digest, version, tmd_digest


def plan_nand(nand, state, candidates=None):
    """Describe one NAND's active title versions without exposing source paths."""
    rows = []
    if candidates is None:
        candidates = iter_nand_candidates(nand, state.get("language", "ENG"))
    for candidate in candidates:
        title = candidate["id"]
        existing = state["channels"].get(title)
        existing_digest, existing_version, existing_tmd = (
            _installed_metadata(existing) if existing else (None, None, None)
        )
        if title in state.get("removedChannels", []):
            change = "removed"
        elif existing is None:
            change = "new"
        elif existing_digest is None:
            change = "unavailable"
        elif (existing_digest == candidate["sha256"]
              and existing_version == candidate["version"]
              and existing_tmd == candidate["tmdSha256"]):
            change = "same"
        else:
            change = "different"
        rows.append({
            "id": title,
            "title": candidate["title"],
            "installed": existing is not None,
            "existingSha256": existing_digest,
            "incomingSha256": candidate["sha256"],
            "existingTmdSha256": existing_tmd,
            "incomingTmdSha256": candidate["tmdSha256"],
            "existingVersion": existing_version,
            "incomingVersion": candidate["version"],
            "change": change,
        })
    return {"rows": rows}


def import_nand(nand, state, local, *, policy="keep", replace_ids=(), keep_ids=(),
                seen_ids=None, expected_rows=None):
    """Copy selected channel assets into private managed storage."""
    if policy not in ("keep", "replace"):
        raise ValueError("NAND update policy must be keep or replace")
    replace_ids, keep_ids = set(replace_ids), set(keep_ids)
    if replace_ids & keep_ids:
        raise ValueError("One channel cannot be both kept and replaced")
    nand = Path(nand)
    if not (nand / "title").is_dir():
        raise ValueError("Expected an extracted NAND directory containing title/")
    added = 0
    for candidate in iter_nand_candidates(nand, state.get("language", "ENG")):
        title = candidate["id"]
        if expected_rows is not None:
            expected = expected_rows.get(title)
            if (expected is None or expected.get("incomingSha256") != candidate["sha256"]
                    or expected.get("incomingVersion") != candidate["version"]
                    or expected.get("incomingTmdSha256") != candidate["tmdSha256"]):
                raise ValueError("NAND channel changed since scan; scan it again")
        if seen_ids is not None:
            seen_ids.add(title)
        if title in keep_ids:
            continue
        if title in state["removedChannels"] and title not in replace_ids:
            continue
        existing = state["channels"].get(title)
        should_replace = title in replace_ids or policy == "replace"
        if (existing is not None and not should_replace
                and (existing.get("storage") is not None or existing.get("kind") != "nand")):
            continue
        directory = candidate["banner"].parent
        storage = nand_storage(directory, nand, title)
        if existing is not None and not should_replace:
            # A duplicate may fill missing accounting only when its active banner
            # and any retained TMD are identical. Never replace an imported version.
            stored = Path(existing.get("contentDirectory", "")) / candidate["banner"].name.lower()
            stored_tmd = stored.parent / "title.tmd"
            source_tmd = directory / "title.tmd"
            metadata_matches = not stored_tmd.exists() or (
                source_tmd.is_file() and stored_tmd.read_bytes() == source_tmd.read_bytes()
            )
            if (storage is not None and metadata_matches and stored.is_file()
                    and hashlib.sha256(stored.read_bytes()).digest()
                    == bytes.fromhex(candidate["sha256"])):
                existing["storage"] = storage
            continue
        target = local / "nand-titles" / title
        if target.exists():
            shutil.rmtree(target)
        target.mkdir(parents=True, exist_ok=True)
        destination = target / candidate["banner"].name.lower()
        shutil.copyfile(candidate["banner"], destination)
        if hashlib.sha256(destination.read_bytes()).hexdigest() != candidate["sha256"]:
            raise ValueError("NAND channel changed during import; scan the NAND again")
        if (directory / "title.tmd").is_file():
            shutil.copyfile(directory / "title.tmd", target / "title.tmd")
            if (hashlib.sha256((target / "title.tmd").read_bytes()).hexdigest()
                    != candidate["tmdSha256"]):
                raise ValueError("NAND channel metadata changed during import; scan it again")
        state["channels"][title] = {
            "contentDirectory": str(target.resolve()),
            "kind": "nand",
            "source": "local-nand",
            "sha256": candidate["sha256"],
        }
        if storage is not None:
            state["channels"][title]["storage"] = storage
        if title in replace_ids:
            state["removedChannels"] = [item for item in state["removedChannels"] if item != title]
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
    print(f"Installed or replaced {added} NAND channels; saved placement was preserved")
    return added
