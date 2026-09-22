#!/usr/bin/env python3
"""Audit original USA 4.3 dictionary writes using synthetic, isolated guest data.

This probe does not load or change a console save. It records guest writes during
Latin queries and calls the original initialization and preference-copy routines.
A bounded execution trace cannot establish every native profile's behavior.
"""

from __future__ import annotations

try:
    from tools.json_format import format_json
except ModuleNotFoundError:  # Direct execution from a tools subdirectory.
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from json_format import format_json

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import struct

from worker import (
    CONTEXT, CONTEXT_SIZE, LANGUAGES, OUTPUT, OriginalDictionary, STRING_BUFFERS,
    SUPPORTED_DOL, TABLE, WRAPPER, WRAPPER_GLOBALS, WRAPPER_GLOBALS_SIZE, WRAPPER_SIZE,
)


SYNTHETIC_MANAGER = 0x82100000
SYNTHETIC_MEMO = 0x82101000
DIGEST_CONTEXT = 0x82102000
DIGEST_OUTPUT = 0x82102100


def audit(state: Path, assets: Path) -> dict:
    from unicorn import UC_HOOK_MEM_WRITE
    from unicorn.ppc_const import UC_PPC_REG_4, UC_PPC_REG_PC

    engine = OriginalDictionary(state, assets)
    ranges = (
        ("engine-context", CONTEXT, CONTEXT_SIZE),
        ("wrapper", WRAPPER, WRAPPER_SIZE),
        ("string-buffers", STRING_BUFFERS, 0x2000),
        ("wrapper-globals", WRAPPER_GLOBALS, WRAPPER_GLOBALS_SIZE),
        ("output", OUTPUT, 0x80),
        ("stack", 0x832F0000, 0x10010),
        ("synthetic-save-fixtures", SYNTHETIC_MANAGER, 0x2200),
    )
    counts = Counter()
    outside = Counter()

    def record_write(cpu, _access, address, size, _value, _data):
        for name, start, length in ranges:
            if start <= address and address + size <= start + length:
                counts[name] += 1
                return
        outside[(address, cpu.reg_read(UC_PPC_REG_PC))] += 1

    # Unicorn's hook observes executed guest stores, excluding the host's setup
    # writes and session-memory restoration. The six dictionary resources are
    # deliberately outside the allowed mutable ranges.
    engine.cpu.hook_add(UC_HOOK_MEM_WRITE, record_write)
    queries = []
    for language, text in (("en", "he"), ("fr", "bon"), ("es", "hol")):
        session = f"audit-{language}"
        first = engine.query(text, language=language, session=session)
        engine.query(language=language, session=session, action="accept", index=0)
        engine.query(text, language=language, session=session)
        engine.query(language=language, session=session, action="close")
        reopened = engine.query(text, language=language, session=session)
        queries.append({
            "language": language,
            "input": text,
            "candidatesUnchangedAfterReopen": first == reopened,
            # Zi8GetZHuwdPtr and Zi8MatchUWDdata read these attachment fields.
            "userWordAttachmentBytes": bytes(
                engine.cpu.mem_read(CONTEXT + 0x124, 0x18)
            ).hex(),
        })
    engine.query(digits="666", session="audit-phone")
    engine.query(session="audit-phone", action="accept", index=0)

    # SetHighlightedWordW stores current input history inside the context. The
    # initializer used by WithZi::openDictionary must clear that same memory.
    word = "hello\0".encode("utf-16-be")
    engine.cpu.mem_write(OUTPUT, word)
    highlighted = engine.call(0x81465260, OUTPUT, LANGUAGES["en"][0],
                              LANGUAGES["en"][0], CONTEXT)
    before = bytes(engine.cpu.mem_read(CONTEXT + 0x187A, len(word)))
    initialized = engine.call(0x8147C7C4, TABLE, CONTEXT)
    after = bytes(engine.cpu.mem_read(CONTEXT + 0x187A, len(word)))

    # Only synthetic manager memory is used. Native setMemoSetting writes its
    # eight bytes at manager+0x330, which is file offset0x310 (data starts+0x20).
    engine.cpu.mem_write(SYNTHETIC_MANAGER, bytes(0x520))
    engine.call(0x81358558, SYNTHETIC_MANAGER)
    engine.call(0x81358594, SYNTHETIC_MANAGER)
    default_record = bytes(engine.cpu.mem_read(SYNTHETIC_MANAGER + 0x330, 8))
    sample = bytes.fromhex("1101020394100000")
    engine.cpu.mem_write(SYNTHETIC_MEMO + 0x48, sample)
    first_word = engine.call(0x81356368, SYNTHETIC_MEMO)
    second_word = engine.cpu.reg_read(UC_PPC_REG_4)
    returned_record = struct.pack(">II", first_word, second_word)
    engine.cpu.mem_write(OUTPUT, returned_record)
    engine.call(0x81357DF0, SYNTHETIC_MANAGER, OUTPUT)
    copied_record = bytes(engine.cpu.mem_read(SYNTHETIC_MANAGER + 0x330, 8))
    prefix = bytes(engine.cpu.mem_read(SYNTHETIC_MANAGER + 0x20, 0x4B0))

    # These are the same original MD5 functions called by flushAsync. The
    # filesystem/OS-backed flush itself is outside this isolated worker.
    engine.call(0x814937F4, DIGEST_CONTEXT)
    engine.call(0x81493834, DIGEST_CONTEXT, SYNTHETIC_MANAGER + 0x20, 0x4B0)
    engine.call(0x81493924, DIGEST_CONTEXT, DIGEST_OUTPUT)
    native_digest = bytes(engine.cpu.mem_read(DIGEST_OUTPUT, 16)).hex()
    magic, file_size, version = struct.unpack(">4sII", prefix[:12])
    return {
        "profile": "USA 4.3 Latin dictionary harness",
        "executableSha256": SUPPORTED_DOL,
        "queries": queries,
        "guestWritesByRegion": dict(counts),
        "guestWritesOutsideRegions": [
            {"address": hex(address), "instruction": hex(pc), "count": count}
            for (address, pc), count in sorted(outside.items())
        ],
        "highlightedWord": {
            "result": highlighted,
            "storedInsideContext": before == word,
            "initializeResult": initialized,
            "clearedByOriginalInitialize": after == bytes(len(word)),
        },
        "syntheticSave": {
            "magic": magic.decode("ascii"),
            "fileSize": file_size,
            "version": version,
            "preferenceOffset": 0x310,
            "preferenceSize": len(copied_record),
            "defaultPreferenceHex": default_record.hex(),
            "preferenceCopyExact": copied_record == sample,
            "md5InputSize": len(prefix),
            "nativeMd5": native_digest,
            "md5MatchesHost": native_digest == hashlib.md5(prefix).hexdigest(),
        },
        "limits": [
            "Synthetic queries cover English, French, Spanish and telephone input only.",
            "Host session restoration is not native save-file persistence.",
            "The OS-backed save/load callbacks and untested profiles are not executed.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--assets", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = format_json(audit(args.state, args.assets))
    if args.output:
        args.output.write_text(result)
    else:
        print(result, end="")


if __name__ == "__main__":
    main()
