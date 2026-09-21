"""Keep capture inputs beside the final package without depending on shell cwd."""

from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parents[2]
