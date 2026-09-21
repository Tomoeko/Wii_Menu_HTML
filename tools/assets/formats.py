"""Read Wii menu U8/ASH0, NW4R layout/animation, and GX texture resources.

Decodes original resource fields with explicit bounds and synthetic format fixtures.
Only local, already decrypted resource archives are accepted.
"""

from __future__ import annotations

import binascii
import struct
import zlib
from pathlib import PurePosixPath


def unpack(data, fmt, offset=0):
    return struct.unpack_from(">" + fmt, data, offset)


def string(data, offset=0, size=None):
    return data[offset : offset + size if size else len(data)].split(b"\0", 1)[0].decode("utf-8")


def bmg(data):
    """Read UTF-16 message tables while retaining opaque control packets."""
    if len(data) < 32 or data[:8] != b"MESGbmg1" or data[16] != 2:
        raise ValueError("Expected big-endian UTF-16 BMG messages")
    total, count = unpack(data, "II", 8)
    if total > len(data):
        raise ValueError("Truncated BMG file")
    offset, blocks = 32, {}
    for _ in range(count):
        if offset + 8 > total:
            raise ValueError("Truncated BMG section")
        (length,) = unpack(data, "I", offset + 4)
        if length < 8 or offset + length > total:
            raise ValueError("Invalid BMG section size")
        blocks[data[offset : offset + 4]] = data[offset + 8 : offset + length]
        offset += length
    info, strings = blocks.get(b"INF1", b""), blocks.get(b"DAT1", b"")
    if len(info) < 8:
        raise ValueError("Missing BMG message table")
    count, stride = unpack(info, "HH")
    if stride < 4 or 8 + count * stride > len(info):
        raise ValueError("Invalid BMG message records")
    records = []
    for index in range(count):
        (start,) = unpack(info, "I", 8 + index * stride)
        cursor, plain, tokens, text = start, bytearray(), [], ""
        while cursor + 2 <= len(strings):
            value = strings[cursor : cursor + 2]
            if value == b"\0\0":
                break
            if value == b"\0\x1a":
                if plain:
                    part = plain.decode("utf-16-be")
                    text += part
                    tokens.append({"type": "text", "value": part})
                    plain.clear()
                length = strings[cursor + 2] if cursor + 2 < len(strings) else 0
                if length < 4 or cursor + length > len(strings):
                    raise ValueError("Invalid BMG control packet")
                tokens.append(
                    {"type": "control", "rawHex": strings[cursor : cursor + length].hex()}
                )
                cursor += length
            else:
                plain.extend(value)
                cursor += 2
        else:
            raise ValueError("Unterminated BMG message")
        if plain:
            part = plain.decode("utf-16-be")
            text += part
            tokens.append({"type": "text", "value": part})
        records.append(
            {
                "id": index,
                "text": text,
                "tokens": tokens,
                "attributes": info[12 + index * stride : 8 + (index + 1) * stride].hex(),
            }
        )
    return {
        "encoding": "utf-16-be",
        "messages": {str(r["id"]): r["text"] for r in records},
        "records": records,
    }


def u8_files(data):
    if data[:4] != b"U\xaa8-":
        raise ValueError("Expected U8 archive")
    (root,) = unpack(data, "I", 4)
    (count,) = unpack(data, "I", root + 8)
    strings = root + count * 12
    stack = [(count, "")]
    result = {}
    for i in range(1, count):
        while stack[-1][0] <= i:
            stack.pop()
        kind_name, offset, size = unpack(data, "III", root + i * 12)
        name = string(data, strings + (kind_name & 0xFFFFFF))
        if name in (".", "..") or "/" in name or "\\" in name:
            raise ValueError("Invalid U8 entry name")
        path = str(PurePosixPath(stack[-1][1]) / name)
        if kind_name >> 24:
            stack.append((size, path))
        else:
            if offset + size > len(data):
                raise ValueError("Truncated U8 file")
            result[path] = data[offset : offset + size]
    return result


