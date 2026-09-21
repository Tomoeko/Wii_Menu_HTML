#!/usr/bin/env python3
"""Export the original shared Wii RFNA fonts from a local decrypted NAND archive."""

import argparse
import hashlib
import json
from pathlib import Path

from export import ROOT, write_json
from formats import font, png, u8_files

ALIASES = {
    "wbf1.brfna": "RevoIpl_RodinNTLGPro_DB_32_I4.brfnt",
    "wbf2.brfna": "RevoIpl_UtrilloProGrecoStd_M_32_I4.brfnt",
}
LAYOUT_ALIASES = {
    "wbf1.brfna": "WiiBitmapFontType1.brfnt",
    "wbf2.brfna": "WiiBitmapFontType2.brfnt",
}


def export_shared_fonts(source, output):
    resources = u8_files(source.read_bytes())
    manifest_path = output / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    for name, original_name in ALIASES.items():
        if name not in resources:
            raise ValueError(f"{source} does not contain {name}")
        data = resources[name]
        parsed = font(data)
        parsed["source"] = "shared-font-archive/" + name
        parsed["sourceSha256"] = hashlib.sha256(data).hexdigest()
        for index, sheet in enumerate(parsed["sheets"]):
            destination = f"fonts/{Path(original_name).stem}-{index}.png"
            target = output / destination
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(png(sheet["width"], sheet["height"], sheet.pop("pixels")))
            sheet["url"] = destination
        destination = f"fonts/{Path(original_name).stem}.json"
        write_json(output / destination, parsed)
        descriptor = {
            "url": destination,
            "source": parsed["source"],
            "sourceSha256": parsed["sourceSha256"],
        }
        manifest["fonts"][name] = descriptor
        manifest["fonts"][original_name] = descriptor
        # Keyboard, Memo, and Address Book layouts bind these shared font names.
        manifest["fonts"][LAYOUT_ALIASES[name]] = descriptor
        print(
            f'{name}: {len(parsed["characters"])} characters, {len(parsed["sheets"])} original sheets'
        )
    write_json(manifest_path, manifest)
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        required=True,
    )
    parser.add_argument("--output", type=Path, default=ROOT / "web/public/assets")
    args = parser.parse_args()
    export_shared_fonts(args.source, args.output)
