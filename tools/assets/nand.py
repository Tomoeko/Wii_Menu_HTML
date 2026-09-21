#!/usr/bin/env python3
"""Read-only BootMii NAND extraction with authenticated data and bounded traversal.

Supports 512 MiB Wii dumps with 64-byte spare areas and an optional 1024-byte
BootMii key footer. Hardware ECC repair, other flash geometries, and Wii U images
are not supported. HMAC validation detects damaged metadata and decrypted data.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import hmac
from pathlib import Path, PurePosixPath
import struct
import tempfile

from aes import AesCbc

PAGE_SIZE = 0x800
PAGE_STRIDE = 0x840
CLUSTER_SIZE = 0x4000
DUMP_SIZE = 0x21000000
SUPERBLOCK_SIZE = 0x40000
FIRST_SUPERBLOCK = 0x7F00
NODE_COUNT = 0x17FF
END_NODE = 0xFFFF
END_CLUSTER = 0xFFFB


@dataclass(frozen=True)
class Entry:
    index: int
    name_bytes: bytes
    mode: int
    first: int
    sibling: int
    size: int
    owner: int
    extra: int
    path: PurePosixPath
    clusters: tuple[int, ...] = ()

    @property
    def is_directory(self):
        return self.mode & 3 == 2


def verify_hmac(spare, expected):
    # The first copy occupies page 6 bytes 1..20. The second crosses the
    # page-6/page-7 boundary. Either intact copy is enough for authentication.
    first = spare[6][1:21]
    second = spare[6][21:33] + spare[7][1:9]
    return hmac.compare_digest(first, expected) or hmac.compare_digest(second, expected)


def parse_entries(superblock):
    """Validate the complete namespace and allocation graph before writing files."""
    fat = struct.unpack_from(">32768H", superblock, 12)
    pending = [(0, PurePosixPath())]
    visited = set()
    used_clusters = set()
    used_paths = set()
    entries = []
    while pending:
        index, parent = pending.pop()
        if index == END_NODE:
            continue
        if index >= NODE_COUNT or index in visited:
            raise ValueError("NAND filesystem has an invalid or repeated node")
        visited.add(index)
        fields = struct.unpack_from(">12sBBHHIIHI", superblock, 0x1000C + index * 32)
        name_bytes, mode, _, first, sibling, size, owner, _, extra = fields
        if mode & 3 not in (1, 2):
            raise ValueError("NAND filesystem has an unsupported node type")
        if index == 0:
            if mode & 3 != 2 or sibling != END_NODE:
                raise ValueError("NAND filesystem has an invalid root")
            path = parent
        else:
            try:
                name = name_bytes.split(b"\0", 1)[0].decode("ascii")
            except UnicodeDecodeError as error:
                raise ValueError("NAND filename is not supported by portable extraction") from error
            if (
                not name or name in (".", "..") or name[-1] in (".", " ")
                or any(ord(character) < 32 or character in '/\\:*?"<>|' for character in name)
                or name.split(".", 1)[0].upper() in {
                    "CON", "PRN", "AUX", "NUL",
                    *(f"COM{number}" for number in range(1, 10)),
                    *(f"LPT{number}" for number in range(1, 10)),
                }
            ):
                raise ValueError("NAND filesystem contains an unsafe filename")
            path = parent / name
            if len(path.parts) > 64:
                raise ValueError("NAND directory nesting exceeds the supported depth")
            normalized = str(path).casefold()
            if normalized in used_paths:
                raise ValueError("NAND filesystem contains duplicate portable paths")
            used_paths.add(normalized)
        pending.append((sibling, parent))
        clusters = []
        if mode & 3 == 2:
            pending.append((first, path))
        else:
            remaining = (size + CLUSTER_SIZE - 1) // CLUSTER_SIZE
            cluster = first
            while remaining:
                if not 0x40 <= cluster < FIRST_SUPERBLOCK or cluster in used_clusters:
                    raise ValueError("NAND file has an invalid, shared, or cyclic cluster chain")
                used_clusters.add(cluster)
                clusters.append(cluster)
                cluster = fat[cluster]
                remaining -= 1
            if clusters and cluster != END_CLUSTER:
                raise ValueError("NAND file length does not match its cluster chain")
        entries.append(Entry(index, name_bytes, mode, first, sibling, size, owner, extra,
                             path, tuple(clusters)))
    return entries


class NandReader:
    """Stream a dump without copying the 512 MiB flash image into memory."""

    def __init__(self, source, keys=None):
        self.source = Path(source)
        self.keys_path = Path(keys) if keys else None

    def __enter__(self):
        size = self.source.stat().st_size
        if size not in (DUMP_SIZE, DUMP_SIZE + 0x400):
            raise ValueError("Expected a 512 MiB BootMii NAND dump with page spare areas")
        self.stream = self.source.open("rb")
        try:
            if self.keys_path:
                key_data = self.keys_path.read_bytes()
            elif size == DUMP_SIZE + 0x400:
                self.stream.seek(DUMP_SIZE)
                key_data = self.stream.read(0x400)
            else:
                key_data = self.source.with_name("keys.bin").read_bytes()
            if len(key_data) != 0x400:
                raise ValueError("BootMii keys.bin must contain exactly 1024 bytes")
            self.hmac_key = key_data[0x144:0x158]
            self.aes_key = key_data[0x158:0x168]
            self.superblock, self.generation = self._superblock()
            self.entries = parse_entries(self.superblock)
            self.aes = AesCbc().__enter__()
        except BaseException:
            self.stream.close()
            raise
        return self

    def __exit__(self, *exception):
        self.aes.__exit__(*exception)
        self.stream.close()
        self.aes_key = b""
        self.hmac_key = b""

    def _cluster(self, index):
        self.stream.seek(index * 8 * PAGE_STRIDE)
        raw = self.stream.read(8 * PAGE_STRIDE)
        if len(raw) != 8 * PAGE_STRIDE:
            raise ValueError("Truncated NAND cluster")
        data = b"".join(raw[offset : offset + PAGE_SIZE]
                        for offset in range(0, len(raw), PAGE_STRIDE))
        spare = [raw[offset + PAGE_SIZE : offset + PAGE_STRIDE]
                 for offset in range(0, len(raw), PAGE_STRIDE)]
        return data, spare

    def _superblock(self):
        candidates = []
        for slot in range(16):
            first = FIRST_SUPERBLOCK + slot * 16
            header, _ = self._cluster(first)
            if header[:4] == b"SFFS":
                candidates.append((struct.unpack_from(">I", header, 4)[0], first))
        if not candidates:
            raise ValueError("No SFFS filesystem metadata found in NAND")
        generation, first = max(candidates)
        blocks = [self._cluster(first + index) for index in range(16)]
        data = b"".join(block for block, _ in blocks)
        salt = bytes(16) + struct.pack(">I", first) + bytes(44)
        digest = hmac.digest(self.hmac_key, salt + data, "sha1")
        if not verify_hmac(blocks[-1][1], digest):
            raise ValueError("Newest NAND metadata HMAC mismatch (wrong keys or damaged dump)")
        return data, generation

    def file_chunks(self, entry):
        remaining = entry.size
        for ordinal, cluster in enumerate(entry.clusters):
            encrypted, spare = self._cluster(cluster)
            data = self.aes.crypt(encrypted, self.aes_key, bytes(16))
            salt = struct.pack(">I12sIII", entry.owner, entry.name_bytes, ordinal,
                               entry.index, entry.extra) + bytes(36)
            digest = hmac.digest(self.hmac_key, salt + data, "sha1")
            if not verify_hmac(spare, digest):
                raise ValueError("NAND file HMAC mismatch (wrong keys or damaged dump)")
            yield data[:remaining]
            remaining -= min(remaining, CLUSTER_SIZE)

    def extract(self, destination, select=None):
        """Write inside a caller-owned, new staging directory; never write keys."""
        destination = Path(destination)
        count = 0
        for entry in self.entries:
            if entry.is_directory:
                if select is None:
                    destination.joinpath(*entry.path.parts).mkdir(parents=True, exist_ok=True)
                continue
            if select and not select(entry.path):
                continue
            target = destination.joinpath(*entry.path.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("xb") as stream:
                for chunk in self.file_chunks(entry):
                    stream.write(chunk)
            count += 1
        return count


def extract_nand(source, destination, keys=None):
    """Publish a complete extraction only after every selected file validates."""
    destination = Path(destination).absolute()
    if destination.exists() or destination.is_symlink():
        raise ValueError("NAND extraction destination must not already exist")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".nand-extract-", dir=destination.parent) as temporary:
        staged = Path(temporary) / "nand"
        staged.mkdir()
        with NandReader(source, keys) as reader:
            count = reader.extract(staged)
        if destination.exists() or destination.is_symlink():
            raise ValueError("NAND extraction destination appeared during extraction")
        staged.rename(destination)
    return count


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="BootMii nand.bin")
    parser.add_argument("--keys", type=Path, help="Matching keys.bin; otherwise sibling or footer")
    parser.add_argument("--output", required=True, type=Path, help="New extraction directory")
    args = parser.parse_args(argv)
    try:
        count = extract_nand(args.source, args.output, args.keys)
    except (OSError, ValueError, RuntimeError) as error:
        parser.exit(1, f"NAND extraction failed: {error}\n")
    print(f"Extracted and authenticated {count} files. Console keys were not copied.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
