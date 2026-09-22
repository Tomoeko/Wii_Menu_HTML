#!/usr/bin/env python3
"""Export original keyboard dictionary data from the user's decrypted WAD content.

This decodes the OEM word container, not Zi8's candidate-generation algorithm.
No dictionary data or executable instructions are embedded in this source file.
"""

from __future__ import annotations

try:
    from tools.json_format import format_json
except ModuleNotFoundError:  # Direct execution from a tools subdirectory.
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from json_format import format_json

import hashlib
import json
from pathlib import Path
import struct

from formats import u8_files

LANGUAGES = {"ENAM": "en", "FRCA": "fr", "ESSA": "es"}


def decode_oem_dictionary(data: bytes) -> list[str]:
    """The original callback at 0x81433A50 reads BE offsets and UTF-16 words."""
    if len(data) < 4:
        raise ValueError("Truncated OEM dictionary header")
    count = struct.unpack_from(">I", data)[0]
    table_end = 4 + count * 4
    if table_end > len(data):
        raise ValueError("Truncated OEM dictionary offset table")
    words = []
    for index in range(count):
        offset = struct.unpack_from(">I", data, 4 + index * 4)[0]
        if offset < table_end or offset % 2 or offset >= len(data):
            raise ValueError(f"Invalid OEM dictionary word offset at index {index}")
        end = offset
        while end + 2 <= len(data) and data[end : end + 2] != b"\0\0":
            end += 2
        if end + 2 > len(data):
            raise ValueError(f"Unterminated OEM dictionary word at index {index}")
        words.append(data[offset:end].decode("utf-16-be", errors="strict"))
    return words


def decode_system_header(data: bytes) -> dict:
    """Expose the 32 packed table descriptors read by 0x8145F1E0.

    The 24-bit count field can be a table-specific count or flags. It must not
    be mistaken for a universal byte length (table 31 is a format flag).
    """
    if len(data) < 196:
        raise ValueError("Truncated Zi8 system dictionary header")
    tables = []
    for index in range(32):
        start = 4 + index * 6
        count = int.from_bytes(data[start : start + 3], "big")
        offset = int.from_bytes(data[start + 3 : start + 6], "big")
        if offset >= len(data):
            raise ValueError(f"Invalid Zi8 table offset at index {index}")
        tables.append({"index": index, "countOrFlags": count, "offset": offset})
    return {
        "languageId": data[0],
        "formatFlags": data[1],
        "formatVersion": data[3],
        "tables": tables,
    }


def export_keyboard_dictionary(content_directory: Path, output: Path) -> dict:
    """Write user-owned originals and decoded metadata beneath ignored assets/."""
    archives = {}
    for path in sorted(content_directory.glob("*.app")):
        data = path.read_bytes()
        if data[:4] != b"U\xaa8-":
            continue
        for name, value in u8_files(data).items():
            if name in ("eZTSystemNA.arc", "eZTNintendoNA.arc"):
                archives[name] = u8_files(value)
    if len(archives) != 2:
        return {"schemaVersion": 1, "available": False, "languages": {}}
    destination = output / "keyboard-dictionary"
    destination.mkdir(parents=True, exist_ok=True)
    manifest = {
        "schemaVersion": 1,
        "available": True,
        "engine": "original-data-only",
        "candidateGeneration": "not-implemented",
        "languages": {},
    }
    for suffix, language in LANGUAGES.items():
        system_name = f"eZTSystem{suffix}.zsd"
        oem_name = f"eZTNintendo{suffix}.znd"
        system = archives["eZTSystemNA.arc"][system_name]
        oem = archives["eZTNintendoNA.arc"][oem_name]
        system_header = decode_system_header(system)
        words = decode_oem_dictionary(oem)
        for name, data in ((system_name, system), (oem_name, oem)):
            (destination / name).write_bytes(data)
        words_name = f"{language}-oem.json"
        (destination / words_name).write_text(
            format_json({"words": words})
        )
        manifest["languages"][language] = {
            "system": {
                "url": f"keyboard-dictionary/{system_name}",
                "sha256": hashlib.sha256(system).hexdigest(),
                "size": len(system),
                **system_header,
            },
            "oem": {
                "url": f"keyboard-dictionary/{oem_name}",
                "wordsUrl": f"keyboard-dictionary/{words_name}",
                "sha256": hashlib.sha256(oem).hexdigest(),
                "size": len(oem),
                "wordCount": len(words),
            },
        }
    (output / "keyboard-dictionary.json").write_text(format_json(manifest))
    return manifest
