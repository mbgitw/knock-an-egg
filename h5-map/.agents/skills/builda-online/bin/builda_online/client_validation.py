"""Check whether the user client relies on unreliable Builda Online environment detection."""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Iterator, Optional

from .config import ConfigError


SOURCE_SUFFIXES = {
    ".cjs",
    ".cs",
    ".gd",
    ".html",
    ".js",
    ".jslib",
    ".jsx",
    ".mjs",
    ".ts",
    ".tsx",
}
IGNORED_DIRECTORY_NAMES = {
    ".builda-agent",
    ".builda-online",
    ".dart_tool",
    ".git",
    ".godot",
    "Build",
    "Library",
    "Obj",
    "Temp",
    "build",
    "dist",
    "node_modules",
    "target",
}
IGNORED_MANAGED_PREFIXES = (
    ("addons", "builda"),
    ("addons", "cysj_online"),
    ("Packages", "com.cysj.online"),
    ("vendor", "builda-online", "client-sdk"),
)
MAX_SOURCE_BYTES = 2 * 1024 * 1024

HOSTNAME_PATTERN = re.compile(r"\b(?:window\s*\.\s*)?location\s*\.\s*hostname\b", re.IGNORECASE)
LOOPBACK_LITERAL_PATTERN = re.compile(r"[\"'](?:127\.0\.0\.1|localhost)[\"']", re.IGNORECASE)
ONLINE_CONTEXT_PATTERN = re.compile(
    r"Builda\s+Online|cysj_online|\bCysj\b|gateway|create_client|createClient|CreateClient|"
    r"restore_session|restoreSession|RestoreSession|_is_local_runtime|isLocalRuntime|"
    r"uses_local_room_mock|usesLocalRoomMock|localRoomMock",
    re.IGNORECASE,
)


def validate_client_runtime_detection(project_root: Path) -> None:
    """Reject using the page hostname, which misidentifies the Builda App loopback origin as the local Room Mock."""

    project_root = project_root.resolve()
    for path in _iter_client_sources(project_root):
        source = _read_small_utf8_file(path)
        if source is None:
            continue
        searchable = _without_full_line_and_block_comments(source)
        hostname = HOSTNAME_PATTERN.search(searchable)
        if (
            hostname is None
            or LOOPBACK_LITERAL_PATTERN.search(searchable) is None
            or ONLINE_CONTEXT_PATTERN.search(searchable) is None
        ):
            continue
        relative = path.relative_to(project_root).as_posix()
        source_hostname = HOSTNAME_PATTERN.search(source)
        line = (
            source.count("\n", 0, source_hostname.start()) + 1
            if source_hostname
            else 1
        )
        raise ConfigError(
            "UNSAFE_LOCAL_RUNTIME_DETECTION: "
            f"{relative}:{line} switches Builda Online based on location.hostname and localhost/127.0.0.1. "
            "Builda App also loads production Bundles from 127.0.0.1, so this check can send a real device "
            "to the local Room Mock. Web local development must use builda_mock_shell=1 injected by the "
            "Builda dev shell; editor runs may use the engine editor flag."
        )


def _iter_client_sources(project_root: Path) -> Iterator[Path]:
    """Walk user source, excluding the managed SDK, dependencies, build outputs, and the Room Workspace."""

    for directory, directory_names, file_names in os.walk(project_root):
        current = Path(directory)
        current_parts = current.relative_to(project_root).parts
        directory_names[:] = [
            name
            for name in directory_names
            if name not in IGNORED_DIRECTORY_NAMES
            and not _is_ignored_prefix(current_parts + (name,))
        ]
        for file_name in file_names:
            path = current / file_name
            if path.is_symlink() or path.suffix.lower() not in SOURCE_SUFFIXES:
                continue
            yield path


def _is_ignored_prefix(relative_parts: tuple[str, ...]) -> bool:
    """Decide whether a directory belongs to Room source or platform-managed client files."""

    if relative_parts and relative_parts[0] == "server":
        return True
    return any(
        relative_parts[: len(prefix)] == prefix
        for prefix in IGNORED_MANAGED_PREFIXES
    )


def _read_small_utf8_file(path: Path) -> Optional[str]:
    """Read only bounded UTF-8 text, avoiding scans of large or binary build files."""

    try:
        if path.stat().st_size > MAX_SOURCE_BYTES:
            return None
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None


def _without_full_line_and_block_comments(source: str) -> str:
    """Strip common whole-block comments so rule explanations do not trigger static checks."""

    without_blocks = re.sub(r"/\*.*?\*/|<!--.*?-->", "", source, flags=re.DOTALL)
    return "\n".join(
        line
        for line in without_blocks.splitlines()
        if not re.match(r"^\s*(?://|#|;)", line)
    )
