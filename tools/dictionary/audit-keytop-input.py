#!/usr/bin/env python3
"""Execute original ASCII/telephone held-key callbacks against synthetic UI objects.

This probes the original whitelist, input gates and counter predicate without
patching executable instructions. Layout lookup, pressed-owner status, counter
lookup, animations and parent dispatch are explicit host callbacks. The full
editor and physical input device are outside this probe.
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


CALLBACKS = {"ascii": 0x81415994, "phone": 0x8141B55C}
CONTEXT = 0x82F00000
PARENT = 0x82F01000
PARENT_VTABLE = 0x82F02000
BUTTON = 0x82F03000
BUTTON_VTABLE = 0x82F04000
INPUT = 0x82F05000
LAYOUT_VTABLE = 0x82F06000
PANE = 0x82F07000
ANIMATION = 0x82F08000
ANIMATION_VTABLE = 0x82F09000
STUBS = {
    0x83100000: "find_animation",
    0x83100004: "pressed_owner",
    0x83100008: "counter",
    0x8310000C: "animation",
    0x83100010: "dispatch",
    0x83100014: "animation_state",
}


def audit(state: Path, assets: Path) -> dict:
    from unicorn import UC_HOOK_CODE

    engine = OriginalDictionary(state, assets)
    cpu = engine.cpu
    registers = engine.registers
    write = engine.write_u32
    write(CONTEXT + 12, PARENT)
    write(PARENT, PARENT_VTABLE)
    write(PARENT_VTABLE + 0x20, 0x83100010)
    for offset in (0x38, 0x44):
        write(PARENT + offset, LAYOUT_VTABLE)
    write(LAYOUT_VTABLE + 0x60, 0x83100000)
    write(LAYOUT_VTABLE + 0x34, 0x83100008)
    write(BUTTON, BUTTON_VTABLE)
    write(BUTTON + 0x9C, PANE)
    write(BUTTON_VTABLE + 0x28, 0x83100004)
    write(BUTTON_VTABLE + 0x60, 0x8141B9CC)
    write(ANIMATION, ANIMATION_VTABLE)
    write(ANIMATION_VTABLE + 0x10, 0x8310000C)
    write(ANIMATION_VTABLE + 0x24, 0x83100014)
    current = {}
    requests = []

    def intercept(cpu, address, size, data):
        name = STUBS.get(address)
        if name is None:
            return
        result = 0
        if name == "find_animation":
            result = ANIMATION
        elif name == "pressed_owner":
            result = int(current.get("pressedOwner", True))
        elif name == "counter":
            result = struct.unpack(">H", cpu.mem_read(BUTTON + 0x80, 2))[0]
        elif name == "animation":
            requests.append({"animation": cpu.reg_read(registers.UC_PPC_REG_4)})
        elif name == "dispatch":
            parameter = cpu.reg_read(registers.UC_PPC_REG_5)
            if current["profile"] == "phone":
                parameter = struct.unpack(">I", cpu.mem_read(parameter, 4))[0]
            pane_name = bytes(cpu.mem_read(parameter, 32)).split(b"\0")[0].decode("ascii")
            requests.append({
                "event": cpu.reg_read(registers.UC_PPC_REG_4), "pane": pane_name,
            })
        cpu.reg_write(registers.UC_PPC_REG_3, result)
        cpu.reg_write(registers.UC_PPC_REG_PC, cpu.reg_read(registers.UC_PPC_REG_LR))

    hook = cpu.hook_add(UC_HOOK_CODE, intercept, begin=min(STUBS), end=max(STUBS))
    observations = []
    try:
        for profile, panes in {
            "ascii": ["B_key_DELETE", "B_Gkey_DELETE", "B_key_SPACE", "B_Gkey_SPACE",
                      "B_key_12", "B_key_LF", "B_key_SHIFT", "B_key_CAPS"],
            "phone": ["B_CPkey_DELETE", "B_spaceBT_JP", "B_CPkey_01", "B_CPkey_LF"],
        }.items():
            for pane in panes:
                cases = [{"counter": counter} for counter in (0, 29, 30, 35, 36, 44, 45, 54, 90)]
                cases.extend([
                    {"counter": 36, "pressedOwner": False},
                    {"counter": 36, "held": 0},
                    {"counter": 36, "held": 0x400},
                    {"counter": 36, "held": 0xC00},
                    {"counter": 36, "trigger": 0x800},
                    {"counter": 36, "trigger": 0x400},
                    {"counter": 36, "event": 4, "trigger": 0x800},
                    {"counter": 36, "event": 4, "trigger": 0x400},
                ])
                for case in cases:
                    current.clear()
                    current.update({
                        "profile": profile, "pane": pane, "event": 2,
                        "held": 0x800, "trigger": 0, "pressedOwner": True, **case,
                    })
                    cpu.mem_write(PANE + 0xB4, pane.encode() + bytes(32 - len(pane)))
                    write(INPUT, 0)
                    write(INPUT + 12, current["trigger"])
                    write(INPUT + 16, current["held"])
                    engine.call(0x8141B9CC, BUTTON, 0, current["counter"])
                    requests.clear()
                    engine.call(CALLBACKS[profile], CONTEXT, BUTTON, current["event"], INPUT)
                    observations.append({**current, "requests": list(requests)})
    finally:
        cpu.hook_del(hook)

    repeating = {"B_key_DELETE", "B_Gkey_DELETE", "B_key_SPACE", "B_Gkey_SPACE",
                 "B_CPkey_DELETE", "B_spaceBT_JP"}
    excluded = {"B_key_SHIFT", "B_key_CAPS"}
    for result in observations:
        if result["event"] == 4:
            accepted = result["pane"] not in excluded and bool(result["trigger"] & 0x800)
            # Native B reaches twelve phone keytops, independently of this held-A path.
            accepted |= (result["profile"] == "phone" and result["pane"] == "B_CPkey_01"
                         and bool(result["trigger"] & 0x400))
        else:
            accepted = result["pane"] in repeating and result["pressedOwner"]
            accepted &= bool(result["held"] & 0x800) and not result["trigger"] & 0x800
            accepted &= result["counter"] >= 30 and result["counter"] % 9 == 0
        dispatches = [request for request in result["requests"] if request.get("event") == 4]
        if len(dispatches) != int(accepted):
            raise AssertionError(f"Original keytop callback disagreed: {result}")
        pushed = [request for request in result["requests"] if request.get("animation") == 0]
        if len(pushed) != int(accepted):
            raise AssertionError(f"Original Pushed request disagreed: {result}")

    return {
        "profile": "USA 4.3 ASCII/telephone keytop callbacks",
        "executableSha256": SUPPORTED_DOL,
        "callbacks": {name: hex(address) for name, address in CALLBACKS.items()},
        "observations": observations,
        "limits": [
            "Original instructions and button counter setter run unchanged.",
            "Synthetic objects and host callbacks supply layout/pressed-owner/counter/animation/dispatch.",
            "The Japanese Space branch is probed but is not exposed by supported USA Latin profiles.",
            "This does not execute composition dispatch, a full UI loop or a physical controller.",
            "Logical counter results do not establish native captured timing or wall-clock cadence.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--assets", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = format_json(audit(args.state, args.assets))
    if args.output:
        args.output.write_text(report)
    else:
        print(report, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
