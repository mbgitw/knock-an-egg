"""Produce a deterministic Rust Workspace source archive that meets the online source build contract."""

from __future__ import annotations

import gzip
import hashlib
import os
import stat
import tarfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Optional

MAX_ARCHIVE_BYTES = 16 * 1024 * 1024
MAX_EXPANDED_BYTES = 64 * 1024 * 1024
MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_ENTRIES = 2_048
MAX_PATH_BYTES = 240
EXCLUDED_DIRECTORIES = {".git", ".cargo", ".builda-online", "node_modules", "target", "vendor"}
EXCLUDED_FILES = {"rust-toolchain", "rust-toolchain.toml"}
TYPESCRIPT_ENTRY = "room.ts"


class ArchiveError(ValueError):
    """Signals that the Room source cannot be packaged safely."""


@dataclass(frozen=True)
class PackedSource:
    """Describe the source files to upload and their digests."""

    path: Path
    sha256: str
    content_type: str
    source_format: str
    manifest_path: Optional[str] = None


def pack_rust_workspace(
    workspace: Path,
    output: Path,
    manifest_path: str,
) -> PackedSource:
    """Validate and produce a source archive with fixed ordering, fixed metadata, and a fixed gzip header."""

    manifest = _safe_manifest_path(manifest_path)
    if not (workspace / Path(*manifest.parts)).is_file():
        raise ArchiveError(f"manifestPath does not exist in the workspace: {manifest_path}")
    if not (workspace / "Cargo.lock").is_file():
        raise ArchiveError("Rust Workspace directory must contain Cargo.lock")

    entries: list[tuple[str, Path, int]] = []
    expanded_bytes = 0
    for root, directories, files in os.walk(workspace, topdown=True, followlinks=False):
        root_path = Path(root)
        kept_directories = []
        for name in sorted(directories):
            path = root_path / name
            if name in EXCLUDED_DIRECTORIES:
                continue
            if path.is_symlink():
                raise ArchiveError(f"Workspace cannot contain symbolic links: {path.relative_to(workspace)}")
            kept_directories.append(name)
        directories[:] = kept_directories

        for name in sorted(files):
            path = root_path / name
            relative = path.relative_to(workspace).as_posix()
            if name in EXCLUDED_FILES or path == output:
                continue
            if name == "build.rs":
                raise ArchiveError(f"Workspace cannot contain a user-provided build.rs: {relative}")
            file_stat = path.lstat()
            if stat.S_ISLNK(file_stat.st_mode):
                raise ArchiveError(f"Workspace cannot contain symbolic links: {relative}")
            if not stat.S_ISREG(file_stat.st_mode):
                raise ArchiveError(f"Workspace cannot contain special files: {relative}")
            if file_stat.st_nlink > 1:
                raise ArchiveError(f"Workspace cannot contain hard links: {relative}")
            if len(relative.encode("utf-8")) > MAX_PATH_BYTES:
                raise ArchiveError(f"Source path exceeds {MAX_PATH_BYTES} bytes: {relative}")
            if file_stat.st_size > MAX_FILE_BYTES:
                raise ArchiveError(f"Source file exceeds 8 MiB: {relative}")
            expanded_bytes += file_stat.st_size
            if expanded_bytes > MAX_EXPANDED_BYTES:
                raise ArchiveError("Workspace size exceeds 64 MiB")
            entries.append((relative, path, file_stat.st_size))

    if len(entries) > MAX_ENTRIES:
        raise ArchiveError("Workspace contains more than 2048 files")
    entries.sort(key=lambda item: item[0].encode("utf-8"))

    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("wb") as raw_output:
        with gzip.GzipFile(
            filename="",
            mode="wb",
            fileobj=raw_output,
            compresslevel=9,
            mtime=0,
        ) as gzip_output:
            with tarfile.open(
                fileobj=gzip_output,
                mode="w",
                format=tarfile.USTAR_FORMAT,
            ) as archive:
                for relative, path, size in entries:
                    info = tarfile.TarInfo(relative)
                    info.size = size
                    info.mode = 0o644
                    info.mtime = 0
                    info.uid = 0
                    info.gid = 0
                    info.uname = ""
                    info.gname = ""
                    with path.open("rb") as source_file:
                        archive.addfile(info, source_file)

    if output.stat().st_size > MAX_ARCHIVE_BYTES:
        output.unlink(missing_ok=True)
        raise ArchiveError("Workspace archive exceeds 16 MiB")
    return PackedSource(
        path=output,
        sha256=_sha256(output),
        content_type="application/gzip",
        source_format="cargo-workspace",
        manifest_path=manifest_path,
    )


