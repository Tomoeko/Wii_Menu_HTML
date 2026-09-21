"""Public retail common-key constants for local WAD preparation.

Values were checked against Dolphin IOSC::LoadDefaultEntries at revision
ee018d00e60b9eb727489908a8daec5c537f44a8:
https://github.com/dolphin-emu/dolphin/blob/ee018d00e60b9eb727489908a8daec5c537f44a8/Source/Core/Core/IOS/IOSC.cpp

The XOR representation is deliberately simple cosmetic obfuscation. It is not
encryption or a security boundary. No console-specific credentials are included.
"""

_MASK = 0xA7
_OBSCURED_RETAIL_KEYS = {
    0: (
        0x4C, 0x43, 0x8D, 0x85, 0xF9, 0x22, 0x34, 0x43,
        0xEF, 0x7E, 0x62, 0xE2, 0xD4, 0x26, 0x0D, 0x50,
    ),
    1: (
        0xC4, 0x1F, 0x8C, 0x13, 0x53, 0xC6, 0xE9, 0x89,
        0xB4, 0x55, 0x59, 0x5C, 0x1D, 0xEB, 0x3C, 0xD9,
    ),
}


def retail_common_key(index):
    """Resolve only a recognized retail ticket key index; never guess a key."""
    if index not in _OBSCURED_RETAIL_KEYS:
        raise ValueError(
            f"No built-in retail common key for index {index}; "
            "supply --common-key-file and --common-key-index for this input"
        )
    return bytes(value ^ _MASK for value in _OBSCURED_RETAIL_KEYS[index])
