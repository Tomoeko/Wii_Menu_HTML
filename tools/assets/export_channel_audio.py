#!/usr/bin/env python3
"""Decode original local channel sound.bin resources with the built-in converter."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from export import ROOT, write_json
from export_audio import write_wav
from formats import u8_files
from channels_export import read_metadata, unwrap_resource
from channel_audio import decode_channel_audio


def export_channel_audio(nand, output):
    manifest_path = output / "channels.json"
    manifest = json.loads(manifest_path.read_text())
    sounds = {}
    for channel in manifest["channels"]:
        source = nand / channel["source"]["file"]
        data = source.read_bytes()
        metadata = read_metadata(data, manifest.get("language", "ENG"))
        if metadata is None:
            raise ValueError(f'Channel {channel["id"]} has no IMET metadata')
        files = u8_files(data[metadata["archiveOffset"] :])
        resource = files.get("meta/sound.bin")
        if resource is None:
            channel.pop("audio", None)
            continue
        payload = unwrap_resource(resource)
        decoded = decode_channel_audio(payload)
        destination = f'channel-audio/{channel["id"]}.wav'
        target = output / destination
        target.parent.mkdir(parents=True, exist_ok=True)
        write_wav(target, decoded.pcm, decoded.sample_rate)
        sound = {
            "src": "/assets/" + destination,
            **decoded.metadata(),
            "source": channel["source"]["file"] + "/meta/sound.bin",
            "sha256": hashlib.sha256(resource).hexdigest(),
            "sourceSha256": channel["source"]["sha256"],
            "sourceFormat": decoded.source_format,
            "rendering": (
                "Decoded original channel audio with the built-in converter; no resynthesis."
            ),
        }
        print(
            f'{channel["shortId"]}: {sound["duration"]:.3f}s, '
            f'{sound["sampleRate"]} Hz, loop={sound["loop"]}'
        )
        sounds[channel["id"]] = sound
        channel["audio"] = sound
    write_json(output / "channel-audio.json", sounds)
    write_json(manifest_path, manifest)
    return sounds


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--nand", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "web/public/assets")
    args = parser.parse_args()
    export_channel_audio(args.nand, args.output)


if __name__ == "__main__":
    main()
