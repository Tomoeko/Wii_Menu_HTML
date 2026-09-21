#!/usr/bin/env python3
"""Export browser assets from the user's local, decrypted Wii menu resources."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re

from formats import animation, ash0, bmg, font, layout, png, tpl, u8_files
from export_home import export_home_resources

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_PACKAGES = (
    "chanSel",
    "chanTtl",
    "cmnBtn",
    "cursor",
    "diskThum",
    "diskBann",
    "GCBann",
    "homeBtn1",
    "setting",
    "exBtn",
    "sdButton",
    "board",
    "address",
    "balloon",
    "calendar",
    "chanEdit",
    "dlgWdw",
    "faceSel",
    "gcMem",
    "health",
    "letter",
    "limitOver",
    "memory",
    "mlAdSel",
    "prntDlg",
    "sdChanSel",
    "sdChanTtl",
    "setupBg",
    "setupBtn",
    "setupSel",
    "sofkeybd",
    "wiiMem",
)


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def export_settings(files, output, language):
    from channels_export import unwrap_resource

    settings = {"schemaVersion": 1, "archives": {}, "entryPoints": {}, "files": []}
    background_path = "html/BG_16x9.tpl"
    if background_path in files:
        texture = tpl(files[background_path])[0]
        destination = "settings/background-16x9.png"
        target = output / destination
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(png(texture["width"], texture["height"], texture.pop("pixels")))
        settings["background"] = dict(
            texture,
            url=destination,
            source=background_path,
            sha256=hashlib.sha256(files[background_path]).hexdigest(),
        )
    bridge = b'<script src="/src/settings-bridge.js"></script>'
    for archive_path, data in files.items():
        if not re.fullmatch(r"html/[^/]+/iplsetting\.ash", archive_path):
            continue
        region = archive_path.split("/")[1]
        resources = u8_files(unwrap_resource(data))
        prefix = f"settings/{region}/"
        for path, wrapped in resources.items():
            member = PurePosixPath(path)
            if member.is_absolute() or ".." in member.parts or "\\" in path:
                raise ValueError("Unsafe settings archive member path")
            original = unwrap_resource(wrapped)
            runtime = original
            descriptor = {
                "url": prefix + path,
                "source": archive_path + "/" + path,
                "sha256": hashlib.sha256(original).hexdigest(),
            }
            if path.lower().endswith((".html", ".htm")):
                raw = output / "settings-raw" / region / path
                raw.parent.mkdir(parents=True, exist_ok=True)
                raw.write_bytes(original)
                head = re.search(rb"<head(?:\s[^>]*)?>", original, re.I)
                position = head.end() if head else 0
                runtime = original[:position] + bridge + original[position:]
                descriptor["rawUrl"] = f"settings-raw/{region}/{path}"
                descriptor["runtimeChange"] = (
                    "Inserted local settings bridge before original scripts; all remaining bytes unchanged."
                )
                match = re.search(r"/([A-Z]{3})/index01\.html$", path)
                if match:
                    settings["entryPoints"][match[1]] = prefix + path
            target = output / prefix / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(runtime)
            settings["files"].append(descriptor)
        settings["archives"][region] = {
            "baseUrl": prefix,
            "source": archive_path,
            "sha256": hashlib.sha256(data).hexdigest(),
            "fileCount": len(resources),
        }
    settings["defaultEntryPoint"] = settings["entryPoints"].get(language) or settings[
        "entryPoints"
    ].get("ENG")
    write_json(output / "settings.json", settings)
    return {k: v for k, v in settings.items() if k != "files"}


def export(source, output, packages=DEFAULT_PACKAGES, language="ENG"):
    source_data = source.read_bytes()
    files = u8_files(source_data)
    manifest = {
        "schemaVersion": 1,
        "source": {
            "file": "system-menu-resource.app",
            "sha256": hashlib.sha256(source_data).hexdigest(),
        },
        "coordinateSystem": "Original NW4R pane coordinates: centered origin, positive Y up; layout originType retained.",
        "layouts": {},
        "packages": {},
        "fonts": {},
        "audio": {},
        "messages": {},
        "language": language,
    }
    for package in packages:
        archive_path = f"layout/common/{package}.ash"
        if archive_path not in files:
            raise ValueError(f"Missing resource {archive_path} in {source}")
        resources = u8_files(ash0(files[archive_path]))
        resource_sources = {path: archive_path for path in resources}
        localized_path = f"layout/{language.lower()}/{package}.ash"
        if localized_path in files:
            localized = u8_files(ash0(files[localized_path]))
            resources.update(localized)
            resource_sources.update({path: localized_path for path in localized})
        textures, animations, layout_names = {}, {}, []
        for path, data in sorted(resources.items()):
            if path.endswith(".tpl"):
                for index, texture in enumerate(tpl(data)):
                    name = Path(path).name
                    destination = (
                        f"textures/{package}/{Path(path).stem}"
                        + (f"-{index}" if index else "")
                        + ".png"
                    )
                    target = output / destination
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(
                        png(texture["width"], texture["height"], texture.pop("pixels"))
                    )
                    if index == 0:
                        textures[name] = dict(
                            texture,
                            name=name,
                            url=destination,
                            source=resource_sources[path] + "/" + path,
                        )
            elif path.endswith(".brlan"):
                animations[Path(path).stem] = animation(data)
        for path, data in sorted(resources.items()):
            if not path.endswith(".brlyt"):
                continue
            parsed = layout(data)
            name = Path(path).stem
            key = name if name not in manifest["layouts"] else f"{package}/{name}"
            parsed.update(
                name=name,
                package=package,
                source=resource_sources[path] + "/" + path,
                animations=animations,
                resourceTextures=textures,
            )
            parsed["textures"] = [
                textures.get(texture, {"name": texture, "missing": True})
                for texture in parsed["textures"]
            ]
            destination = f"layouts/{package}/{name}.json"
            write_json(output / destination, parsed)
            manifest["layouts"][key] = {"url": destination, "package": package, "name": name}
            layout_names.append(key)
        manifest["packages"][package] = {
            "layouts": layout_names,
            "textureCount": len(textures),
            "animations": list(animations),
        }
        print(
            f"{package}: {len(layout_names)} layouts, {len(textures)} textures, {len(animations)} animations"
        )
    if "font/font.ash" in files:
        for path, data in sorted(u8_files(ash0(files["font/font.ash"])).items()):
            if not path.endswith(".brfnt"):
                continue
            parsed = font(data)
            name = Path(path).name
            for index, sheet in enumerate(parsed["sheets"]):
                destination = f"fonts/{Path(path).stem}-{index}.png"
                target = output / destination
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(png(sheet["width"], sheet["height"], sheet.pop("pixels")))
                sheet["url"] = destination
            destination = f"fonts/{Path(path).stem}.json"
            write_json(output / destination, parsed)
            manifest["fonts"][name] = {"url": destination}
            print(f'{name}: {len(parsed["characters"])} characters, {len(parsed["sheets"])} sheets')
    audio_file = output / "audio.json"
    if audio_file.exists():
        manifest["audio"] = json.loads(audio_file.read_text())
    home = export_home_resources(files, output, language)
    manifest["homeMessages"] = home["messages"]
    manifest["audio"].update(home["audio"])
    manifest["settings"] = export_settings(files, output, language)
    for path, data in files.items():
        if re.fullmatch(r"message/[^/]+/ipl_common\.bmg", path):
            locale = path.split("/")[1]
            destination = f"messages/{locale}/ipl_common"
            parsed = bmg(data)
            parsed.update(source=path, sha256=hashlib.sha256(data).hexdigest())
            write_json(output / (destination + ".json"), parsed)
            (output / (destination + ".bmg")).write_bytes(data)
            manifest["messages"][locale.upper()] = {
                "url": destination + ".json",
                "rawUrl": destination + ".bmg",
            }
    write_json(output / "manifest.json", manifest)
    print(f'Exported {len(manifest["layouts"])} layouts to {output}')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        required=True,
    )
    parser.add_argument("--output", type=Path, default=ROOT / "web/public/assets")
    parser.add_argument("--packages", nargs="+", default=DEFAULT_PACKAGES)
    parser.add_argument(
        "--language",
        default="ENG",
        choices=("JPN", "ENG", "GER", "FRA", "SPA", "ITA", "NED", "CHN", "CHT", "KOR"),
    )
    args = parser.parse_args()
    if not args.source.is_file():
        parser.error(
            f"Local resource archive is missing: {args.source}. Supply an already decrypted 00000001.app with --source."
        )
    export(args.source, args.output, args.packages, args.language)


if __name__ == "__main__":
    main()
