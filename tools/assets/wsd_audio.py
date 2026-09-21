"""Stage the four verified finite WSD voices without changing prepared audio."""
from array import array
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import sys

from export_audio import Archive
from native_audio_tables import load_native_audio_tables
from sequence_audio import RENDERER_VERSION


SUPPORTED_SYMBOLS = {
    "WSD_SELECT", "WIPL_SE_SK_PAGE_CHG", "WIPL_ME_NO_DISC_BANNER", "WIPL_SE_BOARD_SELECT",
}


def read_wsd_voice(archive, symbol):
    """Read the original v1.2 fields; reject unaudited voices, not their parameters."""
    sound = archive.sounds[symbol]
    if symbol not in SUPPORTED_SYMBOLS or sound["type"] != 3:
        raise ValueError("Unsupported direct WSD sound")
    resource = archive.file(sound["file"])
    header = resource["header"]
    if archive.data[header:header + 4] != b"RWSD" or archive.data[header + 6:header + 8] != b"\x01\x02":
        raise ValueError("Direct WSD stage requires original version 1.2 fields")
    data = header + archive.u32(header + 16) + 8
    wsd = archive.refs(data, data)[archive.u32(sound["extra"])]
    info = archive.ref(wsd, data)
    notes = archive.refs(archive.ref(wsd + 16, data), data)
    if len(notes) != 1:
        raise ValueError("Direct WSD stage requires one finite note")
    note = notes[0]
    # Original readers: 0x81510908–3C and 0x815109C8. WsdTrack::Parse
    # applies ADSR and starts length -1 (0x81511F50–8C). Keep note metadata
    # checks explicit even though all admitted voices use its unity defaults.
    fields = {
        "pitch": struct.unpack_from(">f", archive.data, info)[0],
        "pan": archive.data[info + 4],
        "surroundPan": archive.data[info + 5],
        "auxiliarySends": list(archive.data[info + 6:info + 9]),
        "mainSend": archive.data[info + 9],
        "envelope": list(archive.data[note + 4:note + 8]),
        "archiveVolume": sound["volume"],
    }
    if (fields["pitch"] != 1 or fields["pan"] != 64 or fields["surroundPan"] != 0
            or fields["auxiliarySends"] != [0, 0, 0] or fields["mainSend"] != 127
            or fields["envelope"] != [127, 127, 127, 127]
            or list(archive.data[note + 12:note + 16]) != [60, 127, 64, 0]
            or struct.unpack_from(">f", archive.data, note + 16)[0] != 1
            or not 0 <= sound["volume"] <= 127):
        raise ValueError("Direct WSD voice has unaudited channel parameters")
    wave_table = header + archive.u32(header + 24)
    wave_info = wave_table + archive.u32(wave_table + 12 + archive.u32(note) * 4)
    pcm, rate, looping = archive.decode_wave(wave_info, resource["wave"])
    if looping or rate not in (32000, 44100) or len(pcm) not in (1, 2):
        raise ValueError("Direct WSD voice requires an audited finite source wave")
    return fields, pcm, rate


def export_wsd_resources(archive, tables, output, *, symbol, name):
    if not re.fullmatch(r"[A-Za-z0-9_-]+", name):
        raise ValueError("Invalid WSD asset name")
    fields, pcm, rate = read_wsd_voice(archive, symbol)
    directory = output / "audio/wsd" / name
    directory.mkdir(parents=True, exist_ok=True)
    samples = array("h", (sample for frame in zip(*pcm) for sample in frame))
    if sys.byteorder != "little":
        samples.byteswap()
    wave_bytes = samples.tobytes()
    (directory / "wave.pcm").write_bytes(wave_bytes)
    definition = {
        "schemaVersion": 1,
        "sourceKind": "wsd",
        "sourceSymbol": symbol,
        "sampleRate": 32000,
        "outputMode": "stereo",
        **fields,
        "waves": [{
            "src": f"/assets/audio/wsd/{name}/wave.pcm",
            "rate": rate, "channels": len(pcm), "frames": len(pcm[0]),
            "sha256": hashlib.sha256(wave_bytes).hexdigest(),
        }],
        "tables": {"attack": tables.attack, "sustain": tables.sustain,
                   "decibels": tables.decibels, "pan": tables.pan},
        "rendererVersion": RENDERER_VERSION,
        "sourceArchiveSha256": hashlib.sha256(archive.data).hexdigest(),
        "sourceDriverSha256": tables.source_sha256,
    }
    (output / "audio" / f"{name}-wsd.json").write_text(json.dumps(definition, indent=2) + "\n")
    return definition


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--native-content", type=Path, required=True)
    parser.add_argument("--assets", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    assets, output = args.assets.resolve(), args.output.resolve()
    if output == assets or assets in output.parents:
        raise ValueError("WSD resources require a separate staging directory")
    if output.exists() and any(output.iterdir()):
        raise ValueError("WSD resources require an empty staging directory")
    archive = Archive(args.archive)
    tables = load_native_audio_tables(args.native_content)
    catalog = json.loads((assets / "audio.json").read_text())
    staged = []
    for name, asset in catalog.items():
        if asset.get("rendering") != "decoded-original-wave":
            continue
        symbol = asset["sourceSymbol"]
        if symbol not in SUPPORTED_SYMBOLS:
            continue
        if asset.get("gain") != archive.sounds[symbol]["volume"] / 127:
            raise ValueError("WSD archive volume differs from the prepared catalog")
        export_wsd_resources(archive, tables, output, symbol=symbol, name=name)
        staged.append(name)
    print(json.dumps({"voices": staged}))


if __name__ == "__main__":
    main()
