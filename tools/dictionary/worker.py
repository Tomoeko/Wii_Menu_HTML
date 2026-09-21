#!/usr/bin/env python3
"""Run the user's original USA 4.3 Zi8 code in isolated PowerPC memory.

The worker supplies no guest OS or network/file-system calls. Original code and
language data come only from a validated, locally prepared System Menu WAD.
JSON lines on stdin/stdout are the complete host interface.
"""

from __future__ import annotations

import argparse
from collections import OrderedDict
import hashlib
import json
import re
from pathlib import Path
import struct
import sys

SUPPORTED_DOL = "47b9c1bb0ba1890256fb368b1b3272e33ea2467feadf39d20ce469d6de6e6c43"
LANGUAGES = {"en": (0x3B, "ENAM"), "fr": (0x40, "FRCA"), "es": (0x41, "ESSA")}
MEMORY_BASE = 0x80000000
MEMORY_SIZE = 0x04000000
TABLE = 0x82000000
CONTEXT = 0x82010000
OUTPUT = 0x82022000
RETURN = 0x83000000
CONTEXT_SIZE = 0x1B44
WRAPPER = 0x82030000
WRAPPER_SIZE = 0xAC
STRING_BUFFERS = 0x82031000
WRAPPER_GLOBALS = 0x810C65F0
WRAPPER_GLOBALS_SIZE = 0x1C80
CANDIDATES = 0x810C6DF0
MAX_SESSIONS = 16
CASE_MODES = {"title": 0, "lower": 1, "upper": 2, "unchanged": 3}


def original_executable(state_path: Path) -> bytes:
    state = json.loads(state_path.read_text())
    directory = Path(state["menu"]["contentDirectory"])
    for path in directory.glob("*.app"):
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() == SUPPORTED_DOL:
            return data
    raise ValueError("Native dictionary currently requires the verified USA 4.3 executable")


