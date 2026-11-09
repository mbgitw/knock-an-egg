#!/usr/bin/env python3
"""Entry point of the Builda Online user Room deployment client."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8")

from builda_online.cli import main


if __name__ == "__main__":
    raise SystemExit(main())
