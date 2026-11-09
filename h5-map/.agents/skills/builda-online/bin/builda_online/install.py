"""Install or upgrade Builda Online deliverables according to the project's Builda SDK version pin.

Online deliverables are released with the same version as the base Builda SDK. The project pins a single version via `.builda-agent/sdk-version`;
this module reads only that version's immutable snapshot `<public_base_url>/releases/<version>/manifest.json`, verifies SHA-256,
and places both Skills, the deployment client, the single client SDK, the same-language Room SDK, and the Mock in the managed directories defined by setup.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Optional

from .config import ConfigError, SDK_VERSION_PATTERN, read_json


class InstallError(RuntimeError):
    """Signals that install cannot continue; the project was not modified or was left as it was."""


CLIENT_SDKS = ("godot", "h5", "cocos", "unity")
ROOM_LANGUAGES = ("typescript", "rust")
SUPPORTED_SCHEMA_VERSION = 19
SDK_PIN_FILE = Path(".builda-agent") / "sdk-version"
STATE_DIRECTORY = Path(".builda-online")
SKILLS_ROOT = Path(".agents") / "skills"
SKILL_DIRECTORY = SKILLS_ROOT / "builda-online"
DIAGNOSTICS_SKILL_DIRECTORY = SKILLS_ROOT / "builda-online-diagnostics"
CLIENT_SDK_DIRECTORIES = {
    "godot": Path("addons") / "cysj_online",
    "h5": Path("vendor") / "builda-online" / "client-sdk" / "h5",
    "cocos": Path("vendor") / "builda-online" / "client-sdk" / "cocos",
    "unity": Path("vendor") / "builda-online" / "client-sdk" / "unity",
}
CLIENT_PACKAGE_NAMES = {"h5": "@cysj/online-h5", "cocos": "@cysj/online-cocos", "unity": "com.cysj.online"}
RELEASE_PATTERN = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
MAX_ARTIFACT_BYTES = 256 * 1024 * 1024
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}


@dataclass(frozen=True)
class InstallRequest:
    """Inputs for one install or upgrade."""

    project_root: Path
    manifest_url: Optional[str]
    client_sdk: Optional[str]
    room_language: Optional[str]
    upgrade: bool
    allow_reexec: bool = True


@dataclass(frozen=True)
class ComponentPlan:
    """Version and digest of one managed component in the manifest."""

    key: str
    version: str
    download_url: str
    sha256: str


def run_install(request: InstallRequest, emit: Callable[[str], None] = print) -> int:
    """Run install or upgrade and print stable key=value result lines."""

    project_root = request.project_root.resolve()
    if not project_root.is_dir():
        raise InstallError(f"Project root does not exist: {project_root}")
    previous = _load_previous_installation(project_root)
    if request.upgrade and previous is None:
        raise InstallError("Builda Online is not installed in this project; run `builda-online install` first")
    pin = read_sdk_pin(project_root)
    manifest_url = request.manifest_url or _previous_manifest_url(previous)
    if not manifest_url:
        raise InstallError("--manifest-url is required for the first installation")
    manifest, immutable_manifest_url = resolve_pinned_manifest(manifest_url, pin)
    client_sdk = _select_client_sdk(project_root, request.client_sdk, previous)
    room_language = _select_room_language(project_root, request.room_language, previous, manifest)
    plans = _component_plans(manifest, client_sdk, room_language)
    public_base_url = manifest["public_base_url"]
    release_prefix = f"{public_base_url}/releases/{pin}/"
    for plan in plans.values():
        if not plan.download_url.startswith(release_prefix):
            raise InstallError(f"{plan.key} download_url is outside the pinned release: {plan.download_url}")

    previous_components = previous.get("components", {}) if previous else {}
    changed: list[str] = []
    with tempfile.TemporaryDirectory(prefix=".install-", dir=_ensure_state_directory(project_root)) as temporary:
        staging = Path(temporary)
        archives: dict[str, Path] = {}
        for plan in plans.values():
            if _component_current(
                project_root, plan, previous_components, client_sdk, room_language, manifest["room_mocks"][room_language]
            ):
                emit(f"component={plan.key} reused version={plan.version}")
                continue
            archives[plan.key] = _download_verified(plan, staging)
            changed.append(plan.key)

        if "skill" in archives:
            skill_root = _extract_single_root(archives["skill"], staging / "skill")
            _verify_skill_layout(skill_root, plans["skill"].version, require_bin=True)
            _replace_directory(project_root, SKILL_DIRECTORY, skill_root)
            emit(f"component=skill installed version={plans['skill'].version}")
        if "diagnostics_skill" in archives:
            diagnostics_root = _extract_single_root(archives["diagnostics_skill"], staging / "diagnostics")
            _verify_skill_layout(diagnostics_root, plans["diagnostics_skill"].version, require_bin=False)
            _replace_directory(project_root, DIAGNOSTICS_SKILL_DIRECTORY, diagnostics_root)
            emit(f"component=diagnostics_skill installed version={plans['diagnostics_skill'].version}")

        bin_changed = _sync_deploy_client(project_root)
        if bin_changed and request.allow_reexec and _running_from(project_root):
            # The deployment client itself was updated: hand the rest of the install to the new client so old code never interprets a new manifest.
            emit("component=deploy_client updated; continuing with the new client")
            return _reexec_new_client(project_root, request, manifest_url)

        if "client_sdk" in archives:
            _install_client_sdk(project_root, client_sdk, plans["client_sdk"], archives["client_sdk"], staging)
            emit(f"component=client_sdk installed engine={client_sdk} version={plans['client_sdk'].version}")
        if "room_mock" in archives or "server_sdk" in archives:
            _install_room_overlay(
                project_root,
                room_language,
                manifest["room_mocks"][room_language],
                plans["room_mock"],
                plans["server_sdk"],
                archives.get("room_mock") or _download_verified(plans["room_mock"], staging),
                staging,
            )
            emit(f"component=room_mock installed language={room_language} version={plans['room_mock'].version}")
            emit(f"component=server_sdk installed language={room_language} version={plans['server_sdk'].version}")

    _wire_client_dependency(project_root, client_sdk, emit)
    _ensure_gitignore(project_root)
    _remove_legacy_manifest_check(project_root)
    record = _installation_record(
        manifest,
        pin,
        immutable_manifest_url,
        client_sdk,
        room_language,
        plans,
    )
    _write_json(project_root / STATE_DIRECTORY / "installation.json", record)

    command = "upgrade" if request.upgrade else "install"
    if request.upgrade and not changed and previous is not None and previous.get("releaseId") == pin:
        emit("builda-online-upgrade=unchanged")
    else:
        emit(f"builda-online-{command}=ok")
    emit(f"releaseId={pin}")
    emit(f"sdkVersion={pin}")
    emit(f"clientSdk={client_sdk}")
    emit(f"clientSdkVersion={plans['client_sdk'].version}")
    emit(f"roomLanguage={room_language}")
    emit(f"serverSdkVersion={plans['server_sdk'].version}")
    emit(f"roomMockVersion={plans['room_mock'].version}")
    emit(f"skillVersion={plans['skill'].version}")
    emit(f"diagnosticsSkillVersion={plans['diagnostics_skill'].version}")
    emit(f"roomSdkDirectory={manifest['room_mocks'][room_language]['sdk_directory']}")
    emit(f"roomMockDirectory={manifest['room_mocks'][room_language]['package_directory']}")
    emit(f"roomSdkDependency={_room_sdk_dependency_hint(room_language, manifest)}")
    emit(f"next=read {SKILL_DIRECTORY.as_posix()}/SKILL.md, then run {STATE_DIRECTORY.as_posix()}/bin/builda-online check")
    return 0


# ---------------------------------------------------------------------------
# Version pin and manifest


def read_sdk_pin(project_root: Path) -> str:
    """Read the project's pinned Builda SDK version; Online only follows this version."""

    pin_path = project_root / SDK_PIN_FILE
    if not pin_path.exists():
        raise InstallError(
            "Builda SDK pin .builda-agent/sdk-version is missing; install the Builda SDK first "
            "(./.builda-agent/builda sdk install)"
        )
    if pin_path.is_symlink() or not pin_path.is_file():
        raise InstallError("Builda SDK pin .builda-agent/sdk-version must be a regular file")
    pin = pin_path.read_text(encoding="utf-8").strip()
    if not RELEASE_PATTERN.fullmatch(pin):
        raise InstallError("Builda SDK pin .builda-agent/sdk-version is not a release version")
    major, minor, _patch = (int(part) for part in pin.split("."))
    if major == 0 and minor < 5:
        raise InstallError(
            f"Builda SDK {pin} predates Builda Online delivery; run ./.builda-agent/builda sdk upgrade first"
        )
    return pin


