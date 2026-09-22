#!/usr/bin/env python3
"""Probe the original candidate-arrow input callback with synthetic UI objects.

Original instructions remain unchanged. The existing verified PowerPC harness
supplies the executable; host callbacks stand in only for layout lookup, window
animation status, animation requests and page requests. This does not simulate
the entire UI update loop or establish a wall-clock repeat interval.
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

from worker import OriginalDictionary, SUPPORTED_DOL


CALLBACK = 0x8142D824
ARROW = 0x82F00000
PARENT = 0x82F01000
PARENT_VTABLE = 0x82F02000
BUTTON = 0x82F03000
BUTTON_VTABLE = 0x82F04000
INPUT = 0x82F05000
LAYOUT_VTABLE = 0x82F06000
WINDOW = 0x82F07000
WINDOW_VTABLE = 0x82F08000
ANIMATION = 0x82F09000
ANIMATION_VTABLE = 0x82F0A000
STUBS = {
    0x83100000: "find_window",
    0x83100004: "window_busy",
    0x83100008: "animation",
    0x8310000C: "previous",
    0x83100010: "next",
}


def audit(state: Path, assets: Path) -> dict:
    from unicorn import UC_HOOK_CODE

    engine = OriginalDictionary(state, assets)
    cpu = engine.cpu
    registers = engine.registers
    write = engine.write_u32
    write(ARROW + 12, PARENT)
    write(ARROW + 28, ANIMATION)
    write(PARENT, PARENT_VTABLE)
    write(PARENT_VTABLE + 0x104, 0x81422D80)
    write(PARENT_VTABLE + 0x4C, 0x81421434)
    write(PARENT_VTABLE + 0xE8, 0x8310000C)
    write(PARENT_VTABLE + 0xE4, 0x83100010)
    # The original constructor initializes this embedded animation vtable.
    # Its original +0x14 getter reads the active byte at UITextArea +0x2C.
    write(PARENT + 0xE4 + 0x18, 0x8165D258)
    write(PARENT + 0x24, LAYOUT_VTABLE)
    write(LAYOUT_VTABLE + 0x60, 0x83100000)
    write(WINDOW, WINDOW_VTABLE)
    write(WINDOW_VTABLE + 0x18, 0x83100004)
    write(ANIMATION, ANIMATION_VTABLE)
    write(ANIMATION_VTABLE + 0x10, 0x83100008)
    write(BUTTON, BUTTON_VTABLE)
    write(BUTTON_VTABLE + 0x5C, 0x8142DA94)

    current = {}
    requests = []

    def intercept(cpu, address, size, data):
        name = STUBS.get(address)
        if name is None:
            return
        result = 0
        if name == "find_window":
            result = WINDOW
        elif name == "window_busy":
            result = int(current.get("windowBusy", False))
        elif name == "animation":
            requests.append({
                "animation": cpu.reg_read(registers.UC_PPC_REG_4),
            })
        else:
            requests.append({"page": name})
        cpu.reg_write(registers.UC_PPC_REG_3, result)
        cpu.reg_write(registers.UC_PPC_REG_PC, cpu.reg_read(registers.UC_PPC_REG_LR))

    hook = cpu.hook_add(UC_HOOK_CODE, intercept, begin=min(STUBS), end=max(STUBS))
    results = []
    movement = []
    try:
        cases = []
        for arrow in (1, 2):
            for counter in (0, 1, 19, 20, 21, 39, 40, 41, 59, 60, 61, 65535):
                cases.append({"arrow": arrow, "event": 2, "held": 0x800, "counter": counter})
            for trigger, held in ((0x800, 0x800), (0x400, 0x400), (0xC00, 0xC00)):
                for event in (2, 4):
                    cases.append({
                        "arrow": arrow, "event": event,
                        "trigger": trigger, "held": held, "counter": 1,
                    })
            for gate in ("scrolling", "windowBusy", "disabled"):
                for event in (0, 1, 2, 4):
                    cases.append({
                        "arrow": arrow, "event": event, "held": 0x800,
                        "trigger": 0x800 if event == 4 else 0, "counter": 1, gate: True,
                    })
            cases.append({"arrow": arrow, "event": 2, "held": 0xC00, "counter": 1})
            cases.append({"arrow": arrow, "event": 2, "held": 0, "counter": 1})

        for case in cases:
            current.clear()
            current.update(case)
            requests.clear()
            write(ARROW + 8, case["arrow"])
            write(INPUT, 0)
            write(INPUT + 12, case.get("trigger", 0))
            write(INPUT + 16, case.get("held", 0))
            cpu.mem_write(BUTTON + 0x80, struct.pack(">H", case.get("counter", 0)))
            cpu.mem_write(PARENT + 0x19, bytes([int(case.get("disabled", False))]))
            cpu.mem_write(PARENT + 0xE4 + 0x2C, bytes([int(case.get("scrolling", False))]))
            engine.call(CALLBACK, ARROW, BUTTON, case["event"], INPUT)
            results.append({**case, "requests": list(requests)})

        scalar = PARENT + 0xFC

        def start_movement():
            for index, value in enumerate((0.0, 200.0, 15.0), start=1):
                bits = struct.unpack(">Q", struct.pack(">d", value))[0]
                cpu.reg_write(registers.UC_PPC_REG_FPR0 + index, bits)
            engine.call(0x81420C58, scalar, 0, 1)

        # CandidateBox::calc (0x81429694) advances this scalar before the IPL
        # pointer pass. A continuing hit increments the original button counter
        # before event 2; a fresh click resets it before event 4.
        for direction in (1, 2):
            current.clear()
            write(ARROW + 8, direction)
            write(INPUT + 12, 0x800)
            write(INPUT + 16, 0x800)
            cpu.mem_write(PARENT + 0x19, b"\0")
            cpu.mem_write(scalar + 0x14, b"\0")
            engine.call(0x8141B9CC, BUTTON, 0, 0)
            requests.clear()
            engine.call(CALLBACK, ARROW, BUTTON, 4, INPUT)
            assert any("page" in request for request in requests)
            start_movement()
            write(INPUT + 12, 0)
            pages = [0]
            endpoint = []
            for update in range(1, 101):
                engine.call(0x8141F32C, scalar)
                engine.call(0x81445F64, BUTTON, 0)
                busy = engine.call(0x8141F304, scalar)
                counter = engine.call(0x8142DA94, BUTTON, 0)
                if update in (14, 15, 16):
                    endpoint.append({
                        "update": update,
                        "frame": struct.unpack(">f", cpu.mem_read(scalar + 12, 4))[0],
                        "busy": bool(busy),
                        "counter": counter,
                    })
                requests.clear()
                engine.call(CALLBACK, ARROW, BUTTON, 2, INPUT)
                if any("page" in request for request in requests):
                    pages.append(update)
                    start_movement()
            assert pages == [0, 16, 32, 48, 64, 81, 97], pages
            movement.append({"arrow": direction, "endpoint": endpoint, "pageUpdates": pages})
    finally:
        cpu.hook_del(hook)

    # Assert observations against the actual machine-code branch, rather than
    # imposing the conventional (counter % 20 == 0) repeat interpretation.
    for result in results:
        event = result["event"]
        enabled = not result.get("disabled")
        enabled &= not result.get("scrolling") or event in (0, 1)
        enabled &= not result.get("windowBusy") or event == 1
        page = enabled and (
            event == 4 and result.get("trigger", 0) == 0x800
            or event == 2 and result.get("held", 0) == 0x800
            and not result.get("trigger", 0) & 0x800
            and result.get("counter", 0) % 20 != 0
        )
        expected = []
        if page:
            expected = [
                {"animation": 0},
                {"page": "previous" if result["arrow"] == 1 else "next"},
            ]
        elif enabled and event in (0, 1):
            expected = [{"animation": 1 if event == 0 else 2}]
        if result["requests"] != expected:
            raise AssertionError(f"Original candidate callback disagreed: {result}")

    return {
        "profile": "USA 4.3 candidate-arrow callback",
        "executableSha256": SUPPORTED_DOL,
        "callback": hex(CALLBACK),
        "observations": results,
        "originalScalarAndCounterSequences": movement,
        "limits": [
            "Synthetic objects exercise the original callback and original state/counter getters.",
            "Layout lookup, window status and animation/page requests are host callbacks.",
            "Sequences execute original scalar initialization/calc and counter increment in source order.",
            "No candidate geometry, full UI frame loop, physical controller or native capture is simulated.",
            "Logical update results do not establish physical input or wall-clock cadence.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--assets", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = audit(args.state, args.assets)
    result = format_json(report)
    if args.output:
        args.output.write_text(result)
    else:
        print(result, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
