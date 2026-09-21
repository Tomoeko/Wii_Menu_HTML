#!/usr/bin/env python3
"""Export HOME captions and original remote-speaker PCM from supplied resources."""

from __future__ import annotations

import csv
import hashlib
import io
from pathlib import Path
import struct
import wave

from formats import u8_files

LANGUAGES = ("JPN", "ENG", "GER", "FRA", "SPA", "ITA", "NED", "ZHS", "ZHT", "KOR")
MESSAGE_NAMES = ("reconnect", "disconnecting", "returnToMenu", "resetSoftware")
SPEAKER_FILES = {
    "HOME_SPEAKER_VOLUME": "volume.bwav",
    **{f"HOME_SPEAKER_CONNECT{player}": f"connect{player}.bwav" for player in range(1, 5)},
}
SPEAKER_SAMPLE_RATE = 6000


def parse_home_messages(data: bytes, language: str = "ENG") -> dict[str, str]:
    """The original table has four quoted rows and ten language columns."""
    try:
        column = LANGUAGES.index(language.upper())
    except ValueError as error:
        raise ValueError(f"Unsupported HOME caption language: {language}") from error
    rows = list(csv.reader(io.StringIO(data.decode("utf-16")), delimiter="\t"))
    if len(rows) != len(MESSAGE_NAMES) or any(len(row) != len(LANGUAGES) for row in rows):
        raise ValueError("Unexpected HOME caption table shape")
    return {name: row[column].replace("\r\n", "\n") for name, row in zip(MESSAGE_NAMES, rows)}


def write_speaker_pcm(data: bytes, destination: Path) -> None:
    if not data or len(data) % 2:
        raise ValueError("Remote-speaker PCM must contain complete signed 16-bit samples")
    # RemoteSpk::UpdateSpeaker (USA 4.3, 0x81378F98) reads 40 big-endian
    # samples per 6.666667ms alarm, then encodes ADPCM for the physical remote.
    # Browser output preserves the source PCM; it does not model its speaker.
    samples = struct.unpack(f">{len(data) // 2}h", data)
    with wave.open(str(destination), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(SPEAKER_SAMPLE_RATE)
        output.writeframes(struct.pack(f"<{len(samples)}h", *samples))


def export_home_resources(files: dict[str, bytes], output: Path, language: str = "ENG") -> dict:
    result = {"messages": {}, "audio": {}}
    if "homebutton/home.csv" in files:
        result["messages"] = parse_home_messages(files["homebutton/home.csv"], language)
    archive = files.get("homebutton/SpeakerSe.arc")
    if archive is None:
        return result
    samples = u8_files(archive)
    directory = output / "audio" / "remote"
    directory.mkdir(parents=True, exist_ok=True)
    for symbol, filename in SPEAKER_FILES.items():
        data = samples.get(filename)
        if data is None:
            raise ValueError(f"Missing original remote-speaker sample: {filename}")
        write_speaker_pcm(data, directory / (Path(filename).stem + ".wav"))
        result["audio"][symbol] = {
            "src": f"/assets/audio/remote/{Path(filename).stem}.wav",
            "source": f"homebutton/SpeakerSe.arc/{filename}",
            "sha256": hashlib.sha256(data).hexdigest(),
            "gain": 1,
            "rendering": "original-6000Hz-PCM-without-remote-speaker-acoustics",
        }
    return result
