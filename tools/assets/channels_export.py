#!/usr/bin/env python3
"""Export installed channel icon/banner resources from a local decrypted NAND dump.

The source tree is read only. Only content files with an IMET metadata header
and the corresponding meta/icon.bin or meta/banner.bin U8 members are used.
Runtime module/script identifiers are retained; exporting layouts does not
execute those programs or claim their dynamic behavior is reproduced.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
from pathlib import Path

from channel_storage import nand_storage
from export import ROOT, write_json
from formats import animation, ash0, layout, png, tpl, u8_files

LANGUAGES = ("JPN", "ENG", "GER", "FRA", "SPA", "ITA", "NED", "CHN", "CHT", "KOR")
U8_MAGIC = b"U\xaa8-"
DEFAULT_SHORT_IDS = ("HACA", "HAYA", "HABA", "HAFE", "HAGE")


def read_saved_layout(data: bytes) -> dict:
    """Read RIPL v3 slot placement using savedata::Manager::Data/SInfo."""
    if len(data) != 0x4C0 or data[:4] != b"RIPL":
        raise ValueError("Expected a 0x4c0-byte RIPL save")
    size, version, previous_page = struct.unpack_from(">III", data, 4)
    if size != len(data) or version != 3:
        raise ValueError("Unsupported RIPL save size/version")
    if hashlib.md5(data[:-16]).digest() != data[-16:]:
        raise ValueError("RIPL checksum mismatch")
    slots = []
    for index in range(48):
        offset = 0x10 + index * 16
        primary, secondary = data[offset : offset + 2]
        scene, title_type, title_code = struct.unpack_from(">III", data, offset + 4)
        channel_id = (
            "disc"
            if primary == 1
            else f"{title_type:08x}{title_code:08x}" if primary == 3 else None
        )
        slots.append(
            {
                "page": index // 12,
                "index": index % 12,
                "id": channel_id,
                "primaryType": primary,
                "secondaryType": secondary,
                "sceneId": scene,
            }
        )
    return {
        "version": version,
        "previousPage": previous_page,
        "slots": slots,
        "sha256": hashlib.sha256(data).hexdigest(),
    }


def lz77(data: bytes) -> bytes:
    """Decode the Nintendo type-0x10 stream used in installed channel resources."""
    if len(data) < 4 or data[0] != 0x10:
        raise ValueError("Expected Nintendo LZ77 type 0x10")
    size = int.from_bytes(data[1:4], "little")
    if size == 0:
        if not any(data[4:]):
            return b""  # Original settings include padded, empty CSS/HTML members.
        raise ValueError("Unsupported empty/extended LZ77 stream")
    position, output = 4, bytearray()
    while len(output) < size:
        if position >= len(data):
            raise ValueError("Truncated LZ77 flag byte")
        flags = data[position]
        position += 1
        for bit in range(7, -1, -1):
            if len(output) == size:
                break
            if flags & (1 << bit):
                if position + 2 > len(data):
                    raise ValueError("Truncated LZ77 back-reference")
                word = int.from_bytes(data[position : position + 2], "big")
                position += 2
                length, distance = (word >> 12) + 3, (word & 0xFFF) + 1
                if distance > len(output):
                    raise ValueError("LZ77 back-reference before output")
                for _ in range(min(length, size - len(output))):
                    output.append(output[-distance])
            else:
                if position >= len(data):
                    raise ValueError("Truncated LZ77 literal")
                output.append(data[position])
                position += 1
    return bytes(output)


def unwrap_resource(data: bytes) -> bytes:
    """Validate IMD5 and remove known compression envelopes."""
    for _ in range(4):
        if data.startswith(b"IMD5"):
            if len(data) < 32:
                raise ValueError("Truncated IMD5 header")
            size = int.from_bytes(data[4:8], "big")
            payload = data[32 : 32 + size]
            if len(payload) != size:
                raise ValueError("Truncated IMD5 payload")
            if hashlib.md5(payload).digest() != data[16:32]:
                raise ValueError("IMD5 checksum mismatch")
            data = payload
        elif data.startswith(b"LZ77"):
            data = lz77(data[4:])
        elif data.startswith(b"ASH0"):
            data = ash0(data)
        elif data.startswith(b"\x10"):
            data = lz77(data)
        else:
            return data
    raise ValueError("Too many resource envelopes")


def read_metadata(data: bytes, language: str) -> dict | None:
    # Matches the early-header scan in iplChannelManager::searchMetaHeader.
    position = data.find(b"IMET", 0, 0xA3)
    if position < 0:
        return None
    if position + 28 + len(LANGUAGES) * 84 > len(data):
        raise ValueError("Truncated IMET names")
    header_size, version = struct.unpack_from(">II", data, position + 4)
    (flags,) = struct.unpack_from(">I", data, position + 24)
    titles, title_lines = {}, {}
    for index, name in enumerate(LANGUAGES):
        start = position + 28 + index * 84
        # IMET stores two 21-character UTF-16 fields per language.
        lines = [
            data[start + offset : start + offset + 42].decode("utf-16-be").split("\0", 1)[0]
            for offset in (0, 42)
        ]
        title_lines[name] = lines
        titles[name] = " ".join(line for line in lines if line).strip()
    archive_offset = position + header_size - 64
    if data[archive_offset : archive_offset + 4] != U8_MAGIC:
        raise ValueError(f"Expected U8 archive after IMET at {archive_offset:#x}")
    return {
        "title": titles.get(language)
        or titles["ENG"]
        or next((v for v in titles.values() if v), ""),
        "titles": titles,
        "titleLines": title_lines,
        "imetVersion": version,
        "archiveOffset": archive_offset,
        "behavior": {
            "flags": f"0x{flags:08x}",
            "iconModule": (flags >> 28) & 15,
            "bannerModule": (flags >> 24) & 15,
            "iconScript": (flags >> 20) & 15,
            "bannerScript": (flags >> 16) & 15,
        },
    }


def export_resource(data: bytes, output: Path, channel_id: str, kind: str, source: dict) -> dict:
    resources = u8_files(unwrap_resource(data))
    prefix = Path("channel-layouts") / channel_id / kind
    textures, animations, layouts = {}, {}, {}
    warnings = []
    for path, value in sorted(resources.items()):
        if path.endswith(".tpl"):
            name = Path(path).name
            if name in textures:
                raise ValueError(f"Ambiguous texture name {name}")
            for index, texture in enumerate(tpl(value)):
                destination = (
                    prefix
                    / "textures"
                    / (Path(path).stem + (f"-{index}" if index else "") + ".png")
                )
                target = output / destination
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(png(texture["width"], texture["height"], texture.pop("pixels")))
                if index == 0:
                    textures[name] = dict(texture, name=name, url=destination.as_posix())
        elif path.endswith(".brlan"):
            animations[Path(path).stem] = animation(value)
    for path, value in sorted(resources.items()):
        if not path.endswith(".brlyt"):
            continue
        name = Path(path).stem
        parsed = layout(value)
        parsed.update(
            name=name,
            package=f"channel-{channel_id}-{kind}",
            source=f'{source["file"]}/meta/{kind}.bin/{path}',
            sourceSha256=source["sha256"],
            animations=animations,
            resourceTextures=textures,
        )
        missing = [name for name in parsed["textures"] if name not in textures]
        if missing:
            warnings.append(f'{kind}/{name}: missing textures: {", ".join(missing)}')
        parsed["textures"] = [
            textures.get(name, {"name": name, "missing": True}) for name in parsed["textures"]
        ]
        destination = prefix / (name + ".json")
        write_json(output / destination, parsed)
        layouts[name] = destination.as_posix()
    return {
        "layout": layouts.get(kind),
        "layouts": layouts,
        "textureCount": len(textures),
        "animations": list(animations),
        "warnings": warnings,
    }


def export_channels(nand: Path, output: Path, language: str = "ENG") -> dict:
    if not (nand / "title").is_dir():
        raise ValueError(f'Missing decrypted NAND title directory: {nand / "title"}')
    channels, warnings = [], []
    audio_manifest = output / "channel-audio.json"
    audio = json.loads(audio_manifest.read_text()) if audio_manifest.exists() else {}
    for source_file in sorted((nand / "title").glob("*/*/content/*.app")):
        # Avoid loading program/data content that cannot contain a menu banner.
        with source_file.open("rb") as stream:
            header = stream.read(0xA3)
        if b"IMET" not in header:
            continue
        data = source_file.read_bytes()
        source = {
            "file": source_file.relative_to(nand).as_posix(),
            "sha256": hashlib.sha256(data).hexdigest(),
        }
        meta = read_metadata(data, language)
        resources = u8_files(data[meta.pop("archiveOffset") :])
        if not any(f"meta/{kind}.bin" in resources for kind in ("icon", "banner")):
            continue
        parts = source_file.relative_to(nand).parts
        channel_id = parts[1] + parts[2]
        short_id = bytes.fromhex(parts[2]).decode("ascii", errors="replace")
        channel = {
            "id": channel_id,
            "shortId": short_id,
            **meta,
            "source": source,
            "preferred": not (
                short_id in ("HAFA", "HAGA")
                and (nand / "title" / parts[1] / (parts[2][:-2] + "45")).is_dir()
            ),
            "iconLayout": None,
            "bannerLayout": None,
            "resources": {},
            "warnings": [],
        }
        storage = nand_storage(source_file.parent, nand, channel_id)
        if storage is not None:
            channel["storage"] = storage
            channel["blocks"] = storage["blocks"]
        for kind in ("icon", "banner"):
            wrapped = resources.get(f"meta/{kind}.bin")
            if wrapped is None:
                channel["warnings"].append(f"Missing meta/{kind}.bin")
                continue
            result = export_resource(wrapped, output, channel_id, kind, source)
            channel[f"{kind}Layout"] = result["layout"]
            channel["resources"][kind] = {k: v for k, v in result.items() if k != "warnings"}
            channel["warnings"].extend(result["warnings"])
            if result["layout"] is None:
                channel["warnings"].append(f"Missing {kind}.brlyt")
        if any(
            channel["behavior"][key]
            for key in ("iconModule", "bannerModule", "iconScript", "bannerScript")
        ):
            channel["warnings"].append(
                "Native module/channel-script behavior is not executed by layout export."
            )
        if audio.get(channel_id, {}).get("sourceSha256") == source["sha256"]:
            channel["audio"] = audio[channel_id]
        channels.append(channel)
        print(
            f'{short_id}: {channel["title"]}: icon={bool(channel["iconLayout"])} banner={bool(channel["bannerLayout"])}'
        )
    if not channels:
        raise ValueError(f"No channel metadata archives found in {nand}")
    ids = [item["id"] for item in channels]
    if len(ids) != len(set(ids)):
        raise ValueError(
            "Multiple metadata contents for one title; select the TMD-active content before exporting."
        )
    priority = {short_id: index for index, short_id in enumerate(DEFAULT_SHORT_IDS)}
    preferred = sorted(
        (item for item in channels if item["preferred"]),
        key=lambda item: (priority.get(item["shortId"], len(priority)), item["id"]),
    )
    default_order = [item["id"] for item in preferred]
    saved_layout = None
    saved_path = nand / "title/00000001/00000002/data/iplsave.bin"
    if saved_path.exists():
        try:
            saved_layout = read_saved_layout(saved_path.read_bytes())
            saved_layout["source"] = saved_path.relative_to(nand).as_posix()
            default_order = [slot["id"] for slot in saved_layout["slots"] if slot["id"] in ids]
        except ValueError as error:
            warnings.append(f"Could not use saved channel placement: {error}")
    catalog = {
        "schemaVersion": 1,
        "source": {"kind": "local-decrypted-channel-content"},
        "language": language,
        "channels": channels,
        "defaultOrder": default_order,
        "savedLayout": saved_layout,
        "warnings": warnings,
        "notes": [
            "Default order follows checksum-validated iplsave.bin when available; otherwise core channels precede other discovered channels.",
            "savedLayout preserves all 48 original slots, including disc and empty positions. The catalog also retains channels absent from those slots.",
            "The browser ports selected verified channel startup/idle script branches; this export does not execute channel programs.",
        ],
    }
    write_json(output / "channels.json", catalog)
    print(f'Exported {len(channels)} channel catalogs to {output / "channels.json"}')
    return catalog


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--nand", type=Path, required=True
    )
    parser.add_argument("--output", type=Path, default=ROOT / "web/public/assets")
    parser.add_argument("--language", choices=LANGUAGES, default="ENG")
    args = parser.parse_args()
    try:
        export_channels(args.nand, args.output, args.language)
    except (ValueError, OSError) as error:
        parser.exit(1, f"Channel export failed: {error}\n")


if __name__ == "__main__":
    main()
