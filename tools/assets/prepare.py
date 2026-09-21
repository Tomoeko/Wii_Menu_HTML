#!/usr/bin/env python3
"""Prepare browser resources from user-supplied WADs; never downloads assets or keys."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

from channel_storage import nand_storage, validate_storage, wad_storage
from channels_export import LANGUAGES, export_channels
from common_keys import retail_common_key
from export import ROOT, DEFAULT_PACKAGES, export, write_json
from export_channel_audio import export_channel_audio
from export_shared_fonts import export_shared_fonts
from export_keyboard_dictionary import export_keyboard_dictionary
from export_outline_fonts import export_outline_fonts
from export_restart import export_restart_resources
from formats import u8_files
from nand_import import has_banner, import_nand, nand_directory
from preparation_transaction import preparation_workspace, publish_preparation, recover_preparation
from wad import extract_wad, parse_tmd, parse_wad, read_common_key

SYSTEM_MENU = "0000000100000002"


def load_state(local):
    path = local / "prepare.json"
    state = (
        json.loads(path.read_text())
        if path.exists()
        else {
            "schemaVersion": 1,
            "menu": None,
            "channels": {},
            "removedChannels": [],
            "language": "ENG",
        }
    )
    if not isinstance(state, dict) or not isinstance(state.get("channels"), dict):
        raise ValueError("Invalid local preparation state")
    normalized = {}
    for title, descriptor in state["channels"].items():
        if not re.fullmatch("[0-9a-fA-F]{16}", title) or not isinstance(descriptor, dict):
            raise ValueError("Invalid title entry in local preparation state")
        canonical = title.lower()
        if canonical in normalized and normalized[canonical] != descriptor:
            raise ValueError("Conflicting duplicate title IDs in local preparation state")
        normalized[canonical] = descriptor
    state["channels"] = normalized
    state["removedChannels"] = list(dict.fromkeys(
        title.lower() for title in state.get("removedChannels", [])
    ))
    state.setdefault("language", "ENG")
    return state


def archive_members(path):
    with path.open("rb") as stream:
        magic = stream.read(4)
    return u8_files(path.read_bytes()) if magic == b"U\xaa8-" else {}


def discover_menu(content_directory):
    for path in sorted(content_directory.glob("*.app")):
        files = archive_members(path)
        if "layout/common/chanSel.ash" in files:
            return path, files
    raise ValueError(
        "The supplied System Menu title contains no supported layout/common/chanSel.ash archive"
    )


def discover_fonts(content_directory):
    for path in sorted(content_directory.glob("*.app")):
        files = archive_members(path)
        if "wbf1.brfna" in files and "wbf2.brfna" in files:
            return path
    return None


def import_wad(path, local, key, key_index, menu=False):
    metadata, _, ticket = parse_wad(path.read_bytes())
    title = metadata["titleId"]
    key_index = ticket[0xB1] if key_index is None else key_index
    if key is None:
        key = retail_common_key(key_index)
    if menu != (title == SYSTEM_MENU):
        raise ValueError(
            "Expected a System Menu WAD"
            if menu
            else "System Menu WAD cannot be imported as a channel"
        )
    metadata, directory = extract_wad(path, local / "titles", key, key_index)
    if not menu and not any(has_banner(p) for p in directory.glob("*.app")):
        raise ValueError(f"Title {title} has no channel icon/banner metadata")
    print(f'Validated {title}: {len(metadata["contents"])} contents match TMD SHA-1')
    return title, {
        "contentDirectory": str(directory.resolve()),
        "source": path.name,
        "sha256": metadata["wadSha256"],
        "kind": "wad",
        "storage": wad_storage(metadata, (directory / "title.tmd").read_bytes()),
    }


def build_channel_tree(local, state):
    """Copy only banner-bearing content and placement data into managed scratch space."""
    target = local / "channel-tree"
    with tempfile.TemporaryDirectory(prefix=".catalog-", dir=local) as temporary:
        staged = Path(temporary) / "nand"
        (staged / "title").mkdir(parents=True)
        for title, descriptor in state["channels"].items():
            if not re.fullmatch("[0-9a-f]{16}", title):
                raise ValueError("Invalid title ID in local preparation state")
            destination = staged / "title" / title[:8] / title[8:] / "content"
            for path in Path(descriptor["contentDirectory"]).glob("*.app"):
                if has_banner(path):
                    destination.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(path, destination / path.name)
        saved = Path(state.get("savedLayoutFile") or (
            str(Path(state["nand"]) / "title/00000001/00000002/data/iplsave.bin")
            if state.get("nand") else ""
        ))
        if saved.is_file():
            destination = staged / "title/00000001/00000002/data/iplsave.bin"
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(saved, destination)
        if target.exists():
            shutil.rmtree(target)
        staged.rename(target)
    return target


def upgrade_storage_metadata(state):
    """Read complete legacy sources without rewriting their original contents."""
    for title, descriptor in state["channels"].items():
        if descriptor.get("storage") is not None:
            validate_storage(descriptor["storage"])
            continue
        directory = Path(descriptor["contentDirectory"])
        tmd = directory / "title.tmd"
        if not tmd.is_file():
            continue
        if descriptor.get("kind") == "wad":
            raw_tmd = tmd.read_bytes()
            metadata = parse_tmd(raw_tmd)
            if metadata["titleId"] != title:
                raise ValueError("Stored channel TMD title ID disagrees with preparation state")
            descriptor["storage"] = wad_storage(metadata, raw_tmd)
        elif (directory.name == "content" and directory.parent.name.lower() == title[8:]
              and directory.parent.parent.name.lower() == title[:8]
              and directory.parent.parent.parent.name == "title"):
            storage = nand_storage(directory, directory.parents[3], title)
            if storage is not None:
                descriptor["storage"] = storage


def export_catalog(local, state, output):
    upgrade_storage_metadata(state)
    nand = build_channel_tree(local, state)
    if state["channels"]:
        catalog = export_channels(nand, output, state["language"])
        for channel in catalog["channels"]:
            storage = state["channels"][channel["id"]].get("storage")
            if storage is not None:
                channel["storage"] = validate_storage(storage)
                channel["blocks"] = storage["blocks"]
            else:
                channel["warnings"].append(
                    "Channel block count unavailable: reimport a complete source NAND or WAD."
                )
        # Newly imported channels remain available even when absent from an old save.
        placed = set(catalog["defaultOrder"])
        catalog["defaultOrder"].extend(
            c["id"]
            for c in catalog["channels"]
            if c["id"] not in placed and c.get("preferred", True)
        )
        write_json(output / "channels.json", catalog)
        export_channel_audio(nand, output)
    else:
        catalog = {
            "schemaVersion": 1,
            "language": state["language"],
            "channels": [],
            "defaultOrder": [],
            "savedLayout": None,
            "warnings": [],
            "notes": [
                "Disc-only catalog. System Menu WADs do not include separate channel applications; import channel WADs or a decrypted NAND."
            ],
        }
        write_json(output / "channels.json", catalog)
        write_json(output / "channel-audio.json", {})
    return catalog


def prepare_assets(local, state, output, args):
    if not state.get("menu"):
        raise ValueError("Prepare a System Menu WAD first with --wad PATH")
    directory = Path(state["menu"]["contentDirectory"])
    resource, files = discover_menu(directory)
    available = [package for package in DEFAULT_PACKAGES if f"layout/common/{package}.ash" in files]
    manifest = export(resource, output, available, state["language"])
    export_restart_resources(directory, output)
    export_keyboard_dictionary(directory, output)
    fonts = discover_fonts(directory)
    if fonts is None and state.get("nand"):
        fonts = discover_fonts(Path(state["nand"]) / "shared1")
    if fonts:
        export_shared_fonts(fonts, output)
    else:
        raise ValueError("No original shared font archive found in supplied WAD/NAND")
    for path in directory.glob("*.app"):
        if any(value[:4] == b"ttcf" for value in archive_members(path).values()):
            export_outline_fonts(path, output)
            break
    sound = files.get("sound/IplSound.brsar")
    if sound is not None:
        audio_source = local / "IplSound.brsar"
        audio_source.write_bytes(sound)
        command = [
            sys.executable,
            str(Path(__file__).with_name("export_audio.py")),
            "--source",
            str(audio_source),
            "--output",
            str(output),
            "--native-content",
            str(directory),
            "--background-source",
            args.background_source,
        ]
        if args.background:
            command.append("--background")
        subprocess.run(command, check=True)
    manifest = json.loads((output / "manifest.json").read_text())
    if (output / "audio.json").exists():
        manifest["audio"].update(json.loads((output / "audio.json").read_text()))
    manifest["preparation"] = {
        "titleId": SYSTEM_MENU,
        "wadSha256": state["menu"].get("sha256"),
        "packages": available,
        "language": state["language"],
    }
    write_json(output / "manifest.json", manifest)
    export_catalog(local, state, output)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "operation", nargs="?", choices=("prepare", "add", "remove", "list"), default="prepare"
    )
    parser.add_argument("title_id", nargs="?", help="Hexadecimal title ID for remove")
    parser.add_argument("--wad", type=Path, help="System Menu WAD for prepare; channel WAD for add")
    parser.add_argument("--channel-wad", action="append", default=[], type=Path)
    parser.add_argument(
        "--common-key-file",
        type=Path,
        help="Optional override: 16 raw bytes or 32 hex characters; never exported to the browser",
    )
    parser.add_argument(
        "--common-key-index", type=int, help="Override the common-key index declared by the ticket"
    )
    parser.add_argument(
        "--nand", action="append", default=[], type=Path,
        help="Repeatable extracted NAND directory, BootMii dump, or folder containing a dump"
    )
    parser.add_argument(
        "--nand-keys", type=Path,
        help="Matching BootMii keys.bin override for one raw NAND; otherwise use sibling or footer",
    )
    parser.add_argument("--language", choices=LANGUAGES)
    parser.add_argument("--local-dir", type=Path, default=ROOT / ".local")
    parser.add_argument("--output", type=Path, default=ROOT / "web/public/assets")
    parser.add_argument(
        "--rebuild", action="store_true", help="Reuse validated local WAD contents and imports"
    )
    parser.add_argument(
        "--background",
        action="store_true",
        help="Compatibility option; original sequenced BGM exports automatically",
    )
    parser.add_argument(
        "--background-source", choices=("auto", "capture", "builtin"), default="auto",
        help="Choose validated native capture or built-in sequence synthesis",
    )
    args = parser.parse_args(argv)
    # npm also invokes prepare automatically during npm install. No-argument
    # install must succeed without private assets or a console key.
    if args.operation == "prepare" and not (
        args.wad or args.nand or args.channel_wad or args.rebuild
    ):
        print(
            "Assets are local-only. Run npm run prepare -- --wad PATH; add --nand or --channel-wad for optional channels."
        )
        return 0
    local, output = args.local_dir.resolve(), args.output.resolve()
    try:
        if args.nand_keys and len(args.nand) != 1:
            raise ValueError("--nand-keys requires exactly one --nand input")
        if args.operation == "list":
            recover_preparation(local, output)
            state = load_state(local)
            for title, descriptor in state["channels"].items():
                print(f'{title}  {descriptor["kind"]}  {descriptor["source"]}')
            return 0
        with preparation_workspace(local, output) as (staged_local, staged_output):
            state = load_state(local)
            state["language"] = args.language or state["language"]
            if args.operation == "remove":
                title_id = (args.title_id or "").lower()
                if title_id not in state["channels"]:
                    raise ValueError("Title is not in the imported channel catalog")
                del state["channels"][title_id]
                if title_id not in state["removedChannels"]:
                    state["removedChannels"].append(title_id)
            else:
                key = read_common_key(args.common_key_file) if args.common_key_file else None
                if args.wad:
                    title, descriptor = import_wad(
                        args.wad, staged_local, key, args.common_key_index,
                        menu=args.operation == "prepare",
                    )
                    if args.operation == "prepare":
                        state["menu"] = descriptor
                    else:
                        state["channels"][title] = descriptor
                        state["removedChannels"] = [
                            item for item in state["removedChannels"] if item != title
                        ]
                elif args.operation == "add" and not (args.nand or args.channel_wad):
                    raise ValueError("add requires --wad, --channel-wad, or --nand")
                for source in args.nand:
                    with nand_directory(source, staged_local, args.nand_keys) as nand:
                        import_nand(nand, state, staged_local)
                for path in args.channel_wad:
                    title, descriptor = import_wad(path, staged_local, key, args.common_key_index)
                    state["channels"][title] = descriptor
                    state["removedChannels"] = [
                        item for item in state["removedChannels"] if item != title
                    ]
            if args.operation == "prepare":
                prepare_assets(staged_local, state, staged_output, args)
            else:
                if not (staged_output / "manifest.json").exists():
                    raise ValueError("Prepare the System Menu before changing its channel catalog")
                export_catalog(staged_local, state, staged_output)
            publish_preparation(staged_local, local, staged_output, output, state)
        print(f"Prepared browser assets: {output}")
        return 0
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Preparation failed: {error}\n")


if __name__ == "__main__":
    raise SystemExit(main())
