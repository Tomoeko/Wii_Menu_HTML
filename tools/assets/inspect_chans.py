#!/usr/bin/env python3
"""Inspect original RCHE tables without executing bytecode or importing a VM.

Accepts decoded RCHE, Nintendo LZ77, or a U8 archive containing a .cs/.cs.lz7
member. Instruction grouping is optional and explicitly provisional: numeric
opcode bytes are never presented as verified VM operations.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys

MAX_INPUT_BYTES = 64 * 1024 * 1024
MAX_TABLE_ENTRIES = 100_000
MAX_ARCHIVE_PATH_BYTES = 4096
RCHE_HEADER_SIZE = 0x64
RELATIVE_BASE = 0x20
U8_MAGIC = b"U\xaa8-"

# A bounded inspection profile retained from previously examined channel data.
# It is not an independently verified VM instruction specification. Raw code
# remains available so unsupported semantics do not disappear behind labels.
OPERAND_BYTES = {
    0x02: 1, 0x03: 1, 0x18: 1,
    **{opcode: 1 for opcode in range(0x19, 0x27)},
    0x27: 2, 0x28: 4, 0x29: 8, 0x2A: 8, 0x2C: 2,
    0x30: 3, 0x31: 1, 0x32: 2, 0x33: 2, 0x34: 4, 0x35: 3, 0x36: 2,
}
INSTRUCTION_PROFILE = "provisional-channel-widths-v1"


def checked_range(data: bytes, offset: int, length: int, label: str) -> bytes:
    """Reject invalid ranges before slicing or unpacking them."""
    if offset < 0 or length < 0 or offset > len(data) or length > len(data) - offset:
        raise ValueError(f"{label}: range {offset:#x}+{length:#x} exceeds input")
    return data[offset:offset + length]


def word(data: bytes, offset: int, label: str) -> int:
    return int.from_bytes(checked_range(data, offset, 4, label), "big")


def decode_lz77(data: bytes) -> bytes:
    """Decode the bounded Nintendo type-0x10 envelope used by script members."""
    if data.startswith(b"LZ77"):
        data = data[4:]
    if len(data) < 4 or data[0] != 0x10:
        raise ValueError("Expected Nintendo LZ77 type 0x10")
    size = int.from_bytes(data[1:4], "little")
    if size == 0 or size > MAX_INPUT_BYTES:
        raise ValueError("Unsupported LZ77 output size")
    position, output = 4, bytearray()
    while len(output) < size:
        flags = checked_range(data, position, 1, "LZ77 flag")[0]
        position += 1
        for bit in range(7, -1, -1):
            if len(output) == size:
                break
            if flags & (1 << bit):
                encoded = int.from_bytes(checked_range(data, position, 2, "LZ77 reference"), "big")
                position += 2
                length, distance = (encoded >> 12) + 3, (encoded & 0xFFF) + 1
                if distance > len(output):
                    raise ValueError("LZ77 reference precedes output")
                for _ in range(min(length, size - len(output))):
                    output.append(output[-distance])
            else:
                output.extend(checked_range(data, position, 1, "LZ77 literal"))
                position += 1
    return bytes(output)


def read_u8(data: bytes) -> dict[str, bytes]:
    """Read bounded U8 entries, validating names, directory extents and payloads."""
    if len(data) < 32 or not data.startswith(U8_MAGIC):
        raise ValueError("Expected U8 archive")
    root = word(data, 4, "U8 root offset")
    data_start = word(data, 12, "U8 data offset")
    if root < 32 or word(data, root, "U8 root type") >> 24 != 1:
        raise ValueError("Invalid U8 root")
    count = word(data, root + 8, "U8 node count")
    if not 1 <= count <= MAX_TABLE_ENTRIES:
        raise ValueError("Invalid U8 node count")
    checked_range(data, root, count * 12, "U8 node table")
    names_start = root + count * 12
    if not names_start <= data_start <= len(data):
        raise ValueError("Invalid U8 name/data boundary")
    if word(data, root + 4, "U8 root parent") != 0:
        raise ValueError("Invalid U8 root parent")

    files, paths = {}, set()
    total_payload_bytes = 0
    stack = [(0, count, "")]
    for index in range(1, count):
        while stack and index >= stack[-1][1]:
            stack.pop()
        if not stack:
            raise ValueError("U8 entry lies outside root")
        parent_index, parent_end, parent_path = stack[-1]
        kind_name, offset, size = struct.unpack(
            ">III", checked_range(data, root + index * 12, 12, "U8 node")
        )
        kind, name_offset = kind_name >> 24, names_start + (kind_name & 0xFFFFFF)
        if kind not in (0, 1) or not names_start <= name_offset < data_start:
            raise ValueError("Invalid U8 node type/name offset")
        end = data.find(b"\0", name_offset, data_start)
        if end == -1:
            raise ValueError("Unterminated U8 name")
        if end - name_offset > MAX_ARCHIVE_PATH_BYTES:
            raise ValueError("U8 name exceeds inspection limit")
        try:
            name = data[name_offset:end].decode("utf-8")
        except UnicodeDecodeError as error:
            raise ValueError("Invalid UTF-8 U8 name") from error
        if not name or name in (".", "..") or "/" in name or "\\" in name:
            raise ValueError("Invalid U8 path component")
        path = f"{parent_path}/{name}" if parent_path else name
        if len(path.encode("utf-8")) > MAX_ARCHIVE_PATH_BYTES:
            raise ValueError("U8 path exceeds inspection limit")
        if path in paths:
            raise ValueError(f"Duplicate U8 path: {path}")
        paths.add(path)
        if kind:
            if offset != parent_index or not index < size <= parent_end:
                raise ValueError("Invalid U8 directory extent/parent")
            stack.append((index, size, path))
        else:
            if size and offset < data_start:
                raise ValueError("U8 payload overlaps header")
            total_payload_bytes += size
            if total_payload_bytes > MAX_INPUT_BYTES:
                raise ValueError("U8 cumulative payload exceeds inspection limit")
            files[path] = checked_range(data, offset, size, f"U8 payload {path}")
    return files


def unwrap_script(data: bytes, member: str | None = None) -> tuple[bytes, str | None]:
    """Select exactly one script; ambiguous archives require an explicit name."""
    if len(data) > MAX_INPUT_BYTES:
        raise ValueError("Input exceeds 64 MiB inspection limit")
    if data.startswith((b"LZ77", b"\x10")):
        data = decode_lz77(data)
    selected = None
    if data.startswith(U8_MAGIC):
        files = read_u8(data)
        if member is not None:
            if member not in files:
                raise ValueError(f"U8 member not found: {member}")
            selected = member
        else:
            candidates = [
                name for name in files
                if name.lower().endswith((".cs", ".cs.lz7", ".cs.lz77"))
            ]
            if len(candidates) != 1:
                raise ValueError(
                    f"Expected one script member, found {len(candidates)}; use --member"
                )
            selected = candidates[0]
        data = files[selected]
        if data.startswith((b"LZ77", b"\x10")):
            data = decode_lz77(data)
    elif member is not None:
        raise ValueError("--member requires a U8 archive")
    if not data.startswith(b"RCHE"):
        raise ValueError("Expected decoded RCHE script")
    return data, selected


def read_names(data: bytes, count: int, offset: int, label: str) -> list[str]:
    if count > MAX_TABLE_ENTRIES:
        raise ValueError(f"{label}: excessive entry count")
    checked_range(data, offset, count * 4, f"{label} table")
    names = []
    for index in range(count):
        packed = word(data, offset + index * 4, f"{label} entry")
        # The original HCGE icon script retains an empty method at index zero.
        # Its all-zero entry has no name payload, so it cannot overlap the table.
        if packed == 0:
            names.append("")
            continue
        length, relative = packed >> 24, packed & 0xFFFFFF
        if relative < count * 4:
            raise ValueError(f"{label}: name overlaps entry table")
        raw = checked_range(data, offset + relative, length, f"{label} name")
        try:
            names.append(raw.decode("utf-8"))
        except UnicodeDecodeError as error:
            raise ValueError(f"{label}: invalid UTF-8") from error
    return names


def decode_instructions(code: bytes) -> list[dict]:
    """Group numeric bytes using the declared provisional width profile only."""
    instructions, offset = [], 0
    while offset < len(code):
        opcode = code[offset]
        operand_size = 1 if opcode >= 0x40 else OPERAND_BYTES.get(opcode, 0)
        encoded = checked_range(code, offset, operand_size + 1, "Instruction")
        instructions.append({
            "offset": offset,
            "opcode": opcode,
            "label": f"OP_{opcode:02X}",
            "operandHex": encoded[1:].hex(),
            "size": len(encoded),
        })
        offset += len(encoded)
    return instructions


def parse_rche(data: bytes, *, instructions: bool = False) -> dict:
    """Parse original tables and preserve unknown header/bytecode fields."""
    if len(data) > MAX_INPUT_BYTES:
        raise ValueError("Input exceeds 64 MiB inspection limit")
    checked_range(data, 0, RCHE_HEADER_SIZE, "RCHE header")
    if data[:4] != b"RCHE":
        raise ValueError("Expected RCHE magic")

    def field(offset: int) -> int:
        return word(data, offset, f"RCHE field {offset:#x}")

    code_offset, code_size = RELATIVE_BASE + field(0x30), field(0x2C)
    if code_size and code_offset < RCHE_HEADER_SIZE:
        raise ValueError("RCHE bytecode overlaps header")
    code = checked_range(data, code_offset, code_size, "RCHE bytecode")
    table_specs = {
        "symbols": (field(0x34), RELATIVE_BASE + field(0x60)),
        "methods": (field(0x48), RELATIVE_BASE + field(0x4C)),
        "strings": (field(0x50), RELATIVE_BASE + field(0x54)),
        "functions": (field(0x40), RELATIVE_BASE + field(0x44)),
    }
    for label, (count, offset) in table_specs.items():
        if count > MAX_TABLE_ENTRIES:
            raise ValueError(f"{label}: excessive entry count")
        if count and offset < RCHE_HEADER_SIZE:
            raise ValueError(f"{label}: table overlaps header")

    symbols = read_names(data, *table_specs["symbols"], "symbols")
    methods = read_names(data, *table_specs["methods"], "methods")
    string_count, cursor = table_specs["strings"]
    strings = []
    for _ in range(string_count):
        length = int.from_bytes(checked_range(data, cursor, 2, "String length"), "big")
        cursor += 2
        if length % 2:
            raise ValueError("RCHE string has odd UTF-16 byte length")
        raw = checked_range(data, cursor, length, "String payload")
        cursor += length
        try:
            strings.append(raw.decode("utf-16-be"))
        except UnicodeDecodeError as error:
            raise ValueError("Invalid RCHE UTF-16 string") from error

    function_count, function_offset = table_specs["functions"]
    checked_range(data, function_offset, function_count * 8, "Function table")
    functions = []
    for index in range(function_count):
        offset, symbol_index, byte_a, byte_b = struct.unpack(
            ">IHBB", checked_range(data, function_offset + index * 8, 8, "Function entry")
        )
        if symbol_index >= len(symbols):
            raise ValueError("Function symbol index exceeds symbol table")
        if offset >= len(code):
            raise ValueError("Function offset exceeds bytecode")
        functions.append({
            "offset": offset,
            "symbolIndex": symbol_index,
            "symbol": symbols[symbol_index],
            "attributeBytes": [byte_a, byte_b],
        })

    result = {
        "format": "RCHE",
        "sha256": hashlib.sha256(data).hexdigest(),
        "size": len(data),
        "headerHex": data[:RCHE_HEADER_SIZE].hex(),
        "methods": methods,
        "symbols": symbols,
        "strings": strings,
        "functions": functions,
        "code": {"fileOffset": code_offset, "size": len(code), "hex": code.hex()},
    }
    if instructions:
        result["instructionProfile"] = INSTRUCTION_PROFILE
        result["instructionWarning"] = (
            "Provisional byte widths; numeric labels do not establish VM semantics."
        )
        result["instructions"] = decode_instructions(code)
    return result


def inspect_script(data: bytes, *, member: str | None = None, instructions: bool = False) -> dict:
    decoded, selected = unwrap_script(data, member)
    result = parse_rche(decoded, instructions=instructions)
    result["inputSha256"] = hashlib.sha256(data).hexdigest()
    result["archiveMember"] = selected
    return result


def render_text(result: dict) -> str:
    lines = [f"RCHE sha256 {result['sha256']}", f"member {result['archiveMember']!r}"]
    for label in ("strings", "symbols", "methods", "functions"):
        lines.append(f"{label}:")
        lines.extend(f"  {index}: {value!r}" for index, value in enumerate(result[label]))
    code = result["code"]
    lines.append(f"bytecode: {code['size']} bytes at file offset {code['fileOffset']:#x}")
    if "instructions" in result:
        lines.append(result["instructionWarning"])
        lines.extend(
            f"{item['offset']:06x}  {item['label']}  {item['operandHex']}"
            for item in result["instructions"]
        )
    else:
        lines.append(code["hex"])
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Original RCHE or U8 content file")
    parser.add_argument("--member", help="Exact U8 member when multiple scripts exist")
    parser.add_argument("--json", action="store_true", help="Write machine-readable output")
    parser.add_argument(
        "--instructions", action="store_true",
        help="Add numeric groups using a provisional, explicitly unverified width profile",
    )
    options = parser.parse_args(argv)
    try:
        if options.input.stat().st_size > MAX_INPUT_BYTES:
            raise ValueError("Input exceeds 64 MiB inspection limit")
        result = inspect_script(
            options.input.read_bytes(), member=options.member, instructions=options.instructions
        )
    except (OSError, ValueError) as error:
        parser.error(str(error))
    print(json.dumps(result, indent=2, ensure_ascii=False) if options.json else render_text(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
