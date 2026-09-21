"""Source allocation accounting for the native Channels detail block count."""

import hashlib
import stat
from pathlib import Path

from wad import parse_tmd

CLUSTER_BYTES = 0x4000
BLOCK_BYTES = 0x20000


def allocation(size):
    return (size + CLUSTER_BYTES - 1) // CLUSTER_BYTES


def storage_record(method, content_sizes, meta_size=0, tmd_sha256=None, padded_content_count=0):
    content_bytes = sum(content_sizes)
    clusters = sum(allocation(size) for size in content_sizes) + allocation(meta_size)
    return {
        "version": 1,
        "method": method,
        "contentFileCount": len(content_sizes),
        "paddedContentCount": padded_content_count,
        "contentBytes": content_bytes,
        "metaBytes": meta_size,
        "allocatedClusters": clusters,
        "allocatedBytes": clusters * CLUSTER_BYTES,
        "blocks": (clusters + 7) // 8,
        "tmdSha256": tmd_sha256,
    }


def validate_storage(value):
    """Allow only path-free accounting fields into browser catalog metadata."""
    if not isinstance(value, dict) or value.get("version") != 1:
        raise ValueError("Invalid channel storage metadata")
    if value.get("method") not in ("nand-directory-allocation", "wad-install-estimate"):
        raise ValueError("Unsupported channel storage accounting method")
    value = {"paddedContentCount": 0, **value}
    fields = ("contentFileCount", "paddedContentCount", "contentBytes", "metaBytes", "allocatedClusters",
              "allocatedBytes", "blocks")
    for name in fields:
        if type(value.get(name)) is not int or not 0 <= value[name] <= 0x7fffffff:
            raise ValueError("Invalid channel storage allocation value")
    digest = value.get("tmdSha256")
    if (not isinstance(digest, str) or len(digest) != 64
            or any(character not in "0123456789abcdef" for character in digest)):
        raise ValueError("Invalid channel storage TMD digest")
    if (value["allocatedBytes"] != value["allocatedClusters"] * CLUSTER_BYTES
            or value["blocks"] != (value["allocatedClusters"] + 7) // 8
            or value["contentBytes"] + value["metaBytes"] > value["allocatedBytes"]):
        raise ValueError("Inconsistent channel storage allocation")
    return {"version": 1, "method": value["method"],
            **{name: value[name] for name in fields}, "tmdSha256": digest}


def checked_file(path, root):
    path, root = Path(path), Path(root)
    if not path.is_relative_to(root):
        raise ValueError("Channel storage source escapes NAND root")
    current = root
    for part in (None, *path.relative_to(root).parts):
        if part is not None:
            current /= part
        if current.is_symlink():
            raise ValueError("Channel storage accounting refuses symlinks")
    if not stat.S_ISREG(path.stat().st_mode):
        raise ValueError("Channel storage accounting requires regular files")
    return path


def validate_content_file(path, content, title, *, verify_hash=False, label="Channel storage"):
    """Accept a verified payload followed by zero padding, retaining actual size."""
    actual = path.stat().st_size
    expected = content["size"]
    if actual != expected or verify_hash:
        data = path.read_bytes()
        if (len(data) < expected
                or hashlib.sha1(data[:expected]).hexdigest() != content["sha1"]
                or any(data[expected:])):
            raise ValueError(
                f'{label} {title}/{content["id"]} does not match its TMD content hash/length '
                f'(actual {actual}, expected {expected})'
            )
    return actual - expected


def nand_storage(directory, root, title):
    """Count full source content allocation; never infer size from a lone banner.

    Native 4.3U 0x8134CD68 requests content-directory usage in 16 KiB clusters
    and adds optional title.met rounded to a cluster. 0x813A8DC8 then computes
    ceil(usage / 128 KiB). Save data and shared1 are separate allocations.
    """
    directory, root = Path(directory), Path(root)
    tmd = directory / "title.tmd"
    if not tmd.exists():
        return None
    raw_tmd = checked_file(tmd, root).read_bytes()
    metadata = parse_tmd(raw_tmd)
    if metadata["titleId"] != title:
        raise ValueError("Channel storage TMD title ID disagrees with its directory")
    # A managed, banner-only directory must not be mistaken for a full NAND.
    padded_contents = 0
    for content in metadata["contents"]:
        if content["type"] & 0x8000:
            continue
        path = directory / f'{content["id"]}.app'
        if not path.exists():
            return None
        padding = validate_content_file(checked_file(path, root), content, title)
        padded_contents += int(padding > 0)
    sizes = []
    for path in directory.rglob("*"):
        if path.is_symlink():
            raise ValueError("Channel storage accounting refuses symlinks")
        if path.is_dir():
            continue
        sizes.append(checked_file(path, root).stat().st_size)
    meta = root / "meta" / title[:8] / title[8:] / "title.met"
    meta_size = checked_file(meta, root).stat().st_size if meta.exists() else 0
    return validate_storage(storage_record(
        "nand-directory-allocation", sizes, meta_size, hashlib.sha256(raw_tmd).hexdigest(),
        padded_content_count=padded_contents,
    ))


def wad_storage(metadata, raw_tmd):
    # WAD padding, ticket/certificates and shared content do not belong to the
    # installed title content directory. A WAD cannot describe stale files or
    # a separately installed /meta title.met, hence the explicit estimate mode.
    sizes = [len(raw_tmd)] + [content["size"] for content in metadata["contents"]
                             if not content["type"] & 0x8000]
    return validate_storage(storage_record(
        "wad-install-estimate", sizes, tmd_sha256=hashlib.sha256(raw_tmd).hexdigest(),
    ))