def pack_typescript_workspace(
    workspace: Path,
    output: Path,
) -> PackedSource:
    """Validate and package a TypeScript Room source directory; the entry is always room.ts."""

    entry = workspace / TYPESCRIPT_ENTRY
    if not entry.is_file():
        raise ArchiveError(f"TypeScript Room source directory must contain {TYPESCRIPT_ENTRY}")
    entries = _collect_workspace_entries(workspace, output, forbid_build_rs=True)
    if not any(relative == TYPESCRIPT_ENTRY for relative, _, _ in entries):
        raise ArchiveError(f"TypeScript Room source directory must contain {TYPESCRIPT_ENTRY}")
    _write_deterministic_archive(entries, output)
    if output.stat().st_size > MAX_ARCHIVE_BYTES:
        output.unlink(missing_ok=True)
        raise ArchiveError("TypeScript source exceeds 16 MiB")
    return PackedSource(
        path=output,
        sha256=_sha256(output),
        content_type="application/gzip",
        source_format="typescript-workspace",
        manifest_path=TYPESCRIPT_ENTRY,
    )


def describe_typescript_source(source: Path) -> PackedSource:
    """Validate a single TypeScript file and compute the upload digest."""

    size = source.stat().st_size
    if size == 0:
        raise ArchiveError("TypeScript Room source must not be empty")
    if size > MAX_ARCHIVE_BYTES:
        raise ArchiveError("TypeScript Room source exceeds 16 MiB")
    return PackedSource(
        path=source,
        sha256=_sha256(source),
        content_type="text/typescript",
        source_format="single-file",
    )


def _collect_workspace_entries(
    workspace: Path,
    output: Path,
    *,
    forbid_build_rs: bool,
) -> list[tuple[str, Path, int]]:
    """Collect source entries that can be packaged safely and deterministically."""

    entries: list[tuple[str, Path, int]] = []
    expanded_bytes = 0
    for root, directories, files in os.walk(workspace, topdown=True, followlinks=False):
        root_path = Path(root)
        kept_directories = []
        for name in sorted(directories):
            path = root_path / name
            if name in EXCLUDED_DIRECTORIES:
                continue
            if path.is_symlink():
                raise ArchiveError(f"Workspace cannot contain symbolic links: {path.relative_to(workspace)}")
            kept_directories.append(name)
        directories[:] = kept_directories

        for name in sorted(files):
            path = root_path / name
            relative = path.relative_to(workspace).as_posix()
            if name in EXCLUDED_FILES or path == output:
                continue
            if forbid_build_rs and name == "build.rs":
                raise ArchiveError(f"Workspace cannot contain a user-provided build.rs: {relative}")
            file_stat = path.lstat()
            if stat.S_ISLNK(file_stat.st_mode):
                raise ArchiveError(f"Workspace cannot contain symbolic links: {relative}")
            if not stat.S_ISREG(file_stat.st_mode):
                raise ArchiveError(f"Workspace cannot contain special files: {relative}")
            if file_stat.st_nlink > 1:
                raise ArchiveError(f"Workspace cannot contain hard links: {relative}")
            if len(relative.encode("utf-8")) > MAX_PATH_BYTES:
                raise ArchiveError(f"Source path exceeds {MAX_PATH_BYTES} bytes: {relative}")
            if file_stat.st_size > MAX_FILE_BYTES:
                raise ArchiveError(f"Source file exceeds 8 MiB: {relative}")
            expanded_bytes += file_stat.st_size
            if expanded_bytes > MAX_EXPANDED_BYTES:
                raise ArchiveError("Workspace size exceeds 64 MiB")
            entries.append((relative, path, file_stat.st_size))

    if len(entries) > MAX_ENTRIES:
        raise ArchiveError("Workspace contains more than 2048 files")
    entries.sort(key=lambda item: item[0].encode("utf-8"))
    return entries


def _write_deterministic_archive(
    entries: list[tuple[str, Path, int]],
    output: Path,
) -> None:
    """Write a gzip tar with fixed metadata."""

    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("wb") as raw_output:
        with gzip.GzipFile(
            filename="",
            mode="wb",
            fileobj=raw_output,
            compresslevel=9,
            mtime=0,
        ) as gzip_output:
            with tarfile.open(
                fileobj=gzip_output,
                mode="w",
                format=tarfile.USTAR_FORMAT,
            ) as archive:
                for relative, path, size in entries:
                    info = tarfile.TarInfo(relative)
                    info.size = size
                    info.mode = 0o644
                    info.mtime = 0
                    info.uid = 0
                    info.gid = 0
                    info.uname = ""
                    info.gname = ""
                    with path.open("rb") as source_file:
                        archive.addfile(info, source_file)


def _safe_manifest_path(value: str) -> PurePosixPath:
    """Reject absolute paths, backslashes, and directory traversal."""

    if "\\" in value:
        raise ArchiveError("manifestPath must be a POSIX relative path")
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or path.name != "Cargo.toml":
        raise ArchiveError("manifestPath must safely reference a Cargo.toml inside the workspace")
    return path


def _sha256(path: Path) -> str:
    """Stream-compute the source SHA-256."""

    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
