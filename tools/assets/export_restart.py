"""Export the original embedded Back-to-Wii-Menu archive from supplied WAD content."""

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

from formats import animation, layout, png, tpl, u8_files

LAYOUT_NAME = "my_BackToWiiMenu"
REQUIRED_MEMBERS = {
    f"arc/blyt/{LAYOUT_NAME}.brlyt",
    f"arc/anim/{LAYOUT_NAME}.brlan",
    "arc/timg/IplTopMask4x3.tpl",
    "arc/timg/my_WiiLogoWait.tpl",
}


def find_restart_archive(data: bytes) -> tuple[dict[str, bytes], dict]:
    """Locate by original member names; validate bounds and derive the DOL address.

    No region-specific executable address or copied Nintendo bytes are needed.
    The USA 4.3 create function references this archive at 0x816487E0.
    """
    cursor = 0
    while (offset := data.find(b"U\xaa8-", cursor)) >= 0:
        cursor = offset + 4
        try:
            members = u8_files(data[offset:])
        except (ValueError, struct.error, UnicodeError, IndexError):
            continue
        if not REQUIRED_MEMBERS.issubset(members):
            continue
        root = struct.unpack_from(">I", data, offset + 4)[0]
        count = struct.unpack_from(">I", data, offset + root + 8)[0]
        end = root + count * 12
        for index in range(1, count):
            kind, start, size = struct.unpack_from(">III", data, offset + root + index * 12)
            if not kind >> 24:
                end = max(end, start + size)
        address = None
        if len(data) >= 0x100:
            for index in range(18):
                start = struct.unpack_from(">I", data, index * 4)[0]
                virtual = struct.unpack_from(">I", data, 0x48 + index * 4)[0]
                size = struct.unpack_from(">I", data, 0x90 + index * 4)[0]
                if start >= 0x100 and start <= offset and offset + end <= start + size <= len(data):
                    address = virtual + offset - start
                    break
        if address is None:
            raise ValueError("Back-to-Wii-Menu archive is outside a valid executable section")
        return members, {
            "role": "system-menu-executable",
            "sha256": hashlib.sha256(data).hexdigest(),
            "archiveOffset": offset,
            "archiveAddress": f"0x{address:08X}",
            "archiveSize": end,
            "archiveSha256": hashlib.sha256(data[offset : offset + end]).hexdigest(),
        }
    raise ValueError("No supported embedded Back-to-Wii-Menu archive in supplied executable")


def export_restart_resources(content_directory: Path, output: Path) -> dict:
    found = None
    for path in sorted(content_directory.glob("*.app")):
        data = path.read_bytes()
        if LAYOUT_NAME.encode() not in data:
            continue
        try:
            found = find_restart_archive(data)
            break
        except ValueError:
            continue
    if found is None:
        raise ValueError("This System Menu WAD has no supported embedded restart layout")
    members, provenance = found
    textures = {}
    for path, data in members.items():
        if not path.endswith(".tpl"):
            continue
        texture = tpl(data)[0]
        name = Path(path).name
        destination = f"textures/restart/{Path(path).stem}.png"
        target = output / destination
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(png(texture["width"], texture["height"], texture.pop("pixels")))
        textures[name] = {
            **texture,
            "name": name,
            "url": destination,
            "source": "system-menu-executable/embedded-restart/" + path,
            "sha256": hashlib.sha256(data).hexdigest(),
        }
    layout_path = f"arc/blyt/{LAYOUT_NAME}.brlyt"
    animation_path = f"arc/anim/{LAYOUT_NAME}.brlan"
    parsed = layout(members[layout_path])
    parsed.update(
        name=LAYOUT_NAME,
        package="restart",
        source="system-menu-executable/embedded-restart/" + layout_path,
        sourceExecutable=provenance,
        animations={LAYOUT_NAME: animation(members[animation_path])},
        resourceTextures=textures,
    )
    parsed["textures"] = [textures[name] for name in parsed["textures"]]
    destination = f"layouts/restart/{LAYOUT_NAME}.json"
    target = output / destination
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(format_json(parsed))
    manifest_path = output / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["layouts"][LAYOUT_NAME] = {
        "url": destination,
        "package": "restart",
        "name": LAYOUT_NAME,
    }
    manifest["packages"]["restart"] = {
        "layouts": [LAYOUT_NAME],
        "textureCount": len(textures),
        "animations": [LAYOUT_NAME],
        "sourceExecutable": provenance,
    }
    manifest_path.write_text(format_json(manifest))
    return provenance
