#!/usr/bin/env python3
"""Probe original text-point command gates without inventing a native drag owner.

The original Base/layout dispatch, IPL command delegate, buffer reset, caret
setter/getter and selection flag routines execute unchanged. A synthetic layout maps x to a character index and
supplies origin/sound/refresh callbacks. Its observer list is empty: scene-level
activation still requires separate source or native-capture evidence.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import struct

from worker import CANDIDATES, OriginalDictionary, SUPPORTED_DOL, WRAPPER


BASE = 0x82F00000
BASE_VTABLE = 0x82F01000
BUFFER = 0x82F02000
TEXT = 0x82F03000
KANA = 0x82F04000
KANA_VTABLE = 0x82F05000
MANAGER = 0x82F06000
MANAGER_VTABLE = 0x82F07000
DEVICE = 0x82F08000
POINT = 0x82F09000
BUFFER_VTABLE = 0x82F0A000
IPL_CALLBACK = 0x82F0B000
DISPATCHERS = {
    0x8141C9D4: "Base",
    0x81426C80: "LayoutByNW4R",
    0x8144133C: "Memo/Letter editing",
}
STUBS = {
    0x83100000: "command",
    0x83100004: "point_index",
    0x83100008: "origin",
    0x8310000C: "sound",
    0x83100010: "refresh",
    0x83100014: "device",
    0x83100018: "kana_reset",
    0x8310001C: "text_editable",
    0x83100020: "reset_timer",
    0x83100024: "row_limit",
}


def audit(state: Path, assets: Path) -> dict:
    from unicorn import UC_HOOK_CODE

    engine = OriginalDictionary(state, assets)
    cpu, registers, write = engine.cpu, engine.registers, engine.write_u32
    write(BASE, BASE_VTABLE)
    write(BASE + 0x164, BUFFER)
    write(BASE + 0x168, KANA)
    write(BASE + 0x16C, WRAPPER)
    write(BASE + 0x174, 2)
    write(BASE + 0x1D4, MANAGER)
    write(BASE + 0x1F0, 2)
    write(BASE + 0x1B8, 1024)
    write(BASE + 0x22C, IPL_CALLBACK)
    write(BASE + 0x3FC, 2)
    write(IPL_CALLBACK, 0x81638E3C)
    cpu.mem_write(BUFFER_VTABLE, bytes(cpu.mem_read(0x8165F518, 0x100)))
    write(BUFFER, BUFFER_VTABLE)
    # UI field availability and its timer are independent of the selection
    # flag under investigation; avoid requiring booted native OS clock state.
    write(BUFFER_VTABLE + 0xB8, 0x83100020)
    write(BUFFER_VTABLE + 0xC0, 0x8310001C)
    cpu.mem_write(BUFFER + 4, struct.pack(">H", 64))
    write(BUFFER + 8, TEXT)
    write(BUFFER + 12, TEXT + 0x400)
    write(KANA, KANA_VTABLE)
    write(KANA_VTABLE + 0x128, 0x83100018)
    write(MANAGER, MANAGER_VTABLE)
    write(MANAGER_VTABLE + 0x6C, 0x83100014)
    for offset, stub in ((0x18, 0x83100000), (0x180, 0x83100004),
                         (0x184, 0x83100008), (0x178, 0x8310000C),
                         (0xD8, 0x83100010), (0x118, 0x83100024)):
        write(BASE_VTABLE + offset, stub)
    write(BASE_VTABLE + 0x2C8, 0x8144139C)
    engine.call(0x8143BF7C, BASE)
    events = []
    command_entry = 0x8141C9D4

    def intercept(cpu, address, size, data):
        name = STUBS.get(address)
        if name == "command":
            events.append({"command": cpu.reg_read(registers.UC_PPC_REG_4)})
            cpu.reg_write(registers.UC_PPC_REG_PC, command_entry)
            return
        result = 0
        if name == "point_index":
            bits = cpu.reg_read(registers.UC_PPC_REG_FPR1)
            coordinate = struct.unpack(">d", struct.pack(">Q", bits))[0]
            units = struct.unpack(">H", cpu.mem_read(BUFFER + 6, 2))[0]
            result = max(0, min(units, round(coordinate)))
            events.append({"pointIndex": result})
        elif name == "origin":
            cpu.reg_write(registers.UC_PPC_REG_4, 0)
        elif name == "sound":
            events.append({"sound": cpu.reg_read(registers.UC_PPC_REG_4)})
        elif name == "device":
            result = DEVICE
        elif name == "text_editable":
            result = 1
        cpu.reg_write(registers.UC_PPC_REG_3, result)
        cpu.reg_write(registers.UC_PPC_REG_PC, cpu.reg_read(registers.UC_PPC_REG_LR))

    hook = cpu.hook_add(UC_HOOK_CODE, intercept, begin=min(STUBS), end=max(STUBS))
    observations = []
    composition_observations = []
    try:
        for command_entry in DISPATCHERS:
            for diagnostic_selection in (False, True):
                engine.call(0x8141F474, BUFFER)
                assert bytes(cpu.mem_read(BUFFER + 0x20, 1)) == b"\0"
                cpu.mem_write(TEXT, "abcdef\0".encode("utf-16-be"))
                cpu.mem_write(BUFFER + 6, struct.pack(">H", 6))
                if diagnostic_selection:
                    # Diagnostic only: no reachable ordinary USA editor caller of
                    # this activation has been established by this audit.
                    engine.call(0x81433394, BUFFER)
                for command, x in ((0xE, 1), (0x10, 4), (0x10, 4), (0xF, 5)):
                    events.clear()
                    cpu.mem_write(POINT, struct.pack(">ff", x, 0))
                    engine.call(command_entry, BASE, command, POINT)
                    cursor, anchor = struct.unpack(">II", cpu.mem_read(BUFFER + 0x18, 8))
                    selection = bytes(cpu.mem_read(BUFFER + 0x20, 1))[0]
                    observations.append({
                        "dispatch": DISPATCHERS[command_entry],
                        "diagnosticSelectionEnabled": diagnostic_selection,
                        "command": command, "x": x, "cursor": cursor,
                        "anchor": anchor, "selectionFlag": selection,
                        "events": list(events),
                    })
                    if not diagnostic_selection:
                        assert cursor == anchor == 1 and selection == 0
                        assert events == ([{"pointIndex": 1}, {"sound": 5}, {"command": 12}]
                                          if command == 0xE else [])
                    else:
                        assert cursor == x and anchor == 0 and selection == 1
                        if command == 0xF:
                            assert events == [{"pointIndex": 5}, {"command": 13}]
                assert observations[-2]["events"] == (
                    [{"pointIndex": 4}] if diagnostic_selection else []
                ), "holding over the same index must not replay the cursor cue"

        for command_entry in DISPATCHERS:
            for phone in (False, True):
                for x in (0, 3, 20):
                    engine.query(text="hel", digits="435" if phone else None)
                    # Test the selection contract independently of vocabulary:
                    # the injected full word is synthetic candidate data only.
                    cpu.mem_write(CANDIDATES + 0x80, "hello\0".encode("utf-16-be"))
                    engine.call(0x8141EA80, WRAPPER, 1)
                    engine.call(0x8141F474, BUFFER)
                    cpu.mem_write(TEXT, "abYZ\0".encode("utf-16-be"))
                    cpu.mem_write(BUFFER + 6, struct.pack(">H", 4))
                    engine.call(0x8143337C, BUFFER, 2)
                    cpu.mem_write(BASE + 0x178, b"\1")
                    events.clear()
                    cpu.mem_write(POINT, struct.pack(">ff", x, 0))
                    engine.call(command_entry, BASE, 0xE, POINT)
                    committed = bytes(cpu.mem_read(TEXT, 128)).decode("utf-16-be").split("\0")[0]
                    cursor, anchor = struct.unpack(">II", cpu.mem_read(BUFFER + 0x18, 8))
                    units = engine.call(0x81420488, WRAPPER)
                    assert committed == "abhelloYZ", committed
                    assert cursor == anchor == 7 and units == 0
                    assert events == [{"sound": 9}, {"command": 6}], events
                    first_events = list(events)
                    events.clear()
                    engine.call(command_entry, BASE, 0xE, POINT)
                    second_cursor = struct.unpack(">I", cpu.mem_read(BUFFER + 0x18, 4))[0]
                    expected_cursor = min(9, x)
                    assert second_cursor == expected_cursor
                    assert events == [
                        {"pointIndex": expected_cursor}, {"sound": 5}, {"command": 12},
                    ], events
                    composition_observations.append({
                        "dispatch": DISPATCHERS[command_entry],
                        "input": "phone" if phone else "qwerty", "x": x,
                        "literalBefore": "abYZ", "literalCursorBefore": 2,
                        "syntheticSelectedIndex": 1, "syntheticSelectedString": "hello",
                        "literalAfter": committed, "cursorAfter": cursor,
                        "compositionUnitsAfter": units, "events": first_events,
                        "secondPressCursor": second_cursor, "secondPressEvents": list(events),
                    })
    finally:
        cpu.hook_del(hook)
    return {
        "schemaVersion": 1, "source": "USA 4.3 original System Menu executable",
        "dolSha256": SUPPORTED_DOL,
        "entryPoints": {"baseCommand": "0x8141C9D4", "layoutCommand": "0x81426C80",
                        "memoLetterCommand": "0x8144133C", "editingCommand": "0x8144139C",
                        "iplCommandCallback": "0x81354D20", "bufferReset": "0x8141F474",
                        "diagnosticSelectionStart": "0x81433394"},
        "observations": observations,
        "compositionObservations": composition_observations,
        "limits": [
            "Synthetic layout index/origin, field bounds/timer and sound/refresh callbacks; empty Base observer list.",
            "LayoutByNW4R's original IPL command delegate executes unchanged in its cases.",
            "Composition cases execute original literal insertion and WithZi commit/clear with a synthetic selected candidate.",
            "The true-flag cases demonstrate a gated branch, not a reachable native scene action.",
            "Native scene activation, clipping and outside-pane scroll remain unverified.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--assets", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = audit(args.state, args.assets)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    count = len(result["observations"]) + len(result["compositionObservations"])
    print(f"Verified {count} original text-point command cases")


if __name__ == "__main__":
    main()
