"""Read verified audio-driver tables from the user's USA 4.3 executable.

The tables stay in generated local resources. No Nintendo lookup-table contents
are embedded in this source file.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import math
from pathlib import Path
import struct


USA_43_EXECUTABLE_SHA256 = "47b9c1bb0ba1890256fb368b1b3272e33ea2467feadf39d20ce469d6de6e6c43"


def read_dol_address(data, address, size):
    """Read a virtual range only when it lies inside one complete DOL section."""
    if len(data) < 0x100 or size < 0:
        raise ValueError("Invalid executable header or requested range")
    for index in range(18):
        offset = struct.unpack_from(">I", data, index * 4)[0]
        start = struct.unpack_from(">I", data, 0x48 + index * 4)[0]
        length = struct.unpack_from(">I", data, 0x90 + index * 4)[0]
        if not length or offset < 0x100 or offset + length > len(data):
            continue
        if start <= address and address + size <= start + length:
            begin = offset + address - start
            return data[begin : begin + size]
    raise ValueError(f"Audio driver range {address:#x}+{size:#x} is outside the executable")


@dataclass(frozen=True)
class NativeAudioTables:
    attack: tuple
    sustain: tuple
    decibels: tuple
    pan: tuple
    source_sha256: str
    reverb: dict | None = None

    def volume(self, tenths_db):
        # Util::CalcVolumeRatio (0x8150F31C) clamps, truncates toward zero,
        # and looks up the original table. The envelope itself stores 0.1 dB.
        index = 904 + int(max(-904, min(60, tenths_db)))
        return self.decibels[index]

    def balance(self, pan):
        index = int((max(-1, min(1, pan)) + 1) * 128 + 0.5)
        return self.pan[index], self.pan[256 - index]


def load_native_audio_tables(content):
    content = Path(content)
    candidates = [content] if content.is_file() else sorted(
        set(content.glob("*.app")) | set(content.glob("*.dol"))
    )
    for path in candidates:
        if path.stat().st_size > 64 * 1024 * 1024:
            continue
        data = path.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        if digest != USA_43_EXECUTABLE_SHA256:
            continue

        def floats(address, count):
            return struct.unpack(f">{count}f", read_dol_address(data, address, count * 4))

        tables = NativeAudioTables(
            attack=floats(0x8161E3F0, 128),
            sustain=struct.unpack(">128h", read_dol_address(data, 0x8161E2F0, 256)),
            decibels=floats(0x8161EAD8, 965),
            pan=floats(0x8161F9EC, 257),
            source_sha256=digest,
            reverb={
                # System::initFx selects ReverbHi's fused mode zero. Keep the
                # original delay lengths and preset out of authored source.
                "delayFrames": struct.unpack(">8I", read_dol_address(data, 0x81685DA0, 32)),
                "preset": floats(0x8160F048, 6),
            },
        )
        if not all(math.isfinite(value) for value in tables.attack + tables.decibels + tables.pan):
            raise ValueError("Nonfinite native audio lookup table")
        return tables
    raise ValueError(
        "Built-in background rendering needs the supplied USA 4.3 System Menu executable. "
        "Prepare its WAD first, or pass --native-content with its extracted content directory."
    )
