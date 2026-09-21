#!/usr/bin/env python3
"""Split the original Opera TTC into browser-loadable SFNT faces without redrawing glyphs."""

import argparse
import hashlib
import json
from pathlib import Path
import struct

from export import ROOT, write_json
from formats import u8_files


def checksum(data):
    padded = data + bytes((-len(data)) % 4)
    return sum(struct.unpack(">" + str(len(padded) // 4) + "I", padded)) & 0xFFFFFFFF


def split_collection(data):
    if data[:4] != b"ttcf" or len(data) < 12:
        raise ValueError("Expected a TrueType collection")
    (count,) = struct.unpack_from(">I", data, 8)
    if not 0 < count < 64 or len(data) < 12 + count * 4:
        raise ValueError("Invalid TTC face table")
    faces = []
    for offset in struct.unpack_from(">" + str(count) + "I", data, 12):
        if offset + 12 > len(data):
            raise ValueError("Truncated SFNT face header")
        (tables,) = struct.unpack_from(">H", data, offset + 4)
        if offset + 12 + tables * 16 > len(data):
            raise ValueError("Truncated SFNT table directory")
        result = bytearray(data[offset : offset + 12] + bytes(tables * 16))
        names, head = [], None
        for index in range(tables):
            tag, _, start, length = struct.unpack_from(">4sIII", data, offset + 12 + index * 16)
            if start + length > len(data):
                raise ValueError("Truncated SFNT table")
            table = bytearray(data[start : start + length])
            position = len(result)
            if tag == b"head":
                if length < 12:
                    raise ValueError("Truncated font head table")
                table[8:12] = bytes(4)
                head = position
            if tag == b"name":
                _, records, strings = struct.unpack_from(">HHH", table)
                for record in range(records):
                    platform, encoding, language, ident, size, at = struct.unpack_from(
                        ">6H", table, 6 + record * 12
                    )
                    if ident not in (1, 4):
                        continue
                    raw = table[strings + at : strings + at + size]
                    try:
                        value = raw.decode("utf-16-be" if platform in (0, 3) else "mac_roman")
                    except UnicodeDecodeError:
                        continue
                    if value and value not in names:
                        names.append(value)
            struct.pack_into(
                ">4sIII", result, 12 + index * 16, tag, checksum(table), position, length
            )
            result.extend(table)
            result.extend(bytes((-length) % 4))
        if head is None:
            raise ValueError("Font has no head table")
        struct.pack_into(">I", result, head + 8, (0xB1B0AFBA - checksum(result)) & 0xFFFFFFFF)
        faces.append({"data": bytes(result), "names": names})
    return faces


def browser_font(data):
    """Repair the original format-4 missing-glyph sentinel for modern OTS.

    The source maps U+FFFF to glyph 65535 (outside maxp.numGlyphs). The
    required terminal segment uses delta 1 to map that noncharacter to glyph
    zero instead. All assigned characters, outlines, hints and metrics remain
    unchanged; the unmodified split face is exported separately.
    """
    result = bytearray(data)
    tables = {}
    for index in range(struct.unpack_from(">H", data, 4)[0]):
        entry = 12 + index * 16
        tag, _, start, length = struct.unpack_from(">4sIII", data, entry)
        tables[tag] = (entry, start, length)
    repairs = []
    if b"cmap" not in tables:
        return data, repairs
    entry, base, length = tables[b"cmap"]
    seen = set()
    for index in range(struct.unpack_from(">H", data, base + 2)[0]):
        offset = base + struct.unpack_from(">I", data, base + 8 + index * 8)[0]
        if offset in seen or struct.unpack_from(">H", data, offset)[0] != 4:
            continue
        seen.add(offset)
        count = struct.unpack_from(">H", data, offset + 6)[0] // 2
        last = count - 1
        end = struct.unpack_from(">H", data, offset + 14 + last * 2)[0]
        start = struct.unpack_from(">H", data, offset + 16 + count * 2 + last * 2)[0]
        delta_offset = offset + 16 + count * 4 + last * 2
        delta = struct.unpack_from(">H", data, delta_offset)[0]
        glyph_offset = struct.unpack_from(">H", data, offset + 16 + count * 6 + last * 2)[0]
        if start == end == 0xFFFF and delta == glyph_offset == 0:
            struct.pack_into(">H", result, delta_offset, 1)
            repairs.append(
                {
                    "table": "cmap",
                    "format": 4,
                    "codepoint": 65535,
                    "beforeGlyph": 65535,
                    "afterGlyph": 0,
                }
            )
    if repairs:
        struct.pack_into(">I", result, entry + 4, checksum(result[base : base + length]))
        _, head, _ = tables[b"head"]
        struct.pack_into(">I", result, head + 8, 0)
        struct.pack_into(">I", result, head + 8, (0xB1B0AFBA - checksum(result)) & 0xFFFFFFFF)
    return bytes(result), repairs


def export_outline_fonts(source, output):
    source_data = source.read_bytes()
    files = u8_files(source_data) if source_data[:4] == b"U\xaa8-" else {"outline-font.ttc": source_data}
    descriptors, rules = [], []
    for name, data in files.items():
        if data[:4] != b"ttcf":
            continue
        for index, face in enumerate(split_collection(data)):
            destination = f"fonts/{Path(name).stem}-{index}.ttf"
            target = output / destination
            target.parent.mkdir(parents=True, exist_ok=True)
            raw_destination = f"fonts/raw/{Path(name).stem}-{index}.ttf"
            raw_target = output / raw_destination
            raw_target.parent.mkdir(parents=True, exist_ok=True)
            raw_target.write_bytes(face["data"])
            browser_data, repairs = browser_font(face["data"])
            target.write_bytes(browser_data)
            # Opera selected script subsets through these virtual family names;
            # the original collection contains both Latin and Japanese glyphs.
            base_names = [family for family in face["names"] if not family.endswith(" Regular")]
            aliases = [
                family + suffix
                for family in base_names
                for suffix in (" Latin", " Latin Regular", " JPN", " JPN Regular")
            ]
            if "Wii NTLG PGothic" in base_names:
                # Source CSS contains Shift-JIS family bytes while English
                # HTML declares UTF-8. Keep those files raw and register both
                # decoded spellings against the supplied proportional face.
                for weight in ("DB", "M"):
                    legacy = "FOT-ロダンNTLG Pro " + weight
                    aliases.extend(
                        [legacy, legacy.encode("cp932").decode("utf-8", errors="replace")]
                    )
            families = face["names"] + aliases
            descriptor = {
                "url": destination,
                "families": families,
                "source": "outline-font-archive/" + name,
                "sourceSha256": hashlib.sha256(data).hexdigest(),
                "sha256": hashlib.sha256(browser_data).hexdigest(),
                "rawUrl": raw_destination,
                "rawSha256": hashlib.sha256(face["data"]).hexdigest(),
                "browserRepairs": repairs,
            }
            descriptors.append(descriptor)
            for family in families:
                rules.append(
                    "@font-face {\n  font-family: "
                    + json.dumps(family, ensure_ascii=False)
                    + ';\n  src: url("/assets/'
                    + destination
                    + '") format("truetype");\n  font-weight: normal;\n'
                    + "  font-style: normal;\n  font-display: block;\n}"
                )
    css = output / "fonts/outline-fonts.css"
    css.parent.mkdir(parents=True, exist_ok=True)
    css.write_text("\n".join(rules) + "\n")
    manifest_path = output / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["outlineFonts"] = {"css": "fonts/outline-fonts.css", "faces": descriptors}
    write_json(manifest_path, manifest)
    print(f"Exported {len(descriptors)} original outline font faces")
    return manifest["outlineFonts"]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "web/public/assets")
    args = parser.parse_args()
    export_outline_fonts(args.source, args.output)
