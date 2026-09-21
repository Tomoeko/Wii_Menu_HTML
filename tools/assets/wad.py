"""Local WAD parsing and AES-CBC content extraction; contains no console keys.

The TMD's content hashes are checked. Nintendo signature authenticity is not
verified, and extraction never installs anything into a console or emulator.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import shutil
import struct
import tempfile

from aes import AesCbc, aes_cbc_decrypt


def align(value, boundary=64):
    return (value + boundary - 1) & -boundary


def signed_body(data, label):
    if len(data) < 4:
        raise ValueError(f"Truncated {label} signature")
    size = {0x10000: 0x240, 0x10001: 0x140, 0x10002: 0x80}.get(int.from_bytes(data[:4], "big"))
    if size is None or len(data) < size:
        raise ValueError(f"Unsupported or truncated {label} signature type")
    return data[size:]


def parse_tmd(data):
    body = signed_body(data, "TMD")
    if len(body) < 0xA4:
        raise ValueError("Truncated TMD header")
    version, count, boot_index = struct.unpack_from(">HHH", body, 0x9C)
    if count == 0 or len(body) < 0xA4 + count * 36:
        raise ValueError("Empty or truncated TMD content table")
    contents = []
    for i in range(count):
        content_id, index, kind, size, digest = struct.unpack_from(">IHHQ20s", body, 0xA4 + i * 36)
        contents.append(
            {
                "id": f"{content_id:08x}",
                "index": index,
                "type": kind,
                "size": size,
                "sha1": digest.hex(),
            }
        )
    if len({c["id"] for c in contents}) != count or len({c["index"] for c in contents}) != count:
        raise ValueError("Duplicate TMD content ID or index")
    return {
        "titleId": body[0x4C:0x54].hex(),
        "version": version,
        "bootIndex": boot_index,
        "contents": contents,
    }


def parse_wad(data):
    if len(data) < 32:
        raise ValueError("Truncated WAD header")
    header, kind, _, *sizes = struct.unpack_from(">IHH6I", data)
    if header < 32 or header > len(data) or kind not in (0x4973, 0x6962):
        raise ValueError("Invalid WAD header size/type")
    offset, sections = align(header), {}
    for name, size in zip(("certificates", "crl", "ticket", "tmd", "data", "footer"), sizes):
        if offset + size > len(data):
            raise ValueError(f"Truncated WAD {name} section")
        sections[name] = data[offset : offset + size]
        offset += align(size)
    ticket = signed_body(sections["ticket"], "ticket")
    if len(ticket) < 0xB2:
        raise ValueError("Truncated WAD ticket")
    metadata = parse_tmd(sections["tmd"])
    if ticket[0x9C:0xA4].hex() != metadata["titleId"]:
        raise ValueError("WAD ticket/TMD title IDs do not match")
    cursor = 0
    for content in metadata["contents"]:
        length = align(content["size"], 16)
        if cursor + length > len(sections["data"]):
            raise ValueError(f'Truncated encrypted content {content["id"]}')
        content["encrypted"] = sections["data"][cursor : cursor + length]
        cursor += align(content["size"])
    return metadata, sections, ticket


def read_common_key(path):
    raw = Path(path).read_bytes()
    if len(raw) == 16:
        return raw
    text = re.sub(rb"\s+", b"", raw)
    if not re.fullmatch(rb"[0-9a-fA-F]{32}", text):
        raise ValueError("Common-key file must contain 16 raw bytes or 32 hexadecimal characters")
    return bytes.fromhex(text.decode("ascii"))


def decrypt_contents(data, common_key, common_key_index=0):
    if len(common_key) != 16:
        raise ValueError("Expected a 16-byte common key")
    metadata, sections, ticket = parse_wad(data)
    if ticket[0xB1] != common_key_index:
        raise ValueError(
            f"WAD requires common-key index {ticket[0xb1]}; supply its key and --common-key-index {ticket[0xb1]}"
        )
    decoded = {}
    with AesCbc() as context:
        title_key = context.crypt(ticket[0x7F:0x8F], common_key, ticket[0x9C:0xA4] + bytes(8))
        for content in metadata["contents"]:
            payload = context.crypt(
                content.pop("encrypted"), title_key, content["index"].to_bytes(2, "big") + bytes(14)
            )[: content["size"]]
            if hashlib.sha1(payload).hexdigest() != content["sha1"]:
                raise ValueError(f'Content {content["id"]} SHA-1 mismatch (wrong key or damaged WAD)')
            decoded[content["id"]] = payload
    metadata["wadSha256"] = hashlib.sha256(data).hexdigest()
    metadata["integrity"] = (
        "Every decrypted content matches its TMD SHA-1; signatures are not verified."
    )
    return metadata, decoded, sections


def extract_wad(source, destination, common_key, common_key_index=0):
    """Validate the entire WAD before replacing a title in managed local storage."""
    source, destination = Path(source), Path(destination)
    metadata, contents, sections = decrypt_contents(
        source.read_bytes(), common_key, common_key_index
    )
    destination.mkdir(parents=True, exist_ok=True)
    title = destination / metadata["titleId"]
    with tempfile.TemporaryDirectory(prefix=".extract-", dir=destination) as temporary:
        staged = Path(temporary) / "title"
        (staged / "content").mkdir(parents=True)
        for content_id, payload in contents.items():
            (staged / "content" / f"{content_id}.app").write_bytes(payload)
        (staged / "content/title.tmd").write_bytes(sections["tmd"])
        (staged / "ticket.bin").write_bytes(sections["ticket"])
        (staged / "import.json").write_text(json.dumps(metadata, indent=2) + "\n")
        if title.exists():
            shutil.rmtree(title)
        staged.rename(title)
    return metadata, title / "content"
