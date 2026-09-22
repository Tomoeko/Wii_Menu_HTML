#!/usr/bin/env python3
"""Capture the supplied WAD in an explicitly selected isolated Dolphin profile."""

from __future__ import annotations

try:
    from tools.json_format import format_json
except ModuleNotFoundError:  # Direct execution from a tools subdirectory.
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from json_format import format_json

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shlex
import struct
import subprocess
import sys


from reference_paths import PACKAGE_ROOT as ROOT
from native_processes import find_profile_process

BASE = ROOT / "artifacts/captures"


def command(options, output: Path, save_state: Path | None = None) -> list[str]:
    args = [
        str(options.emulator),
        "-u",
        str(options.profile),
        "-e",
        str(options.wad),
        "-v",
        options.video_backend,
    ]
    settings = {
        "Dolphin.Core.CPUThread": "False",
        "Dolphin.Interface.ConfirmStop": "False",
        "Dolphin.Interface.PauseOnFocusLost": "False",
        "Dolphin.Display.RenderToMain": "True",
        "SYSCONF.IPL.AR": "True" if options.aspect == "16:9" else "False",
        "SYSCONF.IPL.LNG": "1",
        "GFX.Settings.InternalResolution": "1",
        "GFX.Settings.MSAA": "1",
        "GFX.Settings.SSAA": "False",
        "GFX.Settings.HiresTextures": "False",
        "GFX.Hacks.SkipDuplicateXFBs": "False",
        "Dolphin.Movie.DumpFrames": "True",
        "Dolphin.Movie.DumpFramesSilent": "True",
        "GFX.Settings.DumpFramesAsImages": "True",
        "GFX.Settings.FrameDumpsResolutionType": "2",  # Native raw XFB pixels.
        "Dolphin.General.DumpPath": str(output) + "/",
        "Dolphin.DSP.DumpAudio": "True",
        "Dolphin.DSP.DumpAudioSilent": "True",
        "Logger.Options.WriteToFile": "True",
        "Logger.Options.WriteToConsole": "True",
        "Logger.Options.Verbosity": "4",
        "Logger.Logs.BOOT": "True",
        "Logger.Logs.CORE": "True",
        "Logger.Logs.IOS": "True",
        "Logger.Logs.IOS_ES": "True",
        "Logger.Logs.IOS_FS": "True",
        "Logger.Logs.FRAMEDUMP": "True",
    }
    if options.cpu_core is not None:
        settings["Dolphin.Core.CPUCore"] = str(options.cpu_core)
    if options.background_input:
        settings["Dolphin.Input.BackgroundInput"] = "True"
    for name, value in settings.items():
        args += ["-C", f"{name}={value}"]
    if save_state:
        args += ["-s", str(save_state)]
    return args


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--emulator", type=Path, required=True, help="Dolphin executable")
    parser.add_argument(
        "--profile", type=Path, required=True, help="Isolated copied user directory"
    )
    parser.add_argument("--wad", type=Path, required=True, help="System Menu WAD")
    parser.add_argument("--video-backend", default="Metal")
    parser.add_argument("--cpu-core", type=int, help="Optional emulator-specific CPU core ID")
    parser.add_argument(
        "--background-input",
        action="store_true",
        help="Accept capture-control input while the isolated render window lacks focus",
    )
    parser.add_argument(
        "--runtime-version",
        default="unspecified",
        help="Version/revision identifying the emulator build",
    )
    parser.add_argument("--output", type=Path, help="New capture directory; must not already exist")
    parser.add_argument("--save-state", type=Path, help="Optional local state to load after boot")
    parser.add_argument(
        "--aspect",
        choices=["16:9", "4:3"],
        default="16:9",
        help="Wii display mode (raw XFB pixels remain anamorphic)",
    )
    parser.add_argument(
        "--print-command", action="store_true", help="Print only; do not create files or launch"
    )
    options = parser.parse_args()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    output = (options.output or BASE / stamp).resolve()
    options.emulator = options.emulator.resolve()
    options.profile = options.profile.resolve()
    options.wad = options.wad.resolve()
    save_state = options.save_state.resolve() if options.save_state else None
    args = command(options, output, save_state)
    if options.print_command:
        print(shlex.join(args))
        return 0
    for required in (
        options.emulator,
        options.wad,
        options.profile / "Wii/title/00000001/00000002/content/title.tmd",
    ):
        if not required.exists():
            parser.error(f"Missing local reference input: {required}")
    if save_state and not save_state.is_file():
        parser.error(f"Missing save state: {save_state}")
    try:
        existing_pid = find_profile_process(options.emulator, options.profile)
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        parser.error(f"Could not check the selected isolated profile: {error}")
    if existing_pid is not None:
        parser.error(
            f"The selected isolated profile is already running (PID {existing_pid}); "
            "close that instance first."
        )
    if output.exists():
        parser.error(f"Capture directory already exists: {output}")
    output.mkdir(parents=True)
    metadata = {
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "runtimeVersion": options.runtime_version,
        "emulatorSha256": hashlib.sha256(options.emulator.read_bytes()).hexdigest(),
        "wadSha256": hashlib.sha256(options.wad.read_bytes()).hexdigest(),
        "runtime": "Dolphin executing the supplied WAD",
        "videoBackend": options.video_backend,
        "cpuCore": options.cpu_core,
        "backgroundInput": options.background_input,
        "capture": "Ordered presented-XFB PNGs, native internal resolution, raw XFB pixels, duplicate-XFB skipping disabled. Ordinals are not wall-clock timestamps.",
        "videoMode": f"USA NTSC, {options.aspect}",
        "saveStateSha256": (
            hashlib.sha256(save_state.read_bytes()).hexdigest() if save_state else None
        ),
    }
    metadata_path = output / "capture-session.json"
    metadata_path.write_text(format_json(metadata))
    print(
        f"Frames: {output / 'Frames'}\nAudio: {output / 'Audio'}\nMetadata: {metadata_path}",
        flush=True,
    )
    with (output / "launcher.log").open("w") as log:
        process = subprocess.Popen(args, stdout=log, stderr=subprocess.STDOUT)
        try:
            return_code = process.wait()
        except KeyboardInterrupt:
            process.terminate()
            return_code = process.wait()
    metadata.update(endedAt=datetime.now(timezone.utc).isoformat(), exitCode=return_code)
    # The backend can flush queued XFB images during shutdown. Count only after
    # process completion and record the actual PNG size, not an assumed mode.
    frames = list((output / "Frames").glob("framedump_*.png"))
    if frames:
        metadata["finalImageCount"] = len(frames)
        metadata["finalImageOrdinal"] = max(int(frame.stem.rsplit("_", 1)[1]) for frame in frames)
        with frames[0].open("rb") as frame:
            header = frame.read(24)
        if header[:8] == b"\x89PNG\r\n\x1a\n":
            metadata["measuredImageSize"] = list(struct.unpack(">II", header[16:24]))
    metadata_path.write_text(format_json(metadata))
    return return_code


if __name__ == "__main__":
    sys.exit(main())