def read_sdk_pin_if_present(project_root: Path) -> Optional[str]:
    """Read the version pin; return None when missing, for read-only commands such as check."""

    pin_path = project_root / SDK_PIN_FILE
    if not pin_path.is_file():
        return None
    pin = pin_path.read_text(encoding="utf-8").strip()
    return pin if RELEASE_PATTERN.fullmatch(pin) else None


def resolve_pinned_manifest(manifest_url: str, pin: str) -> tuple[dict[str, Any], str]:
    """Resolve any public manifest entry to the immutable manifest for the current version pin."""

    _validate_public_url(manifest_url, "manifest URL")
    if not manifest_url.endswith("/manifest.json"):
        raise InstallError("manifest URL must point to a manifest.json")
    manifest = _fetch_json(manifest_url)
    public_base_url = _manifest_public_base_url(manifest)
    immutable_url = f"{public_base_url}/releases/{pin}/manifest.json"
    if manifest.get("release_id") != pin or manifest_url != immutable_url:
        manifest = _fetch_json(immutable_url)
        if _manifest_public_base_url(manifest) != public_base_url:
            raise InstallError("Pinned manifest public_base_url does not match the discovery manifest")
    validate_manifest(manifest, pin)
    return manifest, immutable_url


def validate_manifest(manifest: dict[str, Any], pin: str) -> None:
    """Validate the immutable manifest against setup's delivery manifest rules."""

    schema = manifest.get("schema_version")
    if not isinstance(schema, int) or isinstance(schema, bool) or schema < SUPPORTED_SCHEMA_VERSION:
        raise InstallError(f"Unsupported manifest schema_version: {schema!r}")
    if manifest.get("environment") != "online":
        raise InstallError("manifest environment must be online")
    if manifest.get("release_id") != pin:
        raise InstallError(f"manifest release_id {manifest.get('release_id')!r} does not match Builda SDK pin {pin}")
    public_base_url = _manifest_public_base_url(manifest)
    if manifest.get("setup_url") != f"{public_base_url}/setup.md":
        raise InstallError("manifest setup_url does not belong to public_base_url")
    if manifest.get("manifest_url") != f"{public_base_url}/manifest.json":
        raise InstallError("manifest manifest_url does not belong to public_base_url")
    support = manifest.get("support")
    if not isinstance(support, dict):
        raise InstallError("manifest is missing support")
    for name, expected in (
        ("client_engines", CLIENT_SDKS),
        ("server_languages", ROOM_LANGUAGES),
        ("local_mock_languages", ROOM_LANGUAGES),
    ):
        values = support.get(name)
        if not isinstance(values, list) or not set(values) & set(expected):
            raise InstallError(f"manifest support.{name} is invalid")
    runtime = manifest.get("runtime")
    if not isinstance(runtime, dict):
        raise InstallError("manifest is missing runtime")
    deployment = runtime.get("deployment")
    if not isinstance(deployment, dict) or deployment.get("client") != "builda-online":
        raise InstallError("manifest runtime.deployment.client must be builda-online")
    languages = deployment.get("source_languages")
    if not isinstance(languages, list) or not languages:
        raise InstallError("manifest runtime.deployment.source_languages is invalid")
    for name in ("api_base_url", "gateway_url", "builda_agent_api_base_url", "builda_setup_url"):
        if not isinstance(runtime.get(name), str) or not runtime[name]:
            raise InstallError(f"manifest runtime.{name} is missing")
    for name in ("room_contract_version", "local_mock_protocol_version"):
        if not isinstance(manifest.get(name), str) or not manifest[name]:
            raise InstallError(f"manifest {name} is missing")
    if "local_room_runner" in manifest:
        raise InstallError("manifest still contains the retired local_room_runner")
    for section in ("skill", "diagnostics_skill"):
        _validate_artifact_entry(manifest.get(section), section)
    for section, keys in (("client_sdks", CLIENT_SDKS), ("server_sdks", ROOM_LANGUAGES), ("room_mocks", ROOM_LANGUAGES)):
        entries = manifest.get(section)
        if not isinstance(entries, dict):
            raise InstallError(f"manifest is missing {section}")
        for key in keys:
            if key in entries:
                _validate_artifact_entry(entries[key], f"{section}.{key}")
    mocks = manifest["room_mocks"]
    behavior = mocks.get("behavior")
    if not isinstance(behavior, dict):
        raise InstallError("manifest room_mocks.behavior is missing")
    for name, expected in (
        ("rooms_per_process", 1),
        ("transport", "local_mock_websocket"),
        ("room_runtime", "language_mock"),
        ("executes_room_source", True),
        ("builds_wasm", False),
        ("uses_webrtc", False),
        ("simulates_real_auth", False),
        ("simulates_matchmaking", False),
        ("provides_security_isolation", False),
    ):
        if behavior.get(name) != expected:
            raise InstallError(f"manifest room_mocks.behavior.{name} must be {expected!r}")
    for language in ROOM_LANGUAGES:
        mock = mocks.get(language)
        if mock is None:
            continue
        if mock.get("archive_layout") != "project_root" or mock.get("install_directory") != ".":
            raise InstallError(f"manifest room_mocks.{language} must be a project_root overlay")
        if mock.get("contracts_directory") != "contracts":
            raise InstallError(f"manifest room_mocks.{language}.contracts_directory must be contracts")
        for name in ("package_directory", "sdk_directory"):
            _relative_directory(mock.get(name), f"room_mocks.{language}.{name}")
        if mock.get("supports_sequential_rooms") is not True:
            raise InstallError(f"manifest room_mocks.{language} must support sequential rooms")


