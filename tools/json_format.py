"""Readable JSON formatting shared by asset-producing Python tools."""

from __future__ import annotations

import json
from typing import Any


def _is_scalar(value: Any) -> bool:
    return value is None or isinstance(value, (bool, int, float, str))


def _format(value: Any, depth: int = 0) -> str:
    if _is_scalar(value):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))

    indent = "  " * depth
    child_indent = "  " * (depth + 1)
    if isinstance(value, (list, tuple)):
        if not value:
            return "[]"
        if all(_is_scalar(item) for item in value):
            return "[" + ", ".join(_format(item, depth + 1) for item in value) + "]"
        lines = [f"{child_indent}{_format(item, depth + 1)}" for item in value]
        return "[\n" + ",\n".join(lines) + f"\n{indent}]"

    if not value:
        return "{}"
    lines = [
        f"{child_indent}{json.dumps(str(key), ensure_ascii=False)}: {_format(child, depth + 1)}"
        for key, child in value.items()
    ]
    return "{\n" + ",\n".join(lines) + f"\n{indent}}}"


def format_json(value: Any) -> str:
    """Return JSON with compact scalar arrays and a trailing newline."""

    return _format(value) + "\n"