class OriginalDictionary:
    def __init__(self, state_path: Path, assets: Path):
        try:
            from unicorn import Uc, UC_ARCH_PPC, UC_MODE_32, UC_MODE_BIG_ENDIAN
            from unicorn import ppc_const
        except ImportError as error:
            raise RuntimeError(
                "Unicorn is unavailable; install tools/dictionary/requirements.txt "
                "in .local/dictionary-runtime"
            ) from error
        self.registers = ppc_const
        self.cpu = Uc(UC_ARCH_PPC, UC_MODE_32 | UC_MODE_BIG_ENDIAN)
        self.cpu.mem_map(MEMORY_BASE, MEMORY_SIZE)
        dol = original_executable(state_path)
        for index in range(18):
            offset = struct.unpack_from(">I", dol, 4 * index)[0]
            address = struct.unpack_from(">I", dol, 0x48 + 4 * index)[0]
            size = struct.unpack_from(">I", dol, 0x90 + 4 * index)[0]
            if size:
                if offset + size > len(dol) or not (
                    MEMORY_BASE <= address < address + size <= MEMORY_BASE + MEMORY_SIZE
                ):
                    raise ValueError("Invalid original DOL section")
                self.cpu.mem_write(address, dol[offset : offset + size])
        self.cpu.reg_write(ppc_const.UC_PPC_REG_MSR, 0x2000)
        self.cpu.reg_write(ppc_const.UC_PPC_REG_2, 0x8169C400)
        self.cpu.reg_write(ppc_const.UC_PPC_REG_13, 0x8169E040)
        manifest = json.loads((assets / "keyboard-dictionary.json").read_text())
        oem_data = {}
        for index, (language, (language_id, suffix)) in enumerate(LANGUAGES.items()):
            system_pointer = 0x82200000 + index * 0x100000
            system = (assets / "keyboard-dictionary" / f"eZTSystem{suffix}.zsd").read_bytes()
            oem = (assets / "keyboard-dictionary" / f"eZTNintendo{suffix}.znd").read_bytes()
            for kind, data in (("system", system), ("oem", oem)):
                expected = manifest["languages"][language][kind]["sha256"]
                if hashlib.sha256(data).hexdigest() != expected:
                    raise ValueError(f"Prepared {language} {kind} dictionary hash mismatch")
            self.cpu.mem_write(system_pointer, system)
            self.cpu.mem_write(TABLE + index * 8, bytes([language_id, 0, 0, 0]))
            self.write_u32(TABLE + index * 8 + 4, system_pointer)
            oem_data[language] = oem
        self.contexts = {}
        self.sessions = OrderedDict()
        for index, (language, oem) in enumerate(oem_data.items()):
            if self.call(0x8147C7C4, TABLE, CONTEXT) != 1:
                raise RuntimeError("Original Zi8 initialization failed")
            self.call(0x8147A5F8, 0x8165F638, 10, CONTEXT)
            pointer = 0x82600000 + index * 0x100000
            self.cpu.mem_write(pointer, oem)
            count = struct.unpack_from(">I", oem)[0]
            self.call(0x81484D2C, 0x81433A50, count, pointer, CONTEXT)
            self.contexts[language] = bytes(self.cpu.mem_read(CONTEXT, CONTEXT_SIZE))

    def write_u32(self, address: int, value: int):
        self.cpu.mem_write(address, struct.pack(">I", value))

    def call(self, address: int, *arguments: int) -> int:
        registers = self.registers
        self.cpu.reg_write(registers.UC_PPC_REG_1, 0x83300000)
        self.cpu.reg_write(registers.UC_PPC_REG_LR, RETURN)
        for index, value in enumerate(arguments):
            self.cpu.reg_write(registers.UC_PPC_REG_3 + index, value)
        self.cpu.emu_start(address, RETURN, timeout=1_000_000, count=10_000_000)
        if self.cpu.reg_read(registers.UC_PPC_REG_PC) != RETURN:
            raise RuntimeError("Original dictionary exceeded its execution limit")
        return self.cpu.reg_read(registers.UC_PPC_REG_3)

    def restore(self, session: dict):
        for address, data in session["memory"]:
            self.cpu.mem_write(address, data)

    def save(self, session: dict):
        session["memory"] = [
            (address, bytes(self.cpu.mem_read(address, size)))
            for address, size in (
                (CONTEXT, CONTEXT_SIZE),
                (WRAPPER, WRAPPER_SIZE),
                (STRING_BUFFERS, 0x2000),
                (WRAPPER_GLOBALS, WRAPPER_GLOBALS_SIZE),
            )
        ]

    def new_session(self, language: str) -> dict:
        # WithZi's constructor (0x8141BD18) also initializes the OS-backed Kana
        # converter. Latin queries do not call it. Allocate its verified fields
        # here, retaining the original vtable and unmodified Latin instructions.
        self.cpu.mem_write(WRAPPER, bytes(WRAPPER_SIZE))
        self.cpu.mem_write(STRING_BUFFERS, bytes(0x2000))
        self.cpu.mem_write(WRAPPER_GLOBALS, bytes(WRAPPER_GLOBALS_SIZE))
        self.cpu.mem_write(CONTEXT, self.contexts[language])
        self.write_u32(WRAPPER, 0x8165F678)
        self.cpu.mem_write(WRAPPER + 4, struct.pack(">H", 0x400))
        self.write_u32(WRAPPER + 8, STRING_BUFFERS)
        self.write_u32(WRAPPER + 12, STRING_BUFFERS + 0x1000)
        self.cpu.mem_write(WRAPPER + 0x78, b"\x01")
        self.write_u32(WRAPPER + 0x84, CONTEXT)
        # The language's OEM dictionary is already attached during host setup.
        self.cpu.mem_write(WRAPPER + 0x94, bytes([LANGUAGES[language][0]]))
        self.write_u32(WRAPPER + 0x9C, list(LANGUAGES).index(language))
        self.write_u32(WRAPPER + 0xA0, CASE_MODES["lower"])
        self.call(0x81433D00, WRAPPER)
        session = {"language": language, "input": [], "digits": False, "case": "lower"}
        self.save(session)
        return session

    def candidate_words(self) -> list[str]:
        count = struct.unpack(">I", self.cpu.mem_read(WRAPPER + 0x8C, 4))[0]
        if count > 40:
            raise RuntimeError("Original wrapper returned an invalid candidate count")
        return [
            bytes(self.cpu.mem_read(CANDIDATES + index * 0x80, 0x80))
            .decode("utf-16-be").split("\0")[0]
            for index in range(count)
        ]

    def query(
        self, text: str = "", language: str = "en", digits: str | None = None,
        session: str | None = None, action: str = "query", index: int | None = None,
        case: str = "lower",
    ) -> dict:
        if language not in LANGUAGES or case not in CASE_MODES:
            raise ValueError("Unsupported dictionary language or case")
        if not isinstance(text, str) or len(text.encode("utf-16-be")) > 126:
            raise ValueError("Dictionary input must contain at most 63 UTF-16 units")
        if session is not None and (
            not isinstance(session, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", session)
        ):
            raise ValueError("Invalid dictionary session")
        if action not in ("query", "reset", "accept", "close"):
            raise ValueError("Invalid dictionary action")
        if action == "accept" and (type(index) is not int or not 0 <= index < 40):
            raise ValueError("Invalid dictionary candidate selection")
        if digits is not None:
            if not isinstance(digits, str) or not re.fullmatch(r"[1-9]{1,63}", digits):
                raise ValueError("Invalid telephone prediction input")
            units = [0xEFF0 + int(digit) for digit in digits]
        else:
            encoded = text.encode("utf-16-be")
            units = list(struct.unpack(f">{len(encoded) // 2}H", encoded))
        result = {"engine": "original-zi8", "candidates": []}
        previous = self.sessions.pop(session, None) if session is not None else None
        if action == "close":
            return result
        if action == "accept" and previous is None:
            raise ValueError("Dictionary session is no longer available")
        current = previous or self.new_session(language)
        if action == "query" and current["language"] != language:
            current = self.new_session(language)
        self.restore(current)
        if action == "accept":
            words = self.candidate_words()
            if index >= len(words):
                raise ValueError("Dictionary candidate is no longer available")
            # Base command 0x15 calls getPredicted, then clearCandidates. This
            # Latin path inserts the returned text verbatim, including '>'.
            self.cpu.mem_write(OUTPUT, bytes(0x80))
            self.call(0x81434140, WRAPPER, index, OUTPUT)
            result["accepted"] = (
                bytes(self.cpu.mem_read(OUTPUT, 0x80)).decode("utf-16-be").split("\0")[0]
            )
        if action in ("reset", "accept"):
            self.call(0x81433D8C, WRAPPER)
            current["input"] = []
        else:
            telephone = digits is not None
            if telephone != current["digits"]:
                self.call(0x81433D8C, WRAPPER)
                current["input"] = []
            self.write_u32(WRAPPER + 0xA0, CASE_MODES[case])
            record = 0x81660AB8 + (int(digits[-1]) - 1) * 52 if telephone else 0
            self.write_u32(WRAPPER + 0xA4, record)
            common = 0
            for old, new in zip(current["input"], units):
                if old != new:
                    break
                common += 1
            for _ in current["input"][common:]:
                self.call(0x81434088, WRAPPER)
            for unit in units[common:]:
                self.call(0x81433F40, WRAPPER, unit)
            if units == current["input"] and current["case"] != case:
                self.call(0x814344C4, WRAPPER)
            current.update(input=units, digits=telephone, case=case)
            result["candidates"] = self.candidate_words() if units else []
        self.save(current)
        if session is not None:
            self.sessions[session] = current
            while len(self.sessions) > MAX_SESSIONS:
                self.sessions.popitem(last=False)
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--assets", type=Path, required=True)
    args = parser.parse_args()
    try:
        dictionary = OriginalDictionary(args.state, args.assets)
    except Exception as error:
        print(json.dumps({"ready": False, "error": str(error)}), flush=True)
        return 1
    print(json.dumps({"ready": True, "engine": "original-zi8"}), flush=True)
    for line in sys.stdin:
        request = {}
        try:
            if len(line) > 8192:
                raise ValueError("Dictionary request is too large")
            request = json.loads(line)
            result = dictionary.query(
                text=request.get("text", ""), language=request.get("language", "en"),
                digits=request.get("digits"), session=request.get("session"),
                action=request.get("action", "query"), index=request.get("index"),
                case=request.get("case", "lower"),
            )
            result["id"] = request["id"]
        except Exception as error:
            result = {"id": request.get("id"), "error": str(error)}
        print(json.dumps(result, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