def _validate_artifact_entry(entry: Any, label: str) -> None:
    if not isinstance(entry, dict):
        raise InstallError(f"manifest {label} is missing")
    version = entry.get("version")
    if not isinstance(version, str) or not SDK_VERSION_PATTERN.fullmatch(version):
        raise InstallError(f"manifest {label}.version is invalid")
    url = entry.get("download_url")
    if not isinstance(url, str):
        raise InstallError(f"manifest {label}.download_url is missing")
    _validate_public_url(url, f"{label}.download_url")
    digest = entry.get("sha256")
    if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise InstallError(f"manifest {label}.sha256 is invalid")


def _manifest_public_base_url(manifest: dict[str, Any]) -> str:
    value = manifest.get("public_base_url")
    if not isinstance(value, str):
        raise InstallError("manifest public_base_url is missing")
    _validate_public_url(value, "public_base_url")
    if value.endswith("/"):
        raise InstallError("manifest public_base_url must not end with /")
    return value


def _relative_directory(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise InstallError(f"manifest {label} is missing")
    parts = Path(value).parts
    if Path(value).is_absolute() or not parts or any(part in {"", ".", ".."} for part in parts):
        raise InstallError(f"manifest {label} must be a relative directory inside the project")
    return value


def _validate_public_url(url: str, label: str) -> None:
    parsed = urllib.parse.urlsplit(url)
    if parsed.username or parsed.password or parsed.query or parsed.fragment or not parsed.hostname:
        raise InstallError(f"{label} must be a plain https URL")
    if parsed.scheme == "https":
        return
    if parsed.scheme == "http" and parsed.hostname in LOOPBACK_HOSTS:
        return
    raise InstallError(f"{label} must use https")


def _fetch_bytes(url: str, label: str) -> bytes:
    _validate_public_url(url, label)
    request = urllib.request.Request(url, headers={"User-Agent": "builda-online-install"})
    opener = urllib.request.build_opener(_NoRedirect())
    try:
        with opener.open(request, timeout=60) as response:
            body = response.read(MAX_ARTIFACT_BYTES + 1)
    except Exception as error:  # noqa: BLE001 - convert uniformly into a readable install error
        raise InstallError(f"Download failed for {label}: {url}: {error}") from error
    if len(body) > MAX_ARTIFACT_BYTES:
        raise InstallError(f"{label} exceeds the maximum artifact size")
    return body


def _fetch_json(url: str) -> dict[str, Any]:
    try:
        value = json.loads(_fetch_bytes(url, "manifest").decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise InstallError(f"manifest is not valid JSON: {url}") from error
    if not isinstance(value, dict):
        raise InstallError(f"manifest root must be an object: {url}")
    return value


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Deliverable URLs are locked by the manifest; redirects are not followed."""

    def redirect_request(self, *_args: Any, **_kwargs: Any) -> None:  # type: ignore[override]
        return None


# ---------------------------------------------------------------------------
# Select engine and Room language


def _load_previous_installation(project_root: Path) -> Optional[dict[str, Any]]:
    path = project_root / STATE_DIRECTORY / "installation.json"
    if not path.is_file():
        return None
    try:
        return read_json(path)
    except ConfigError as error:
        raise InstallError(f"Existing installation record is unreadable; delete it to reinstall: {error}") from error


def _previous_manifest_url(previous: Optional[dict[str, Any]]) -> Optional[str]:
    if not previous:
        return None
    for name in ("immutableManifestUrl", "manifestUrl"):
        value = previous.get(name)
        if isinstance(value, str) and value:
            return value
    base = previous.get("publicBaseUrl")
    if isinstance(base, str) and base:
        return f"{base.rstrip('/')}/manifest.json"
    return None


def _select_client_sdk(project_root: Path, requested: Optional[str], previous: Optional[dict[str, Any]]) -> str:
    if requested:
        if requested not in CLIENT_SDKS:
            raise InstallError(f"Unsupported client SDK: {requested}")
        return requested
    recorded = previous.get("clientSdk") if previous else None
    if isinstance(recorded, str) and recorded in CLIENT_SDKS:
        return recorded
    detected = detect_client_sdk(project_root)
    if detected is None:
        raise InstallError("Cannot determine the client engine; pass --client-sdk godot|h5|cocos|unity")
    return detected


def detect_client_sdk(project_root: Path) -> Optional[str]:
    """Determine the single client engine from project evidence; return None when evidence conflicts or is missing."""

    candidates: set[str] = set()
    if (project_root / "project.godot").is_file():
        candidates.add("godot")
    if (project_root / "ProjectSettings" / "ProjectVersion.txt").is_file():
        candidates.add("unity")
    package_json = project_root / "package.json"
    if package_json.is_file():
        try:
            package = read_json(package_json)
        except ConfigError:
            package = {}
        if isinstance(package.get("creator"), dict):
            candidates.add("cocos")
        elif not candidates:
            candidates.add("h5")
    elif (project_root / "index.html").is_file() and not candidates:
        candidates.add("h5")
    if len(candidates) != 1:
        return None
    return next(iter(candidates))


def _select_room_language(
    project_root: Path,
    requested: Optional[str],
    previous: Optional[dict[str, Any]],
    manifest: dict[str, Any],
) -> str:
    if requested:
        if requested not in ROOM_LANGUAGES:
            raise InstallError(f"Unsupported Room language: {requested}")
        language = requested
    else:
        recorded = previous.get("roomLanguage") if previous else None
        if isinstance(recorded, str) and recorded in ROOM_LANGUAGES:
            language = recorded
        else:
            detected = detect_room_language(project_root)
            if detected is None:
                raise InstallError("Cannot determine the Room language; pass --room-language typescript|rust")
            language = detected
    support = manifest["support"]
    deployment_languages = manifest["runtime"]["deployment"]["source_languages"]
    if (
        language not in support["server_languages"]
        or language not in support["local_mock_languages"]
        or language not in deployment_languages
        or language not in manifest["server_sdks"]
        or language not in manifest["room_mocks"]
    ):
        raise InstallError(f"The pinned release does not deliver {language} Room support")
    return language


def detect_room_language(project_root: Path) -> Optional[str]:
    """Determine the single language from Room dependency evidence; return None when absent or conflicting."""

    evidence: set[str] = set()
    for cargo in _walk_named(project_root, "Cargo.toml"):
        try:
            text = cargo.read_text(encoding="utf-8")
        except OSError:
            continue
        if "cysj-room-sdk" in text or "cysj-room-mock" in text:
            evidence.add("rust")
    for package in _walk_named(project_root, "package.json"):
        try:
            text = package.read_text(encoding="utf-8")
        except OSError:
            continue
        if "@cysj/room" in text:
            evidence.add("typescript")
    if len(evidence) != 1:
        return None
    return next(iter(evidence))


def _walk_named(root: Path, name: str, max_depth: int = 3) -> list[Path]:
    found: list[Path] = []
    skip = {"node_modules", "target", ".git", ".godot", "Library", "vendor", ".builda-online", ".agents"}

    def visit(directory: Path, depth: int) -> None:
        try:
            entries = sorted(directory.iterdir())
        except OSError:
            return
        for entry in entries:
            if entry.name in skip:
                continue
            if entry.is_file() and entry.name == name:
                found.append(entry)
            elif entry.is_dir() and not entry.is_symlink() and depth < max_depth:
                visit(entry, depth + 1)

    visit(root, 0)
    return found


# ---------------------------------------------------------------------------
# Component plan and reuse decisions


def _component_plans(manifest: dict[str, Any], client_sdk: str, room_language: str) -> dict[str, ComponentPlan]:
    if client_sdk not in manifest["client_sdks"] or client_sdk not in manifest["support"]["client_engines"]:
        raise InstallError(f"The pinned release does not deliver a {client_sdk} client SDK")
    entries = {
        "skill": manifest["skill"],
        "diagnostics_skill": manifest["diagnostics_skill"],
        "client_sdk": manifest["client_sdks"][client_sdk],
        "server_sdk": manifest["server_sdks"][room_language],
        "room_mock": manifest["room_mocks"][room_language],
    }
    mock = manifest["room_mocks"][room_language]
    if mock.get("sdk_version") != entries["server_sdk"]["version"]:
        raise InstallError("manifest room_mocks sdk_version does not match server_sdks version")
    return {
        key: ComponentPlan(key, entry["version"], entry["download_url"], entry["sha256"])
        for key, entry in entries.items()
    }


def _component_current(
    project_root: Path,
    plan: ComponentPlan,
    previous_components: dict[str, Any],
    client_sdk: str,
    room_language: str,
    mock_entry: dict[str, Any],
) -> bool:
    """Reuse components whose recorded digest and on-disk version both match, without re-downloading."""

    recorded = previous_components.get(plan.key)
    if not isinstance(recorded, dict) or recorded.get("sha256") != plan.sha256 or recorded.get("version") != plan.version:
        return False
    try:
        if plan.key == "skill":
            _verify_skill_layout(project_root / SKILL_DIRECTORY, plan.version, require_bin=True)
        elif plan.key == "diagnostics_skill":
            _verify_skill_layout(project_root / DIAGNOSTICS_SKILL_DIRECTORY, plan.version, require_bin=False)
        elif plan.key == "client_sdk":
            _verify_client_sdk_version(project_root / CLIENT_SDK_DIRECTORIES[client_sdk], client_sdk, plan.version)
        elif plan.key == "server_sdk":
            _verify_language_package_version(project_root / str(mock_entry["sdk_directory"]), room_language, plan.version)
        elif plan.key == "room_mock":
            _verify_language_package_version(project_root / str(mock_entry["package_directory"]), room_language, plan.version)
            if not (project_root / "contracts" / "resource-limits.json").is_file():
                return False
    except InstallError:
        return False
    return True


def _download_verified(plan: ComponentPlan, staging: Path) -> Path:
    body = _fetch_bytes(plan.download_url, plan.key)
    digest = hashlib.sha256(body).hexdigest()
    if digest != plan.sha256:
        raise InstallError(f"{plan.key} SHA-256 mismatch: expected {plan.sha256}, got {digest}")
    suffix = ".zip" if plan.download_url.endswith(".zip") else ".tar.gz"
    target = staging / f"{plan.key}{suffix}"
    target.write_bytes(body)
    return target


# ---------------------------------------------------------------------------
# Archive extraction (reject path escapes, links, and device files)


def _extract_single_root(archive: Path, destination: Path) -> Path:
    destination.mkdir(parents=True, exist_ok=True)
    if archive.suffix == ".zip":
        _extract_zip(archive, destination)
    else:
        _extract_tar(archive, destination)
    entries = [entry for entry in destination.iterdir()]
    if len(entries) != 1 or not entries[0].is_dir():
        raise InstallError(f"Archive must contain exactly one top-level directory: {archive.name}")
    return entries[0]


def _safe_member_path(destination: Path, name: str) -> Path:
    normalized = name.replace("\\", "/")
    parts = [part for part in normalized.split("/") if part not in {"", "."}]
    if not parts or ".." in parts or normalized.startswith("/") or re.match(r"^[A-Za-z]:", normalized):
        raise InstallError(f"Archive member escapes the destination: {name}")
    return destination.joinpath(*parts)


def _extract_zip(archive: Path, destination: Path) -> None:
    try:
        with zipfile.ZipFile(archive) as bundle:
            for info in bundle.infolist():
                target = _safe_member_path(destination, info.filename)
                mode = (info.external_attr >> 16) & 0o7777
                if stat.S_ISLNK(info.external_attr >> 16):
                    raise InstallError(f"Archive contains a symbolic link: {info.filename}")
                if info.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                with bundle.open(info) as source, open(target, "wb") as sink:
                    shutil.copyfileobj(source, sink)
                if mode & 0o111:
                    target.chmod(0o755)
    except zipfile.BadZipFile as error:
        raise InstallError(f"Invalid zip archive: {archive.name}") from error


def _extract_tar(archive: Path, destination: Path) -> None:
    try:
        with tarfile.open(archive, "r:gz") as bundle:
            for member in bundle.getmembers():
                target = _safe_member_path(destination, member.name)
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                if not member.isfile():
                    raise InstallError(f"Archive contains an unsupported member: {member.name}")
                target.parent.mkdir(parents=True, exist_ok=True)
                source = bundle.extractfile(member)
                if source is None:
                    raise InstallError(f"Archive member unreadable: {member.name}")
                with source, open(target, "wb") as sink:
                    shutil.copyfileobj(source, sink)
                if member.mode & 0o111:
                    target.chmod(0o755)
    except tarfile.TarError as error:
        raise InstallError(f"Invalid tar archive: {archive.name}") from error


# ---------------------------------------------------------------------------
# Managed directory writes


def _inside_project(project_root: Path, relative: Path) -> Path:
    target = (project_root / relative).resolve()
    try:
        target.relative_to(project_root)
    except ValueError as error:
        raise InstallError(f"Refusing to write outside the project: {relative}") from error
    return target


def _replace_directory(project_root: Path, relative: Path, source: Path) -> None:
    target = _inside_project(project_root, relative)
    if target == project_root:
        raise InstallError("Refusing to replace the project root")
    target.parent.mkdir(parents=True, exist_ok=True)
    staged = target.parent / f".{target.name}.builda-online-new"
    if staged.exists():
        shutil.rmtree(staged)
    shutil.copytree(source, staged, symlinks=False)
    if target.is_symlink():
        target.unlink()
    elif target.exists():
        shutil.rmtree(target)
    os.replace(staged, target)


def _verify_skill_layout(root: Path, version: str, *, require_bin: bool) -> None:
    version_file = root / "VERSION"
    if not version_file.is_file() or version_file.read_text(encoding="utf-8").strip() != version:
        raise InstallError(f"Skill VERSION does not match the manifest ({version}): {root}")
    if not (root / "SKILL.md").is_file():
        raise InstallError(f"Skill is missing SKILL.md: {root}")
    if require_bin:
        if not (root / "references" / "resource-limits.md").is_file():
            raise InstallError("Skill is missing references/resource-limits.md; the snapshot is incomplete")
        if not (root / "bin" / "builda-online.py").is_file() or not (root / "bin" / "builda_online").is_dir():
            raise InstallError("Skill is missing the builda-online deploy client under bin/")


def _sync_deploy_client(project_root: Path) -> bool:
    """Sync the Skill's bin/ into .builda-online/bin/; return whether anything changed."""

    source = project_root / SKILL_DIRECTORY / "bin"
    target = _inside_project(project_root, STATE_DIRECTORY / "bin")
    if not source.is_dir():
        raise InstallError("Installed Skill has no bin/ directory")
    if target.is_dir() and _tree_digest(source) == _tree_digest(target):
        return False
    _replace_directory(project_root, STATE_DIRECTORY / "bin", source)
    return True


def _tree_digest(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*")):
        if "__pycache__" in path.parts or not path.is_file():
            continue
        digest.update(path.relative_to(root).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def _running_from(project_root: Path) -> bool:
    """Decide whether the current client runs inside the project's .builda-online/bin."""

    try:
        Path(__file__).resolve().relative_to((project_root / STATE_DIRECTORY / "bin").resolve())
        return True
    except ValueError:
        return False


def _reexec_new_client(project_root: Path, request: InstallRequest, manifest_url: str) -> int:
    entry = project_root / STATE_DIRECTORY / "bin" / "builda-online.py"
    command = [
        sys.executable,
        str(entry),
        "upgrade" if request.upgrade else "install",
        "--project-root",
        str(project_root),
        "--manifest-url",
        manifest_url,
        "--no-reexec",
    ]
    if request.client_sdk:
        command += ["--client-sdk", request.client_sdk]
    if request.room_language:
        command += ["--room-language", request.room_language]
    sys.stdout.flush()
    completed = subprocess.run(command, check=False)
    return completed.returncode


def _install_client_sdk(project_root: Path, client_sdk: str, plan: ComponentPlan, archive: Path, staging: Path) -> None:
    root = _extract_single_root(archive, staging / "client-sdk")
    if client_sdk == "godot":
        source = root / "addons" / "cysj_online"
        if not source.is_dir():
            raise InstallError("Godot Online SDK archive is missing addons/cysj_online")
    else:
        source = root
    _verify_client_sdk_version(source, client_sdk, plan.version)
    _replace_directory(project_root, CLIENT_SDK_DIRECTORIES[client_sdk], source)


def _verify_client_sdk_version(directory: Path, client_sdk: str, version: str) -> None:
    if client_sdk == "godot":
        plugin = directory / "plugin.cfg"
        if not plugin.is_file():
            raise InstallError("Godot Online SDK is missing plugin.cfg")
        match = re.search(r'^version="([^"]+)"', plugin.read_text(encoding="utf-8"), re.MULTILINE)
        if not match or match.group(1) != version:
            raise InstallError(f"Godot Online SDK plugin.cfg version does not match the manifest ({version})")
        return
    package_path = directory / "package.json"
    if not package_path.is_file():
        raise InstallError(f"{client_sdk} Online SDK is missing package.json")
    try:
        package = read_json(package_path)
    except ConfigError as error:
        raise InstallError(str(error)) from error
    if package.get("name") != CLIENT_PACKAGE_NAMES[client_sdk]:
        raise InstallError(f"{client_sdk} Online SDK package name must be {CLIENT_PACKAGE_NAMES[client_sdk]}")
    if package.get("version") != version:
        raise InstallError(f"{client_sdk} Online SDK package version does not match the manifest ({version})")


def _install_room_overlay(
    project_root: Path,
    room_language: str,
    mock_entry: dict[str, Any],
    mock_plan: ComponentPlan,
    sdk_plan: ComponentPlan,
    archive: Path,
    staging: Path,
) -> None:
    """The Mock archive is a project-root overlay: replace only contracts/, the Mock package directory, and the same-language Room SDK directory."""

    root = _extract_single_root(archive, staging / "room-mock")
    package_directory = Path(_relative_directory(mock_entry["package_directory"], "package_directory"))
    sdk_directory = Path(_relative_directory(mock_entry["sdk_directory"], "sdk_directory"))
    contracts_directory = Path("contracts")
    for relative in (contracts_directory, package_directory, sdk_directory):
        if not (root / relative).is_dir():
            raise InstallError(f"Room Mock archive is missing {relative.as_posix()}")
    if not (root / contracts_directory / "resource-limits.json").is_file():
        raise InstallError("Room Mock archive is missing contracts/resource-limits.json")
    _verify_language_package_version(root / package_directory, room_language, mock_plan.version)
    _verify_language_package_version(root / sdk_directory, room_language, sdk_plan.version)
    for relative in (contracts_directory, package_directory, sdk_directory):
        _replace_directory(project_root, relative, root / relative)


def _verify_language_package_version(directory: Path, room_language: str, version: str) -> None:
    if room_language == "typescript":
        package_path = directory / "package.json"
        if not package_path.is_file():
            raise InstallError(f"TypeScript package is missing package.json: {directory}")
        try:
            package = read_json(package_path)
        except ConfigError as error:
            raise InstallError(str(error)) from error
        if package.get("version") != version:
            raise InstallError(f"TypeScript package version does not match the manifest ({version}): {directory}")
        return
    cargo = directory / "Cargo.toml"
    if not cargo.is_file():
        raise InstallError(f"Rust package is missing Cargo.toml: {directory}")
    match = re.search(r'^version\s*=\s*"([^"]+)"', cargo.read_text(encoding="utf-8"), re.MULTILINE)
    if not match or match.group(1) != version:
        raise InstallError(f"Rust package version does not match the manifest ({version}): {directory}")


def _wire_client_dependency(project_root: Path, client_sdk: str, emit: Callable[[str], None]) -> None:
    """Register the in-project client SDK as a local file dependency; H5 projects without a package manifest only get a hint."""

    directory = CLIENT_SDK_DIRECTORIES[client_sdk]
    if client_sdk == "godot":
        emit("clientSdkDependency=addons/cysj_online (enable the plugin in Project Settings)")
        return
    if client_sdk == "unity":
        manifest_path = project_root / "Packages" / "manifest.json"
        if not manifest_path.is_file():
            raise InstallError("Unity project is missing Packages/manifest.json")
        spec = f"file:../{directory.as_posix()}"
        _set_json_dependency(manifest_path, "dependencies", CLIENT_PACKAGE_NAMES["unity"], spec)
        emit(f"clientSdkDependency=Packages/manifest.json {CLIENT_PACKAGE_NAMES['unity']}={spec}")
        return
    package_path = project_root / "package.json"
    spec = f"file:{directory.as_posix()}"
    if not package_path.is_file():
        emit(
            f"clientSdkDependency=manual (no package.json; import {CLIENT_PACKAGE_NAMES[client_sdk]} "
            f"from {directory.as_posix()}/dist or add package.json with {spec})"
        )
        return
    _set_json_dependency(package_path, "dependencies", CLIENT_PACKAGE_NAMES[client_sdk], spec)
    emit(f"clientSdkDependency=package.json {CLIENT_PACKAGE_NAMES[client_sdk]}={spec}")


def _set_json_dependency(path: Path, section: str, name: str, spec: str) -> None:
    try:
        document = read_json(path)
    except ConfigError as error:
        raise InstallError(str(error)) from error
    for other in ("dependencies", "devDependencies", "optionalDependencies"):
        if other != section and isinstance(document.get(other), dict):
            document[other].pop(name, None)
    dependencies = document.get(section)
    if not isinstance(dependencies, dict):
        dependencies = {}
        document[section] = dependencies
    if dependencies.get(name) == spec:
        return
    dependencies[name] = spec
    _write_json(path, document)


def _ensure_gitignore(project_root: Path) -> None:
    path = project_root / ".gitignore"
    existing = path.read_text(encoding="utf-8") if path.is_file() else ""
    lines = {line.strip() for line in existing.splitlines()}
    if lines & {"/.builda-online/", "/.builda-online", ".builda-online/", ".builda-online"}:
        return
    separator = "" if not existing or existing.endswith("\n") else "\n"
    path.write_text(f"{existing}{separator}/.builda-online/\n", encoding="utf-8")


def _remove_legacy_manifest_check(project_root: Path) -> None:
    legacy = project_root / STATE_DIRECTORY / "manifest-check.json"
    if legacy.is_file():
        legacy.unlink()


def _ensure_state_directory(project_root: Path) -> Path:
    directory = project_root / STATE_DIRECTORY
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _room_sdk_dependency_hint(room_language: str, manifest: dict[str, Any]) -> str:
    sdk_directory = manifest["room_mocks"][room_language]["sdk_directory"]
    mock_directory = manifest["room_mocks"][room_language]["package_directory"]
    if room_language == "typescript":
        return f"@cysj/room=file:<relative path to {sdk_directory}>; @cysj/room-mock=file:<relative path to {mock_directory}>"
    return f'cysj-room-sdk = {{ path = "<relative path to {sdk_directory}>" }}; cysj-room-mock optional via local-mock feature'


def _installation_record(
    manifest: dict[str, Any],
    pin: str,
    immutable_manifest_url: str,
    client_sdk: str,
    room_language: str,
    plans: dict[str, ComponentPlan],
) -> dict[str, Any]:
    runtime = manifest["runtime"]
    mock = manifest["room_mocks"][room_language]
    return {
        "environment": manifest["environment"],
        "releaseId": pin,
        "sdkVersion": pin,
        "publicBaseUrl": manifest["public_base_url"],
        "manifestUrl": manifest["manifest_url"],
        "immutableManifestUrl": immutable_manifest_url,
        "setupUrl": manifest["setup_url"],
        "apiBaseUrl": runtime["api_base_url"],
        "buildaAgentApiBaseUrl": runtime["builda_agent_api_base_url"],
        "gatewayUrl": runtime["gateway_url"],
        "defaultQueueName": runtime.get("default_queue_name"),
        "skillVersion": plans["skill"].version,
        "diagnosticsSkillVersion": plans["diagnostics_skill"].version,
        "deployment": runtime["deployment"],
        "clientSdk": client_sdk,
        "clientSdkVersion": plans["client_sdk"].version,
        "clientProtocolVersion": manifest.get("client_protocol_version", 1),
        "roomLanguage": room_language,
        "serverSdkVersion": plans["server_sdk"].version,
        "roomMockVersion": plans["room_mock"].version,
        "roomContractVersion": manifest["room_contract_version"],
        "localMockProtocolVersion": manifest["local_mock_protocol_version"],
        "pythonInterpreter": str(Path(sys.executable).resolve()),
        "gameIdSource": ".builda-agent/game.json#gameId",
        "localRoomMock": {
            "gatewayUrl": "ws://127.0.0.1:7350/ws",
            "healthUrl": "http://127.0.0.1:7350/health",
            "configUrl": "http://127.0.0.1:7350/config",
            "implementation": mock.get("implementation"),
            "roomRuntime": "language_mock",
            "transport": "local_mock_websocket",
            "buildsWasm": False,
            "usesWebRtc": False,
            "simulatesMatchmaking": False,
            "providesSecurityIsolation": False,
        },
        "components": {
            key: {"version": plan.version, "sha256": plan.sha256} for key, plan in plans.items()
        },
        "installer": "builda-online install",
    }
