#!/usr/bin/env python3
"""Stage only active channel artwork from a supplied NAND for local comparison."""

from __future__ import annotations

import argparse
from contextlib import redirect_stdout
import hashlib
from itertools import islice
import json
from pathlib import Path
import shutil
import sys
import tempfile

from channels_export import export_channels
from nand_import import iter_nand_candidates, nand_directory, plan_nand, safe_file
from preparation_transaction import recover_preparation
from prepare import load_state


MAX_CHANNELS = 256
MAX_BANNER_BYTES = 64 * 1024 * 1024


def stage_active_channels(nand: Path, destination: Path, scratch: Path,
                          candidates: list[dict], language: str = "ENG") -> dict:
    """Export validated active banners without copying other NAND user data."""
    with tempfile.TemporaryDirectory(prefix=".channel-preview-", dir=scratch) as temporary:
        selected = Path(temporary)
        count = 0
        total_bytes = 0
        for candidate in candidates:
            title = candidate["id"]
            directory = candidate["banner"].parent
            count += 1
            if count > MAX_CHANNELS:
                raise ValueError("NAND contains too many channels to compare at once")
            target = selected / "title" / title[:8] / title[8:] / "content"
            target.mkdir(parents=True, exist_ok=True)
            banner = candidate["banner"]
            size = banner.stat().st_size
            total_bytes += size
            if size > MAX_BANNER_BYTES or total_bytes > 512 * 1024 * 1024:
                raise ValueError("Channel artwork exceeds the comparison limit")
            copied = target / banner.name.lower()
            shutil.copyfile(banner, copied)
            if hashlib.sha256(copied.read_bytes()).hexdigest() != candidate["sha256"]:
                raise ValueError("NAND channel changed during preview; scan it again")
            tmd = directory / "title.tmd"
            if tmd.is_file():
                copied_tmd = target / "title.tmd"
                shutil.copyfile(safe_file(tmd, nand), copied_tmd)
                if hashlib.sha256(copied_tmd.read_bytes()).hexdigest() != candidate["tmdSha256"]:
                    raise ValueError("NAND title metadata changed during preview; scan it again")
        if not count:
            raise ValueError("No channel icon or banner was found in this NAND")
        destination.mkdir(parents=True, exist_ok=False)
        return export_channels(selected, destination, language)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--nand", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--scratch", type=Path, required=True)
    parser.add_argument("--assets", type=Path, required=True)
    parser.add_argument("--nand-keys", type=Path)
    parser.add_argument("--language", default="ENG")
    args = parser.parse_args(argv)
    try:
        with redirect_stdout(sys.stderr):
            recover_preparation(args.scratch, args.assets)
            state = load_state(args.scratch)
            with nand_directory(args.nand, args.scratch, args.nand_keys) as nand:
                candidates = list(islice(
                    iter_nand_candidates(nand, state.get("language", "ENG")),
                    MAX_CHANNELS + 1,
                ))
                if len(candidates) > MAX_CHANNELS:
                    raise ValueError("NAND contains too many channels to compare at once")
                plan = plan_nand(nand, state, candidates)
                stage_active_channels(
                    nand, args.output, args.scratch, candidates, state.get("language", "ENG")
                )
        print(json.dumps(plan, separators=(",", ":")))
    except (OSError, ValueError) as error:
        parser.exit(1, f"Could not preview NAND channels: {error}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
