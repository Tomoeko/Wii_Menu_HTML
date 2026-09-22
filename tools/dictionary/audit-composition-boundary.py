#!/usr/bin/env python3
"""Probe the original Base/WithZi 32-unit input boundary using synthetic text.

The original Base input, active-buffer selection, commit, WithZi query/update,
clear and count routines execute unchanged. A synthetic UI owner supplies its
profile, committed-text sink and sound/refresh callbacks. No running console,
private text, save file or original executable bytes are changed.
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
import json
from pathlib import Path
import struct

from worker import CANDIDATES, CASE_MODES, OriginalDictionary, SUPPORTED_DOL, WRAPPER


BASE = 0x82F00000
BASE_VTABLE = 0x82F01000
LITERAL = 0x82F02000
LITERAL_VTABLE = 0x82F03000
STUBS = {
    0x83100000: "command",
    0x83100004: "profile",
    0x83100008: "sound",
    0x8310000C: "refresh",
    0x83100010: "commit",
    0x83100014: "text_lock",
}


def audit(state: Path, assets: Path) -> dict:
    from unicorn import UC_HOOK_CODE

    engine = OriginalDictionary(state, assets)
    cpu, registers, write = engine.cpu, engine.registers, engine.write_u32
    write(BASE, BASE_VTABLE)
    write(BASE + 0x164, LITERAL)
    write(BASE + 0x16C, WRAPPER)
    write(BASE + 0x174, 2)  # Latin dictionary rather than the Kana owner (1).
    cpu.mem_write(BASE + 0x178, b"\1")  # Prediction enabled.
    write(BASE + 0x1F0, 2)  # Latin branch; special modes 8/9 are outside this audit.
    write(LITERAL, LITERAL_VTABLE)
    for offset, stub in ((0x18, 0x83100000), (0x114, 0x83100004),
                         (0x178, 0x83100008), (0xD8, 0x8310000C)):
        write(BASE_VTABLE + offset, stub)
    write(LITERAL_VTABLE + 0x54, 0x83100010)
    write(LITERAL_VTABLE + 0x7C, 0x83100014)
    events = []

    def utf16(address):
        return bytes(cpu.mem_read(address, 128)).decode("utf-16-be").split("\0")[0]

    def intercept(cpu, address, size, data):
        name = STUBS.get(address)
        if name == "command":
            command = cpu.reg_read(registers.UC_PPC_REG_4)
            events.append({"command": command})
            if command != 6:
                raise AssertionError(f"Unexpected Base command {command}")
            # Command 6's original dispatch entry 0x8141DB54 calls this original
            # commit function. Preserve LR so it returns to the original input.
            cpu.reg_write(registers.UC_PPC_REG_PC, 0x81420F30)
            return
        if name == "sound":
            events.append({"sound": cpu.reg_read(registers.UC_PPC_REG_4)})
        elif name == "commit":
            events.append({"commit": utf16(cpu.reg_read(registers.UC_PPC_REG_4))})
        cpu.reg_write(registers.UC_PPC_REG_3, 0)
        cpu.reg_write(registers.UC_PPC_REG_PC, cpu.reg_read(registers.UC_PPC_REG_LR))

    hook = cpu.hook_add(UC_HOOK_CODE, intercept, begin=min(STUBS), end=max(STUBS))
    results = []
    try:
        for language in ("en", "fr", "es"):
            for phone in (False, True):
                session = f"boundary-{language}-{phone}"
                for count in (31, 32):
                    query = engine.query(
                        text="a" * count, language=language,
                        digits="2" * count if phone else None, session=session,
                    )
                    current_word = query["candidates"][0]
                    events.clear()
                    before = engine.call(0x81420488, WRAPPER)
                    engine.call(
                        0x81421458, BASE, 0xEFF2 if phone else ord("b"), 0,
                        CASE_MODES["lower"], 0, 0x81660AEC if phone else 0,
                    )
                    after = engine.call(0x81420488, WRAPPER)
                    expected = [{"sound": 10}] if count == 31 else [
                        {"command": 6}, {"commit": current_word}, {"sound": 9},
                    ]
                    assert before == count and after == (32 if count == 31 else 1)
                    assert events == expected, events
                    results.append({
                        "language": language, "input": "phone" if phone else "qwerty",
                        "beforeUnits": before, "afterUnits": after,
                        "candidateBefore": current_word,
                        "events": list(events), "candidatesAfter": engine.candidate_words(),
                    })

        # Isolate the selected-string contract from dictionary vocabulary. These
        # synthetic candidates are NOT asserted to exist in the supplied data.
        engine.restore(engine.sessions["boundary-en-False"])
        completed = "a" * 32 + "ghost"
        cpu.mem_write(CANDIDATES + 0x80, completed.encode("utf-16-be") + b"\0\0")
        engine.call(0x8141EA80, WRAPPER, 1)
        events.clear()
        engine.call(0x81421458, BASE, ord("b"), 0, CASE_MODES["lower"], 0, 0)
        assert events == [{"command": 6}, {"commit": completed}, {"sound": 9}]
        selected = {
            "inputUnits": 32, "syntheticSelectedIndex": 1,
            "syntheticSelectedString": completed, "events": list(events),
            "afterUnits": engine.call(0x81420488, WRAPPER),
        }
    finally:
        cpu.hook_del(hook)

    return {
        "profile": "USA 4.3 Latin Base/WithZi composition boundary",
        "executableSha256": SUPPORTED_DOL,
        "input": "0x81421458", "commit": "0x81420F30", "count": "0x81420488",
        "observations": results, "syntheticSelectedStringContract": selected,
        "limits": [
            "Original engine resources and original Base/WithZi instructions run unchanged.",
            "Synthetic owner callbacks supply profile, committed text, sound and refresh.",
            "The command callback dispatches command6 to its original commit body.",
            "The selected-string case injects synthetic candidate data, not executable bytes.",
            "No full scene, physical input, asynchronous browser input or native capture is simulated.",
            "UTF-16 input counts do not establish a native clipboard/paste behavior.",
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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