class Bits:
    def __init__(self, data, offset):
        self.data, self.position = data, offset * 8

    def read(self, count):
        value = 0
        for _ in range(count):
            if self.position >= len(self.data) * 8:
                raise ValueError("Truncated ASH bitstream")
            value = value * 2 + ((self.data[self.position // 8] >> (7 - self.position % 8)) & 1)
            self.position += 1
        return value


def ash0(data):
    if data[:4] != b"ASH0":
        return data
    size, offset = unpack(data, "II", 4)
    size &= 0xFFFFFF
    a, b = Bits(data, 12), Bits(data, offset)

    def tree(bits, count):
        if bits.read(1):
            return (tree(bits, count), tree(bits, count))
        return bits.read(count)

    ta, tb = tree(a, 9), tree(b, 11)

    def symbol(bits, node):
        while isinstance(node, tuple):
            node = node[bits.read(1)]
        return node

    out = bytearray()
    while len(out) < size:
        value = symbol(a, ta)
        if value < 256:
            out.append(value)
        else:
            distance = symbol(b, tb) + 1
            if distance > len(out):
                raise ValueError("ASH back-reference before output")
            for _ in range(min(value - 0xFD, size - len(out))):
                out.append(out[-distance])
    return bytes(out)


def sections(data, signature):
    if data[:4] != signature or data[4:6] != b"\xfe\xff":
        raise ValueError("Expected big-endian " + signature.decode())
    size, offset, count = unpack(data, "IHH", 8)
    if size > len(data):
        raise ValueError("Truncated NW4R file")
    for _ in range(count):
        (length,) = unpack(data, "I", offset + 4)
        if length < 8 or offset + length > size:
            raise ValueError("Invalid NW4R section size")
        yield data[offset : offset + 4].decode(), data[offset : offset + length]
        offset += length


def rgba(data, offset, count=1):
    return [list(data[offset + i * 4 : offset + (i + 1) * 4]) for i in range(count)]


def srt(data, offset):
    values = unpack(data, "5f", offset)
    return {"translate": list(values[:2]), "rotation": values[2], "scale": list(values[3:])}


def material(data, offset):
    (flags,) = unpack(data, "I", offset + 60)
    result = {
        "name": string(data, offset, 20),
        "colors": [list(unpack(data, "4h", offset + 20 + i * 8)) for i in range(3)],
        "konstColors": rgba(data, offset + 44, 4),
        "flags": flags,
        "textureMaps": [],
        "textureSRTs": [],
        "texCoordGens": [],
        "tevStages": [],
    }
    pos = offset + 64
    for _ in range(flags & 15):
        index, ws, wt = unpack(data, "HBB", pos)
        result["textureMaps"].append({"texture": index, "wrapS": ws, "wrapT": wt})
        pos += 4
    for _ in range((flags >> 4) & 15):
        result["textureSRTs"].append(srt(data, pos))
        pos += 20
    for _ in range((flags >> 8) & 15):
        result["texCoordGens"].append(
            dict(zip(("type", "source", "matrix"), unpack(data, "3B", pos)))
        )
        pos += 4
    if flags & (1 << 25):
        result["channelControl"] = list(data[pos : pos + 4])
        pos += 4
    if flags & (1 << 27):
        result["materialColor"] = rgba(data, pos)[0]
        pos += 4
    if flags & (1 << 12):
        result["tevSwapTable"] = list(data[pos : pos + 4])
        pos += 4
    count = (flags >> 13) & 3
    result["indirectSRTs"] = [srt(data, pos + i * 20) for i in range(count)]
    pos += count * 20
    count = (flags >> 15) & 7
    result["indirectStages"] = [list(data[pos + i * 4 : pos + i * 4 + 4]) for i in range(count)]
    pos += count * 4
    for _ in range((flags >> 18) & 31):
        result["tevStages"].append(list(data[pos : pos + 16]))
        pos += 16
    if flags & (1 << 23):
        result["alphaCompare"] = list(data[pos : pos + 4])
        pos += 4
    if flags & (1 << 24):
        result["blendMode"] = list(data[pos : pos + 4])
        pos += 4
    return result


def picture_content(data, offset, result):
    result["vertexColors"] = rgba(data, offset, 4)
    result["material"], count = unpack(data, "HB", offset + 16)
    result["texCoords"] = [
        [list(unpack(data, "2f", offset + 20 + i * 32 + j * 8)) for j in range(4)]
        for i in range(count)
    ]


def layout(data):
    result = {
        "width": 0,
        "height": 0,
        "originType": 1,
        "textures": [],
        "fonts": [],
        "materials": [],
        "groups": {},
        "root": None,
    }
    stack, last = [], None
    for kind, block in sections(data, b"RLYT"):
        if kind == "lyt1":
            result["originType"] = block[8]
            result["width"], result["height"] = unpack(block, "2f", 12)
        elif kind in ("txl1", "fnl1"):
            (count,) = unpack(block, "H", 8)
            result["textures" if kind == "txl1" else "fonts"] = [
                string(block, 12 + unpack(block, "I", 12 + i * 8)[0]) for i in range(count)
            ]
        elif kind == "mat1":
            (count,) = unpack(block, "H", 8)
            result["materials"] = [
                material(block, unpack(block, "I", 12 + i * 4)[0]) for i in range(count)
            ]
        elif kind in ("pan1", "bnd1", "pic1", "txt1", "wnd1"):
            values = unpack(block, "10f", 36)
            pane = {
                "name": string(block, 12, 16),
                "type": kind,
                "flags": block[8],
                "origin": block[9],
                "alpha": block[10],
                "translation": list(values[:3]),
                "rotation": list(values[3:6]),
                "scale": list(values[6:8]),
                "size": list(values[8:]),
                "children": [],
            }
            if stack:
                stack[-1]["children"].append(pane)
            else:
                result["root"] = pane
            last = pane
            if kind == "pic1":
                picture_content(block, 76, pane)
            elif kind == "txt1":
                capacity, length, mat, font = unpack(block, "4H", 76)
                (text_offset,) = unpack(block, "I", 88)
                pane.update(
                    material=mat,
                    font=font,
                    textPosition=block[84],
                    text=block[text_offset : text_offset + length].decode("utf-16-be").rstrip("\0"),
                    textColors=rgba(block, 92, 2),
                    fontSize=list(unpack(block, "2f", 100)),
                    charSpace=unpack(block, "f", 108)[0],
                    lineSpace=unpack(block, "f", 112)[0],
                )
            elif kind == "wnd1":
                pane["inflation"] = list(unpack(block, "4f", 76))
                count = block[92]
                content_offset, frames_offset = unpack(block, "2I", 96)
                picture_content(block, content_offset, pane)
                pane["frames"] = []
                for i in range(count):
                    (frame_offset,) = unpack(block, "I", frames_offset + i * 4)
                    mat, flip = unpack(block, "HB", frame_offset)
                    pane["frames"].append({"material": mat, "flip": flip})
        elif kind == "pas1":
            stack.append(last)
        elif kind == "pae1":
            stack.pop()
        elif kind == "grp1":
            name, count = string(block, 8, 16), unpack(block, "H", 24)[0]
            result["groups"][name] = [string(block, 28 + i * 16, 16) for i in range(count)]
    return result


def animation(data):
    result = {"frames": 0, "loop": False, "targets": [], "textures": []}
    for kind, block in sections(data, b"RLAN"):
        if kind != "pai1":
            continue
        frames, loop, _, file_count, count, table = unpack(block, "HBBHHI", 8)
        result.update(frames=frames, loop=bool(loop))
        result["textures"] = [
            string(block, 20 + unpack(block, "I", 20 + i * 4)[0]) for i in range(file_count)
        ]
        for i in range(count):
            (base,) = unpack(block, "I", table + i * 4)
            target = {"name": string(block, base, 20), "type": block[base + 21], "tracks": []}
            for j in range(block[base + 20]):
                tag = base + unpack(block, "I", base + 24 + j * 4)[0]
                for k in range(block[tag + 4]):
                    track = tag + unpack(block, "I", tag + 8 + k * 4)[0]
                    ident, prop, curve, _, key_count, _, key_offset = unpack(
                        block, "BBBBHHI", track
                    )
                    keys = []
                    for m in range(key_count):
                        loc = track + key_offset + m * (12 if curve == 2 else 8)
                        if curve == 2:
                            frame, value, slope = unpack(block, "3f", loc)
                            keys.append({"frame": frame, "value": value, "slope": slope})
                        else:
                            frame, value = unpack(block, "fH", loc)
                            keys.append({"frame": frame, "value": value})
                    target["tracks"].append(
                        {
                            "kind": block[tag : tag + 4].decode(),
                            "id": ident,
                            "target": prop,
                            "curveType": curve,
                            "keys": keys,
                        }
                    )
            result["targets"].append(target)
    return result


def rgb565(value):
    r, g, b = value >> 11, (value >> 5) & 63, value & 31
    return [r << 3 | r >> 2, g << 2 | g >> 4, b << 3 | b >> 2, 255]


def rgb5a3(value):
    if value & 0x8000:
        channels = [(value >> shift) & 31 for shift in (10, 5, 0)]
        return [c << 3 | c >> 2 for c in channels] + [255]
    alpha = (value >> 12) & 7
    return [((value >> shift) & 15) * 17 for shift in (8, 4, 0)] + [
        alpha << 5 | alpha << 2 | alpha >> 1
    ]


def decode_texture(data, width, height, fmt, palette=None):
    shapes = {
        0: (8, 8, 32),
        1: (8, 4, 32),
        2: (8, 4, 32),
        3: (4, 4, 32),
        4: (4, 4, 32),
        5: (4, 4, 32),
        6: (4, 4, 64),
        8: (8, 8, 32),
        9: (8, 4, 32),
        10: (4, 4, 32),
        14: (8, 8, 32),
    }
    if fmt not in shapes:
        raise ValueError(f"Unsupported GX texture format {fmt}")
    bw, bh, size = shapes[fmt]
    output, offset = bytearray(width * height * 4), 0
    for by in range(0, height, bh):
        for bx in range(0, width, bw):
            tile = data[offset : offset + size]
            offset += size
            if len(tile) < size:
                raise ValueError("Truncated texture tile")
            for y in range(bh):
                for x in range(bw):
                    i = y * bw + x
                    if fmt in (0, 8):
                        value = (tile[i // 2] >> (0 if i & 1 else 4)) & 15
                        color = [value * 17] * 4 if fmt == 0 else palette[value]
                    elif fmt in (1, 2, 9):
                        value = tile[i]
                        color = (
                            [value] * 4
                            if fmt == 1
                            else (
                                [value % 16 * 17] * 3 + [value // 16 * 17]
                                if fmt == 2
                                else palette[value]
                            )
                        )
                    elif fmt in (3, 4, 5, 10):
                        (value,) = unpack(tile, "H", i * 2)
                        color = (
                            [value & 255] * 3 + [value >> 8]
                            if fmt == 3
                            else (
                                rgb565(value)
                                if fmt == 4
                                else rgb5a3(value) if fmt == 5 else palette[value & 0x3FFF]
                            )
                        )
                    elif fmt == 6:
                        color = [tile[i * 2 + 1], tile[32 + i * 2], tile[33 + i * 2], tile[i * 2]]
                    else:
                        sub = (y // 4 * 2 + x // 4) * 8
                        c0, c1 = unpack(tile, "2H", sub)
                        a, b = rgb565(c0), rgb565(c1)
                        if c0 > c1:
                            colors = [
                                a,
                                b,
                                [(5 * a[t] + 3 * b[t]) >> 3 for t in range(3)] + [255],
                                [(3 * a[t] + 5 * b[t]) >> 3 for t in range(3)] + [255],
                            ]
                        else:
                            colors = [
                                a,
                                b,
                                [(a[t] + b[t]) // 2 for t in range(3)] + [255],
                                [(a[t] + b[t]) // 2 for t in range(3)] + [0],
                            ]
                        color = colors[(tile[sub + 4 + y % 4] >> (6 - 2 * (x % 4))) & 3]
                    if bx + x < width and by + y < height:
                        loc = ((by + y) * width + bx + x) * 4
                        output[loc : loc + 4] = bytes(color)
    return bytes(output)


def tpl(data):
    magic, count, table = unpack(data, "3I")
    if magic != 0x20AF30:
        raise ValueError("Invalid TPL magic")
    result = []
    for index in range(count):
        header, palette_header = unpack(data, "2I", table + index * 8)
        height, width, fmt, offset = unpack(data, "HHII", header)
        palette = None
        if palette_header:
            count, _, palette_fmt, palette_offset = unpack(data, "HHII", palette_header)
            palette = []
            for i in range(count):
                (value,) = unpack(data, "H", palette_offset + i * 2)
                palette.append(
                    [value & 255] * 3 + [value >> 8]
                    if palette_fmt == 0
                    else rgb565(value) if palette_fmt == 1 else rgb5a3(value)
                )
        result.append(
            {
                "width": width,
                "height": height,
                "format": fmt,
                "pixels": decode_texture(data[offset:], width, height, fmt, palette),
            }
        )
    return result


def png(width, height, pixels):
    def chunk(kind, payload):
        return (
            struct.pack(">I", len(payload))
            + kind
            + payload
            + struct.pack(">I", binascii.crc32(kind + payload) & 0xFFFFFFFF)
        )

    scanlines = b"".join(b"\0" + pixels[y * width * 4 : (y + 1) * width * 4] for y in range(height))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(scanlines, 9))
        + chunk(b"IEND", b"")
    )


def huffman(data):
    """Nintendo CX Huffman (4/8-bit symbols), as used by RFNA glyph sheets."""
    if not data or data[0] not in (0x24, 0x28):
        raise ValueError("Expected Nintendo 4/8-bit Huffman stream")
    depth, size = data[0] & 15, int.from_bytes(data[1:4], "little")
    table = 4
    if not size:
        size, table = int.from_bytes(data[4:8], "little"), 8
    start = table + (data[table] + 1) * 2
    node, output, nibble = table + 1, bytearray(), None
    while len(output) < size:
        if start + 4 > len(data):
            raise ValueError("Truncated Huffman bits")
        word = int.from_bytes(data[start : start + 4], "little")
        start += 4
        for shift in range(31, -1, -1):
            bit, descriptor = (word >> shift) & 1, data[node]
            node = (node & ~1) + ((descriptor & 63) + 1) * 2 + bit
            if node >= table + (data[table] + 1) * 2:
                raise ValueError("Huffman tree reference outside table")
            if descriptor & (0x80 >> bit):
                symbol, node = data[node], table + 1
                if depth == 8:
                    output.append(symbol)
                elif nibble is None:
                    nibble = symbol & 15
                else:
                    output.append(nibble | ((symbol & 15) << 4))
                    nibble = None
                if len(output) == size:
                    break
    return bytes(output)


def font(data):
    """Export RFNT/RFNA sheets and original glyph metrics; load all glyph groups."""
    signature = data[:4]
    if signature not in (b"RFNT", b"RFNA"):
        raise ValueError("Expected RFNT or RFNA font")
    blocks = dict(sections(data, signature))
    info = blocks["FINF"]
    glyph_offset, width_offset, map_offset = unpack(info, "3I", 16)
    (
        cell_width,
        cell_height,
        baseline,
        max_width,
        sheet_size,
        count,
        fmt,
        columns,
        rows,
        width,
        height,
        image,
    ) = unpack(data, "BBbBIHHHHHHI", glyph_offset)
    metrics, char_map = {}, {}
    pos = width_offset
    seen = set()
    while pos:
        if pos in seen:
            raise ValueError("Circular RFNT width chain")
        seen.add(pos)
        begin, end, nxt = unpack(data, "HHI", pos)
        for index in range(begin, end + 1):
            left, glyph_width, advance = unpack(data, "bBb", pos + 8 + (index - begin) * 3)
            cell = index % (columns * rows)
            metrics[str(index)] = {
                "sheet": index // (columns * rows),
                "x": (cell % columns) * (cell_width + 1) + 1,
                "y": (cell // columns) * (cell_height + 1) + 1,
                "width": glyph_width,
                "height": cell_height,
                "left": left,
                "advance": advance,
            }
        pos = nxt
    pos, seen = map_offset, set()
    while pos:
        if pos in seen:
            raise ValueError("Circular RFNT character map")
        seen.add(pos)
        begin, end, method, _, nxt = unpack(data, "4HI", pos)
        if method == 0:
            (start,) = unpack(data, "H", pos + 12)
            char_map.update({str(c): start + c - begin for c in range(begin, end + 1)})
        elif method == 1:
            for c in range(begin, end + 1):
                (index,) = unpack(data, "H", pos + 12 + (c - begin) * 2)
                if index != 0xFFFF:
                    char_map[str(c)] = index
        elif method == 2:
            (count_entries,) = unpack(data, "H", pos + 12)
            for i in range(count_entries):
                code, index = unpack(data, "2H", pos + 14 + i * 4)
                char_map[str(code)] = index
        else:
            raise ValueError(f"Unknown RFNT map method {method}")
        pos = nxt
    sheets, cursor = [], image
    for i in range(count):
        if fmt & 0x8000:
            (compressed_size,) = unpack(data, "I", cursor)
            pixels = huffman(data[cursor + 4 : cursor + 4 + compressed_size])
            cursor += 4 + compressed_size
            if len(pixels) != sheet_size:
                raise ValueError("RFNA expanded sheet size mismatch")
        else:
            pixels = data[cursor : cursor + sheet_size]
            cursor += sheet_size
        sheets.append(
            {
                "width": width,
                "height": height,
                "format": fmt & 0x7FFF,
                "pixels": decode_texture(pixels, width, height, fmt & 0x7FFF),
            }
        )
    return {
        "cellWidth": cell_width,
        "cellHeight": cell_height,
        "baseline": baseline,
        "lineFeed": unpack(info, "b", 9)[0],
        "height": info[28],
        "width": info[29],
        "ascent": info[30],
        "encoding": info[15],
        "defaultGlyph": unpack(info, "H", 10)[0],
        "glyphs": metrics,
        "characters": char_map,
        "sheets": sheets,
    }
