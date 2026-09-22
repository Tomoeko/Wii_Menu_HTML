#!/usr/bin/env python3
"""Compare retained and fresh original Latin dictionary contexts after dismissal.

All input is synthetic. This uses the existing isolated PowerPC harness and
does not attach to a running menu, read console saves, or change original bytes.
It tests the identified dictionary calls, not the full native scene lifecycle.
"""

from __future__ import annotations

try:
    from tools.json_format import format_json
except ModuleNotFoundError:  # Direct execution from a tools subdirectory.
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from json_format import format_json

import argparse
import copy
import json
from pathlib import Path

from worker import OriginalDictionary, SUPPORTED_DOL


CORPORA = {
    "en": ("he", "hello", "worl", "unicorn", "zeb", "the", "good"),
    "fr": ("bon", "bonjour", "merc", "salut", "fran", "avec", "qui"),
    "es": ("hol", "hola", "grac", "amig", "buen", "para", "que"),
}
HISTORIES = ("typed", "accepted", "phone", "mixed")
CASES = ("lower", "title", "upper")
PHONE_HISTORY = ("666", "435", "266", "96753")
PHONE_PROBES = ("6", "66", "666", "435", "266", "96753")


def history_snapshot(engine: OriginalDictionary, language: str, kind: str) -> dict:
    """Exercise corrections/selections, then the verified Latin close operation."""
    session = f"history-{language}-{kind}"
    for index, word in enumerate(CORPORA[language]):
        if kind in ("phone", "mixed"):
            engine.query(
                session=session, language=language,
                digits=PHONE_HISTORY[index % len(PHONE_HISTORY)],
            )
            engine.query(session=session, action="accept", index=0)
        if kind != "phone":
            engine.query(session=session, language=language, text=word)
            engine.query(session=session, language=language, text=word[:-1])
            result = engine.query(session=session, language=language, text=word)
            if kind != "typed" and result["candidates"]:
                engine.query(
                    session=session, action="accept",
                    index=min(2, len(result["candidates"]) - 1),
                )
            else:
                engine.query(session=session, action="reset")

    # Native close command 6 reaches 0x81420F30 and clearCandidates 0x81433D8C
    # for these Latin profiles. The worker's reset executes that exact routine
    # and resets its input bookkeeping, retaining the original context bytes.
    # Type 8's extra setCurrentWord/update branch is outside this probe.
    engine.query(session=session, action="reset")
    return copy.deepcopy(engine.sessions.pop(session))


def probes(language: str) -> list[dict]:
    text = [
        {"text": word, "case": case}
        for word in CORPORA[language]
        for case in CASES
    ]
    phone = [
        {"digits": digits, "case": case}
        for digits in PHONE_PROBES
        for case in CASES
    ]
    return text + phone


def audit(state: Path, assets: Path) -> dict:
    engine = OriginalDictionary(state, assets)
    results = []
    mismatches = []
    for language in CORPORA:
        for history in HISTORIES:
            retained = history_snapshot(engine, language, history)
            fresh = engine.new_session(language)
            retained_context = retained["memory"][0][1]
            fresh_context = fresh["memory"][0][1]
            query_count = 0
            accepted_count = 0
            for request in probes(language):
                # Each branch starts from its own snapshot. Previous probes
                # cannot influence the next comparison or overwrite its RAM.
                engine.sessions["retained"] = copy.deepcopy(retained)
                engine.sessions["fresh"] = copy.deepcopy(fresh)
                original = engine.query(
                    session="retained", language=language, **request,
                )
                browser = engine.query(
                    session="fresh", language=language, **request,
                )
                query_count += 1
                if original != browser:
                    mismatches.append({
                        "language": language,
                        "history": history,
                        "stage": "query",
                        "request": request,
                        "retained": original,
                        "fresh": browser,
                    })
                    continue
                if not original["candidates"]:
                    continue
                index = min(2, len(original["candidates"]) - 1)
                selected_original = engine.query(
                    session="retained", action="accept", index=index,
                )
                selected_browser = engine.query(
                    session="fresh", action="accept", index=index,
                )
                accepted_count += 1
                if selected_original != selected_browser:
                    mismatches.append({
                        "language": language,
                        "history": history,
                        "stage": "accept",
                        "request": request,
                        "index": index,
                        "retained": selected_original,
                        "fresh": selected_browser,
                    })
            results.append({
                "language": language,
                "history": history,
                "queriesCompared": query_count,
                "selectionsCompared": accepted_count,
                "contextChangedBytes": sum(
                    first != second
                    for first, second in zip(retained_context, fresh_context)
                ),
                "userWordAttachmentBytes": retained_context[0x124:0x13C].hex(),
            })
    return {
        "profile": "USA 4.3 Latin same-scene dictionary lifetime probe",
        "executableSha256": SUPPORTED_DOL,
        "closeDictionaryRoutine": "0x81433D8C",
        "results": results,
        "mismatches": mismatches,
        "limits": [
            "Only the identified dictionary operation is executed, not full scene dismissal.",
            "Inputs cover synthetic English, French, Spanish and telephone sequences.",
            "No native UI, NAND I/O or menu restart is exercised.",
            "Matching results do not establish equivalence for all RAM states or profiles.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--assets", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = audit(args.state, args.assets)
    result = format_json(report)
    if args.output:
        args.output.write_text(result)
    else:
        print(result, end="")
    return int(bool(report["mismatches"]))


if __name__ == "__main__":
    raise SystemExit(main())
