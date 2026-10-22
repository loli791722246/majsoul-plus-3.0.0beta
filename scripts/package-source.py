#!/usr/bin/env python3
"""Package the repository source (without node_modules / build artifacts)."""

from __future__ import annotations

import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PREFIX = "majsoul-plus-3.0.0"

EXCLUDE_DIRS = {
    ".git",
    ".github/workflows/__pycache__",
    "node_modules",
    "build",
    "dist",
    "test-output",
    "data",
    "runtime/patcher-bin",
    "assets/certificate",
    "__pycache__",
    ".cache",
}

EXCLUDE_SUFFIXES = {".log", ".zip", ".mspr", ".mspe", ".mspm", ".mspt", ".pyc"}
EXCLUDE_FILES = {".DS_Store", "Thumbs.db"}


def is_excluded(path: Path) -> bool:
    relative = path.relative_to(ROOT).as_posix()
    for excluded in EXCLUDE_DIRS:
        if relative == excluded or relative.startswith(excluded + "/"):
            return True
    if path.name in EXCLUDE_FILES:
        return True
    if path.suffix.lower() in EXCLUDE_SUFFIXES:
        return True
    return False


def main() -> int:
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "dist" / f"{PREFIX}-source.zip"
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        output.unlink()

    count = 0
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(ROOT.rglob("*")):
            if not path.is_file() or is_excluded(path):
                continue
            archive.write(path, f"{PREFIX}/{path.relative_to(ROOT).as_posix()}")
            count += 1
    print(f"{output} ({count} files, {output.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
