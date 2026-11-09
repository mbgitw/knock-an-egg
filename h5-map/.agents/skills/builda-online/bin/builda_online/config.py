"""Read and validate the Builda Online project configuration."""

from __future__ import annotations

import json
import re
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
RELEASE_ID_PATTERN = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
SDK_VERSION_PATTERN = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$")
DEFAULT_MAX_MATCH_SECONDS = 30 * 60
MAX_MAX_MATCH_SECONDS = 24 * 60 * 60
ROOM_STATE_PATH_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_.-]{0,127}$")
class ConfigError(ValueError):
    """Signals that the user project configuration violates the public deployment contract."""


@dataclass(frozen=True)
class Installation:
    """Hold the service URLs and deployment capabilities locked at install time for this project."""

    environment: str
    online_api_base_url: str
    builda_agent_api_base_url: str
    deployment_languages: tuple[str, ...]
    client_sdk: str
    client_sdk_version: str
    client_protocol_version: int
    room_language: str
    server_sdk_version: str
    room_contract_version: str
    python_interpreter: Optional[str] = None
    release_id: Optional[str] = None
    public_base_url: Optional[str] = None
    manifest_url: Optional[str] = None


@dataclass(frozen=True)
class ActivityConfig:
    """Hold the parameters for one Room build and Match Activity update."""

    match_key: str
    room_route: str
    room_type: str
    version: str
    team_count: int
    team_size: int
    tick_rate: int
    bot_policy: "BotPolicyConfig"
    lobby_policy: "LobbyPolicyConfig"
    match_policy: "MatchPolicyConfig"
    room_parameters: dict[str, str]
    manifest_path: Optional[str]
    package: Optional[str]

    def activation_body(self) -> dict[str, Any]:
        """Build the Control Plane public Match Activity request body."""

        return {
            "room_route": self.room_route,
            "room_type": self.room_type,
            "team_count": self.team_count,
            "team_size": self.team_size,
            "tick_rate": self.tick_rate,
            "bot_policy": self.bot_policy.activation_body(),
            "lobby_policy": self.lobby_policy.activation_body(),
            "match": self.match_policy.activation_body(
                self.version,
                self.match_key,
                self.room_route,
            ),
            "room_parameters": self.room_parameters,
        }


@dataclass(frozen=True)
class BotPolicyConfig:
    """Hold the Activity's bot backfill bounds."""

    enabled: bool
    default_fill_after_seconds: Optional[int]
    minimum_fill_after_seconds: int
    maximum_fill_after_seconds: int
    minimum_human_players: int
    maximum_bot_ratio: float

    def activation_body(self) -> dict[str, Any]:
        """Build the bot backfill policy used by the server."""

        return {
            "enabled": self.enabled,
            "default_fill_after_seconds": self.default_fill_after_seconds,
            "minimum_fill_after_seconds": self.minimum_fill_after_seconds,
            "maximum_fill_after_seconds": self.maximum_fill_after_seconds,
            "minimum_human_players": self.minimum_human_players,
            "maximum_bot_ratio": self.maximum_bot_ratio,
        }


@dataclass(frozen=True)
class LobbyPolicyConfig:
    """Hold the Activity's Lobby start bounds."""

    enabled: bool
    minimum_players: int
    maximum_players: int
    require_ready: bool
    allow_public: bool

    def activation_body(self) -> dict[str, Any]:
        """Build the Lobby policy used by the server."""

        return {
            "enabled": self.enabled,
            "minimum_players": self.minimum_players,
            "maximum_players": self.maximum_players,
            "require_ready": self.require_ready,
            "allow_public": self.allow_public,
        }


@dataclass(frozen=True)
class MatchPolicyConfig:
    """Hold the three Match capabilities and the Room join/resume policy."""

    mode: str
    max_score_diff: Optional[int]
    rank_expansion_stages: tuple[tuple[int, int], ...]
    max_match_seconds: int
    confirm_timeout_seconds: Optional[int]
    allowed_party_keys: tuple[str, ...]
    public_matchmaking: bool
    create_public_room: bool
    private_rooms_enabled: bool
    recovery: str
    heartbeat_millis: int
    suspect_millis: int
    disconnect_millis: int
    grace_millis: int

    def activation_body(
        self,
        version: str,
        match_key: str,
        room_route: str,
    ) -> dict[str, Any]:
        """Build the Match policy decided solely by deployment config, which Join requests cannot override."""

        return {
            "mode": self.mode,
            "game_version": version,
            "engine_version": "match-v1",
            "sub_id": match_key,
            "prepare_sub_id": room_route,
            "match_mode": self.mode,
            "client_version": version,
            "max_score_diff": self.max_score_diff,
            "rank_expansion_stages": [
                {"wait_seconds": wait_seconds, "max_score_diff": max_score_diff}
                for wait_seconds, max_score_diff in self.rank_expansion_stages
            ],
            "max_match_seconds": self.max_match_seconds,
            "confirm_timeout_seconds": self.confirm_timeout_seconds,
            "allowed_party_keys": list(self.allowed_party_keys),
            "room_policy": {
                "public_matchmaking": self.public_matchmaking,
                "create_public_room": self.create_public_room,
                "private_rooms_enabled": self.private_rooms_enabled,
                "recovery": self.recovery,
            },
            "reconnect_policy": {
                "heartbeat_millis": self.heartbeat_millis,
                "suspect_millis": self.suspect_millis,
                "disconnect_millis": self.disconnect_millis,
                "grace_millis": self.grace_millis,
            },
        }


@dataclass(frozen=True)
class PartyProfileConfig:
    """Hold the deploy-time authoritative partyKey and max member count."""

    party_key: str
    maximum_members: int

    def activation_body(self) -> dict[str, Any]:
        """Build the Control Plane Party Profile request body."""

        return {"maximum_members": self.maximum_members}


@dataclass(frozen=True)
class OnlineConfig:
    """Hold the game-level Builda Online v3 config and all match entries."""

    online_compatibility_revision: int
    activities: tuple[ActivityConfig, ...]
    party_profiles: tuple[PartyProfileConfig, ...]
    room_transfer: "RoomTransferConfig"

    @property
    def build_activity(self) -> ActivityConfig:
        """Return the first Activity, which shares the same source build parameters."""

        return self.activities[0]


@dataclass(frozen=True)
class RoomTransferConfig:
    """Hold the Room checkpoint and failure recovery bounds explicitly confirmed by the user."""

    snapshot_schema_version: int
    authoritative_state: tuple[str, ...]
    failure_recovery: str
    pause_budget_millis: int


def read_json(path: Path) -> dict[str, Any]:
    """Read a UTF-8 JSON object with stable errors."""

    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise ConfigError(f"Missing configuration file: {path}") from error
    except (OSError, json.JSONDecodeError) as error:
        raise ConfigError(f"Unable to read JSON configuration: {path}: {error}") from error
    if not isinstance(value, dict):
        raise ConfigError(f"JSON root must be an object: {path}")
    return value


def load_installation(project_root: Path) -> Installation:
    """Read the credential-free install record produced by setup."""

    value = read_json(project_root / ".builda-online" / "installation.json")
    environment = _required_string(value, "environment")
    if environment != "online":
        raise ConfigError("installation.json environment must be online; reinstall the Skill")
    deployment = value.get("deployment")
    if not isinstance(deployment, dict):
        raise ConfigError("installation.json is missing the deployment object")
    if deployment.get("client") != "builda-online":
        raise ConfigError("installation.json deployment.client must be builda-online")
    languages = deployment.get("source_languages")
    if not isinstance(languages, list) or not languages:
        raise ConfigError("installation.json is missing deployment.source_languages")
    normalized_languages = tuple(str(language).strip() for language in languages)
    if any(language not in {"typescript", "rust"} for language in normalized_languages):
        raise ConfigError("installation.json contains an unsupported deployment language")
    if len(set(normalized_languages)) != len(normalized_languages):
        raise ConfigError("installation.json deployment.source_languages must not contain duplicates")
    client_sdk = _required_string(value, "clientSdk")
    if client_sdk not in {"godot", "h5", "cocos", "unity"}:
        raise ConfigError("installation.json clientSdk must be godot, h5, cocos, or unity")
    client_sdk_version = _required_string(value, "clientSdkVersion")
    if not SDK_VERSION_PATTERN.fullmatch(client_sdk_version):
        raise ConfigError("installation.json clientSdkVersion must be a semantic version")
    client_protocol_version = _positive_integer(value, "clientProtocolVersion")
    if client_protocol_version != 1:
        raise ConfigError("installation.json clientProtocolVersion does not match the current client protocol")
    room_language = _required_string(value, "roomLanguage")
    if room_language not in normalized_languages:
        raise ConfigError("installation.json roomLanguage is not listed in deployment.source_languages")
    server_sdk_version = _required_string(value, "serverSdkVersion")
    if not SDK_VERSION_PATTERN.fullmatch(server_sdk_version):
        raise ConfigError("installation.json serverSdkVersion must be a semantic version")
    room_contract_version = _required_string(value, "roomContractVersion")
    if not SDK_VERSION_PATTERN.fullmatch(room_contract_version):
        raise ConfigError("installation.json roomContractVersion must be a semantic version")
    return Installation(
        environment=environment,
        online_api_base_url=_required_url(value, "apiBaseUrl"),
        builda_agent_api_base_url=_required_url(value, "buildaAgentApiBaseUrl"),
        deployment_languages=normalized_languages,
        client_sdk=client_sdk,
        client_sdk_version=client_sdk_version,
        client_protocol_version=client_protocol_version,
        room_language=room_language,
        server_sdk_version=server_sdk_version,
        room_contract_version=room_contract_version,
        python_interpreter=_optional_string(value, "pythonInterpreter"),
        release_id=_optional_release_id(value),
        public_base_url=_optional_string(value, "publicBaseUrl"),
        manifest_url=_optional_string(value, "immutableManifestUrl") or _optional_string(value, "manifestUrl"),
    )


def _optional_release_id(value: dict[str, Any]) -> Optional[str]:
    """Read the delivery snapshot version recorded by builda-online install; old manual installs lack this field."""

    release_id = _optional_string(value, "releaseId")
    if release_id is not None and not RELEASE_ID_PATTERN.fullmatch(release_id):
        raise ConfigError("installation.json releaseId must be a release version")
    return release_id


def read_sdk_pin(project_root: Path) -> Optional[str]:
    """Read the project's pinned Builda SDK version; return None when missing or invalid."""

    pin_path = project_root / ".builda-agent" / "sdk-version"
    if not pin_path.is_file():
        return None
    pin = pin_path.read_text(encoding="utf-8").strip()
    return pin if RELEASE_ID_PATTERN.fullmatch(pin) else None


def assert_release_matches_sdk_pin(project_root: Path, installation: Installation) -> Optional[str]:
    """The Online delivery snapshot must equal the project's Builda SDK version pin; return the current pin.

    Records written by `builda-online install` carry `releaseId`; after `builda sdk upgrade` advances the pin,
    run `builda-online upgrade` so multiplayer deliverables catch up; never deploy with a drifted version. Old manual installs lack
    `releaseId` and only return the pin for the caller to report.
    """

    pin = read_sdk_pin(project_root)
    release_id = getattr(installation, "release_id", None)
    if release_id is None:
        return pin
    if pin is None:
        raise ConfigError(
            "Builda SDK pin .builda-agent/sdk-version is missing while Builda Online is installed; "
            "run ./.builda-agent/builda sdk install first"
        )
    if pin != release_id:
        raise ConfigError(
            "ONLINE_RELEASE_DRIFT: Builda Online was installed from release "
            f"{release_id} but the project pins Builda SDK {pin}; "
            "run ./.builda-online/bin/builda-online upgrade"
        )
    return pin


def validate_client_sdk_installation(project_root: Path, installation: Installation) -> str:
    """Check the project's actual client SDK against the install record version and reject silent drift."""

    detected_versions = _installed_client_sdk_versions(project_root, installation.client_sdk)
    if not detected_versions:
        raise ConfigError(
            f"Installed {installation.client_sdk} client SDK was not found; run Builda Online setup again"
        )
    versions = set(detected_versions.values())
    if len(versions) != 1:
        raise ConfigError(
            f"Multiple {installation.client_sdk} SDK versions are installed: {', '.join(sorted(versions))}"
        )
    detected = next(iter(versions))
    if detected != installation.client_sdk_version:
        raise ConfigError(
            "Client SDK version drift from installation.json: "
            f"recorded {installation.client_sdk_version}, detected {detected}; reinstall Builda Online"
        )
    return detected


def _installed_client_sdk_versions(project_root: Path, client_sdk: str) -> dict[Path, str]:
    """Read the client SDK version from each engine's managed install location."""

    project_root = project_root.resolve()
    candidates: list[tuple[Path, str, str]] = []
    if client_sdk == "godot":
        plugin = project_root / "addons" / "cysj_online" / "plugin.cfg"
        if plugin.is_file():
            match = re.search(r'^version="([^"]+)"', plugin.read_text(encoding="utf-8"), re.MULTILINE)
            if not match:
                raise ConfigError("Godot Builda Online plugin.cfg is missing version")
            return {plugin: _validated_sdk_version(match.group(1), plugin)}
        return {}

    if client_sdk in {"h5", "cocos"}:
        package_name = "@cysj/online-h5" if client_sdk == "h5" else "@cysj/online-cocos"
        package_directory = "h5" if client_sdk == "h5" else "cocos"
        package_label = "H5" if client_sdk == "h5" else "Cocos"
        candidates.extend(
            [
                (
                    project_root / ".builda-online" / "client-sdk" / package_directory / "package.json",
                    package_name,
                    package_label,
                ),
                (
                    project_root / "vendor" / "builda-online" / "client-sdk" / package_directory / "package.json",
                    package_name,
                    package_label,
                ),
                (
                    project_root / "node_modules" / "@cysj" / f"online-{package_directory}" / "package.json",
                    package_name,
                    package_label,
                ),
            ]
        )
        dependency = _local_dependency_package(
            project_root,
            project_root / "package.json",
            package_name,
        )
        if dependency is not None:
            candidates.append((dependency, package_name, package_label))
    elif client_sdk == "unity":
        candidates.extend(
            [
                (
                    project_root / ".builda-online" / "client-sdk" / "unity" / "package.json",
                    "com.cysj.online",
                    "Unity",
                ),
                (
                    project_root / "vendor" / "builda-online" / "client-sdk" / "unity" / "package.json",
                    "com.cysj.online",
                    "Unity",
                ),
                (
                    project_root / "Packages" / "com.cysj.online" / "package.json",
                    "com.cysj.online",
                    "Unity",
                ),
            ]
        )
        dependency = _local_dependency_package(
            project_root,
            project_root / "Packages" / "manifest.json",
            "com.cysj.online",
        )
        if dependency is not None:
            candidates.append((dependency, "com.cysj.online", "Unity"))

    versions: dict[Path, str] = {}
    for package_path, expected_name, label in candidates:
        if not package_path.is_file() or package_path in versions:
            continue
        package = read_json(package_path)
        if package.get("name") != expected_name:
            raise ConfigError(f"Invalid {label} SDK package name: {package_path}")
        versions[package_path] = _validated_sdk_version(
            _required_string(package, "version"),
            package_path,
        )
    return versions


def _local_dependency_package(
    project_root: Path,
    manifest_path: Path,
    package_name: str,
) -> Optional[Path]:
    """Resolve local file/link SDK packages in the project manifest that point inside the project."""

    if not manifest_path.is_file():
        return None
    manifest = read_json(manifest_path)
    dependency_value: Any = None
    for section_name in ("dependencies", "devDependencies", "optionalDependencies"):
        section = manifest.get(section_name)
        if isinstance(section, dict) and package_name in section:
            dependency_value = section[package_name]
            break
    if not isinstance(dependency_value, str):
        return None
    prefix = next(
        (candidate for candidate in ("file:", "link:") if dependency_value.startswith(candidate)),
        None,
    )
    if prefix is None:
        return None
    package_directory = (manifest_path.parent / dependency_value[len(prefix):]).resolve()
    try:
        package_directory.relative_to(project_root.resolve())
    except ValueError as error:
        raise ConfigError(f"Local package {package_name} must be installed inside the project directory") from error
    return package_directory / "package.json"


def _validated_sdk_version(version: str, source: Path) -> str:
    """Validate the semantic version in SDK metadata and return the normalized value."""

    normalized = version.strip()
    if not SDK_VERSION_PATTERN.fullmatch(normalized):
        raise ConfigError(f"Invalid client SDK version: {source}")
    return normalized


def load_game_id(project_root: Path) -> str:
    """Read gameId only from the official Builda project binding file."""

    value = read_json(project_root / ".builda-agent" / "game.json")
    game_id = value.get("gameId")
    if not isinstance(game_id, str) or not game_id.strip():
        raise ConfigError(".builda-agent/game.json is missing a valid gameId")
    return game_id.strip()


def load_online_config(path: Path, language: str) -> OnlineConfig:
    """Read the Builda Online v3 config including the Room transfer declaration."""

    value = read_json(path)
    if value.get("schemaVersion") != 3:
        raise ConfigError("builda.online.json schemaVersion must be 3")
    online_compatibility_revision = _positive_integer(value, "onlineCompatibilityRevision")
    room_transfer = _room_transfer(value.get("roomTransfer"))
    manifest_path = _optional_string(value, "manifestPath")
    package = _optional_string(value, "package")
    if language == "typescript" and (manifest_path or package):
        raise ConfigError("TypeScript configuration cannot contain Rust manifestPath or package")
    if language == "rust" and (not manifest_path or not package):
        raise ConfigError("Rust configuration must contain manifestPath and package")
    if package and not TOKEN_PATTERN.fullmatch(package):
        raise ConfigError("package must contain 1-64 letters, digits, dots, underscores, or hyphens")

    room_route = _token(value, "roomRoute")
    room_type = _token(value, "roomType")
    version = _token(value, "version")
    tick_rate = _positive_integer(value, "tickRate")
    if tick_rate > 240:
        raise ConfigError("tickRate must not exceed 240")
    common_parameters = _room_parameters(value.get("roomParameters"), "roomParameters")

    raw_party_keys = value.get("partyKeys", {})
    if not isinstance(raw_party_keys, dict) or len(raw_party_keys) > 32:
        raise ConfigError("partyKeys must be an object with at most 32 entries")
    party_profiles: list[PartyProfileConfig] = []
    for party_key in sorted(raw_party_keys):
        if not TOKEN_PATTERN.fullmatch(party_key):
            raise ConfigError(f"Invalid partyKey: {party_key}")
        profile = raw_party_keys[party_key]
        if not isinstance(profile, dict):
            raise ConfigError(f"partyKeys.{party_key} must be an object")
        maximum_members = _positive_integer(profile, "maxMembers")
        if maximum_members > 10:
            raise ConfigError(f"partyKeys.{party_key}.maxMembers must not exceed 10")
        party_profiles.append(PartyProfileConfig(party_key, maximum_members))

    raw_match_keys = value.get("matchKeys")
    if not isinstance(raw_match_keys, dict) or not raw_match_keys or len(raw_match_keys) > 64:
        raise ConfigError("matchKeys must be an object with 1 to 64 entries")
    known_party_keys = {profile.party_key for profile in party_profiles}
    activities: list[ActivityConfig] = []
    for match_key in sorted(raw_match_keys):
        if not TOKEN_PATTERN.fullmatch(match_key):
            raise ConfigError(f"Invalid matchKey: {match_key}")
        entry = raw_match_keys[match_key]
        if not isinstance(entry, dict):
            raise ConfigError(f"matchKeys.{match_key} must be an object")
        team_count = _positive_integer(entry, "teamCount")
        team_size = _positive_integer(entry, "teamSize")
        capacity = team_count * team_size
        if capacity > 50:
            raise ConfigError(f"matchKeys.{match_key} Room capacity must not exceed 50 players")
        raw_allowed = entry.get("partyKeys", [])
        if not isinstance(raw_allowed, list) or any(not isinstance(item, str) for item in raw_allowed):
            raise ConfigError(f"matchKeys.{match_key}.partyKeys must be an array of strings")
        allowed_party_keys = tuple(sorted(set(raw_allowed)))
        if len(allowed_party_keys) != len(raw_allowed):
            raise ConfigError(f"matchKeys.{match_key}.partyKeys must not contain duplicates")
        unknown = set(allowed_party_keys) - known_party_keys
        if unknown:
            raise ConfigError(f"matchKeys.{match_key} references undeclared partyKey: {sorted(unknown)[0]}")
        parameters = dict(common_parameters)
        parameters.update(
            _room_parameters(entry.get("roomParameters"), f"matchKeys.{match_key}.roomParameters")
        )
        activities.append(
            ActivityConfig(
                match_key=match_key,
                room_route=room_route,
                room_type=room_type,
                version=version,
                team_count=team_count,
                team_size=team_size,
                tick_rate=tick_rate,
                bot_policy=_bot_policy(entry.get("botPolicy"), capacity),
                lobby_policy=_lobby_policy(entry.get("lobbyPolicy"), capacity),
                match_policy=_match_policy(entry, allowed_party_keys),
                room_parameters=parameters,
                manifest_path=manifest_path,
                package=package,
            )
        )
    return OnlineConfig(
        online_compatibility_revision,
        tuple(activities),
        tuple(party_profiles),
        room_transfer,
    )


def _room_transfer(value: Any) -> RoomTransferConfig:
    """Require the user to explicitly declare the Room's complete migratable authoritative state before publishing."""

    if not isinstance(value, dict):
        raise ConfigError("roomTransfer must be an object")
    snapshot_schema_version = _positive_integer(value, "snapshotSchemaVersion")
    if snapshot_schema_version > 65535:
        raise ConfigError("roomTransfer.snapshotSchemaVersion must not exceed 65535")
    authoritative_state = value.get("authoritativeState")
    if (
        not isinstance(authoritative_state, list)
        or not authoritative_state
        or len(authoritative_state) > 128
        or any(
            not isinstance(path, str) or not ROOM_STATE_PATH_PATTERN.fullmatch(path)
            for path in authoritative_state
        )
    ):
        raise ConfigError("roomTransfer.authoritativeState must contain 1 to 128 stable state paths")
    normalized_state = tuple(dict.fromkeys(authoritative_state))
    if len(normalized_state) != len(authoritative_state):
        raise ConfigError("roomTransfer.authoritativeState must not contain duplicates")
    failure_recovery = value.get("failureRecovery")
    if failure_recovery != "latest-checkpoint":
        raise ConfigError("roomTransfer.failureRecovery must be latest-checkpoint")
    pause_budget_millis = _positive_integer(value, "pauseBudgetMillis")
    if pause_budget_millis != 1000:
        raise ConfigError("roomTransfer.pauseBudgetMillis must currently be 1000")
    return RoomTransferConfig(
        snapshot_schema_version,
        normalized_state,
        failure_recovery,
        pause_budget_millis,
    )


def _room_parameters(value: Any, field: str) -> dict[str, str]:
    """Read a non-secret Room string parameter."""

    if value is None:
        return {}
    if not isinstance(value, dict) or any(
        not isinstance(key, str) or not isinstance(item, str)
        for key, item in value.items()
    ):
        raise ConfigError(f"{field} must be an object with string keys and values")
    return dict(value)

def detect_language(source: Path) -> str:
    """Determine the Room language from the public input shape without probing the other language's toolchain."""

    if source.is_file() and source.suffix.lower() == ".ts":
        return "typescript"
    if source.is_dir():
        has_typescript_entry = (source / "room.ts").is_file()
        has_rust_manifest = (source / "Cargo.toml").is_file()
        if has_typescript_entry and has_rust_manifest:
            raise ConfigError("Room source directory cannot be both a TypeScript and Rust entry point")
        if has_typescript_entry:
            return "typescript"
        if has_rust_manifest:
            return "rust"
    raise ConfigError("Room source must be a .ts file, a TypeScript directory containing room.ts, or a Rust Cargo workspace")


def _required_string(value: dict[str, Any], name: str) -> str:
    """Read a required non-empty string."""

    item = value.get(name)
    if not isinstance(item, str) or not item.strip():
        raise ConfigError(f"Missing or invalid field: {name}")
    return item.strip()


def _required_url(value: dict[str, Any], name: str) -> str:
    """Read an absolute HTTP(S) service URL from the install record."""

    item = _required_string(value, name).rstrip("/")
    parsed = urllib.parse.urlparse(item)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ConfigError(f"{name} must be an absolute HTTP(S) URL")
    if parsed.query or parsed.fragment:
        raise ConfigError(f"{name} cannot contain query or fragment")
    return item


def _optional_string(value: dict[str, Any], name: str) -> Optional[str]:
    """Read an optional non-empty string."""

    item = value.get(name)
    if item is None:
        return None
    if not isinstance(item, str) or not item.strip():
        raise ConfigError(f"{name} must be a non-empty string")
    return item.strip()


def _token(value: dict[str, Any], name: str) -> str:
    """Read a restricted public identifier."""

    item = _required_string(value, name)
    if not TOKEN_PATTERN.fullmatch(item):
        raise ConfigError(f"{name} must contain 1-64 letters, digits, dots, underscores, or hyphens")
    return item


def _positive_integer(value: dict[str, Any], name: str) -> int:
    """Read a strictly positive integer, rejecting booleans."""

    item = value.get(name)
    if isinstance(item, bool) or not isinstance(item, int) or item <= 0:
        raise ConfigError(f"{name} must be a positive integer")
    return item


def _bot_policy(value: Any, capacity: int) -> BotPolicyConfig:
    """Read the bot backfill policy fully frozen by the Activity."""

    if value is None:
        return BotPolicyConfig(False, None, 0, 0, 1, 0.0)
    if not isinstance(value, dict):
        raise ConfigError("botPolicy must be an object")
    enabled = _boolean(value, "enabled", False)
    if "clientCanChoose" in value:
        raise ConfigError("botPolicy.clientCanChoose has been removed; clients cannot upload or select bot policies")
    default_fill = _optional_non_negative_integer(value, "defaultFillAfterSeconds")
    minimum_fill = _non_negative_integer(value, "minimumFillAfterSeconds", 0)
    maximum_fill = _non_negative_integer(value, "maximumFillAfterSeconds", 0)
    minimum_humans = _integer_with_default(value, "minimumHumanPlayers", 1)
    maximum_ratio = value.get("maximumBotRatio", 0.0)
    if isinstance(maximum_ratio, bool) or not isinstance(maximum_ratio, (int, float)):
        raise ConfigError("botPolicy.maximumBotRatio must be a number")
    maximum_ratio = float(maximum_ratio)
    if enabled:
        if default_fill is None:
            raise ConfigError("botPolicy.defaultFillAfterSeconds is required when botPolicy.enabled is true")
        if minimum_fill > maximum_fill:
            raise ConfigError("botPolicy fill-delay range is invalid")
        if default_fill is not None and not minimum_fill <= default_fill <= maximum_fill:
            raise ConfigError("botPolicy.defaultFillAfterSeconds is outside the allowed range")
        if minimum_humans <= 0 or minimum_humans >= capacity:
            raise ConfigError("botPolicy.minimumHumanPlayers exceeds Room capacity")
        if not 1.0 / capacity <= maximum_ratio < 1.0:
            raise ConfigError("botPolicy.maximumBotRatio must allow at least one bot and be less than 1")
    elif default_fill is not None:
        raise ConfigError("botPolicy.defaultFillAfterSeconds cannot be set when botPolicy is disabled")
    return BotPolicyConfig(
        enabled,
        default_fill,
        minimum_fill,
        maximum_fill,
        minimum_humans,
        maximum_ratio,
    )


def _lobby_policy(value: Any, capacity: int) -> LobbyPolicyConfig:
    """Read the Lobby policy and ensure its player bounds do not exceed Activity capacity."""

    if value is None:
        return LobbyPolicyConfig(False, 1, capacity, True, False)
    if not isinstance(value, dict):
        raise ConfigError("lobbyPolicy must be an object")
    enabled = _boolean(value, "enabled", False)
    minimum_players = _integer_with_default(value, "minimumPlayers", 1)
    maximum_players = _integer_with_default(value, "maximumPlayers", capacity)
    require_ready = _boolean(value, "requireReady", True)
    allow_public = _boolean(value, "allowPublic", False)
    if enabled and (
        minimum_players <= 0
        or minimum_players > maximum_players
        or maximum_players > capacity
    ):
        raise ConfigError("lobbyPolicy player-count range exceeds Activity capacity")
    if not enabled and allow_public:
        raise ConfigError("Public Lobby cannot be enabled when lobbyPolicy is disabled")
    return LobbyPolicyConfig(
        enabled,
        minimum_players,
        maximum_players,
        require_ready,
        allow_public,
    )


def _match_policy(value: Any, allowed_party_keys: tuple[str, ...]) -> MatchPolicyConfig:
    """Read the matchKey's public matching, private room, confirmation, ranked, and reconnect policies."""

    if not isinstance(value, dict):
        raise ConfigError("matchKey configuration must be an object")
    mode = _required_string(value, "mode")
    if mode not in {"room", "pool", "rank_pool"}:
        raise ConfigError("mode must be room, pool, or rank_pool")
    max_score_diff = _optional_non_negative_integer(value, "maxScoreDiff")
    if mode == "rank_pool" and (max_score_diff is None or max_score_diff == 0):
        raise ConfigError("rank_pool requires a positive integer maxScoreDiff")
    if mode != "rank_pool" and max_score_diff is not None:
        raise ConfigError("Only rank_pool may configure maxScoreDiff")
    max_match_seconds = _integer_with_default(
        value, "maxMatchSeconds", DEFAULT_MAX_MATCH_SECONDS
    )
    if max_match_seconds <= 0 or max_match_seconds > MAX_MAX_MATCH_SECONDS:
        raise ConfigError("maxMatchSeconds must be between 1 and 86400")
    rank_expansion_stages = _rank_expansion_stages(
        value.get("expansionStages"), mode, max_score_diff, max_match_seconds
    )
    confirm_timeout = value.get("confirmTimeoutSeconds")
    if mode == "room":
        if confirm_timeout is not None:
            raise ConfigError("room mode has no Confirm phase and cannot configure confirmTimeoutSeconds")
        parsed_confirm_timeout = None
    else:
        parsed_confirm_timeout = 30 if confirm_timeout is None else confirm_timeout
        if (
            isinstance(parsed_confirm_timeout, bool)
            or not isinstance(parsed_confirm_timeout, int)
            or not 1 <= parsed_confirm_timeout <= 60
        ):
            raise ConfigError("pool and rank_pool confirmTimeoutSeconds must be between 1 and 60")

    public_matchmaking = _boolean(value, "publicMatchmaking", True)
    create_public_room = _boolean(value, "createPublicRoom", mode == "room")
    private_rooms_enabled = _boolean(value, "privateRoomsEnabled", False)
    if mode != "room" and create_public_room:
        raise ConfigError("Only room mode allows the matchmaking system to create public Rooms")
    if create_public_room and not public_matchmaking:
        raise ConfigError("Public Rooms cannot be created when public matchmaking is disabled")

    reconnect = value.get("reconnect", {})
    if not isinstance(reconnect, dict):
        raise ConfigError("reconnect must be an object")
    recovery = value.get("recovery", "recoverable")
    if recovery not in {"ephemeral", "recoverable"}:
        raise ConfigError("recovery is invalid")
    heartbeat = _integer_with_default(reconnect, "heartbeatMillis", 3000)
    suspect = _integer_with_default(reconnect, "suspectMillis", 8000)
    disconnect = _integer_with_default(reconnect, "disconnectMillis", 10000)
    grace = _integer_with_default(reconnect, "graceMillis", 30000)
    if heartbeat <= 0 or suspect <= heartbeat or disconnect <= suspect or grace <= 0:
        raise ConfigError("reconnect time bounds are invalid")
    return MatchPolicyConfig(
        mode,
        max_score_diff,
        rank_expansion_stages,
        max_match_seconds,
        parsed_confirm_timeout,
        allowed_party_keys,
        public_matchmaking,
        create_public_room,
        private_rooms_enabled,
        str(recovery),
        heartbeat,
        suspect,
        disconnect,
        grace,
    )

def _rank_expansion_stages(
    value: Any,
    mode: str,
    maximum_score_diff: Optional[int],
    max_match_seconds: int,
) -> tuple[tuple[int, int], ...]:
    """Read RankPool discrete window-expansion stages; default to a bounded three-stage policy."""

    if mode != "rank_pool":
        if value not in (None, []):
            raise ConfigError("Only rank_pool may configure expansionStages")
        return ()
    assert maximum_score_diff is not None
    if value is None:
        candidates = [(0, max(1, maximum_score_diff // 4))]
        if max_match_seconds > 2 and maximum_score_diff > candidates[-1][1] + 1:
            candidates.append(
                (max(1, max_match_seconds // 3), max(candidates[-1][1] + 1, maximum_score_diff // 2))
            )
        final_wait = max_match_seconds * 2 // 3
        if maximum_score_diff > candidates[-1][1] and final_wait > candidates[-1][0]:
            candidates.append((final_wait, maximum_score_diff))
        elif maximum_score_diff != candidates[-1][1]:
            candidates[-1] = (candidates[-1][0], maximum_score_diff)
        return tuple(candidates)
    if not isinstance(value, list) or not value or len(value) > 16:
        raise ConfigError("matchPolicy.expansionStages must be an array with 1 to 16 entries")
    stages: list[tuple[int, int]] = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise ConfigError(f"matchPolicy.expansionStages[{index}] must be an object")
        wait_seconds = _non_negative_integer(item, "waitSeconds", -1)
        score_diff = _non_negative_integer(item, "maxScoreDiff", -1)
        if score_diff <= 0:
            raise ConfigError("Expansion-stage maxScoreDiff must be a positive integer")
        stages.append((wait_seconds, score_diff))
    if stages[0][0] != 0:
        raise ConfigError("The first expansion-stage waitSeconds must be 0")
    if any(
        left_wait >= right_wait or left_diff >= right_diff
        for (left_wait, left_diff), (right_wait, right_diff) in zip(stages, stages[1:])
    ):
        raise ConfigError("Expansion stage waitSeconds and maxScoreDiff must be strictly increasing")
    if stages[-1][1] != maximum_score_diff:
        raise ConfigError("The final expansion stage must reach matchPolicy.maxScoreDiff")
    if stages[-1][0] >= max_match_seconds:
        raise ConfigError("Expansion stages must complete before maxMatchSeconds")
    return tuple(stages)


def _boolean(value: dict[str, Any], name: str, default: bool) -> bool:
    """Read a boolean config value, rejecting string or number substitutes."""

    item = value.get(name, default)
    if not isinstance(item, bool):
        raise ConfigError(f"{name} must be a boolean")
    return item


def _integer_with_default(value: dict[str, Any], name: str, default: int) -> int:
    """Read an integer config value, rejecting booleans."""

    item = value.get(name, default)
    if isinstance(item, bool) or not isinstance(item, int):
        raise ConfigError(f"{name} must be an integer")
    return item


def _non_negative_integer(value: dict[str, Any], name: str, default: int) -> int:
    """Read a non-negative seconds config value."""

    item = _integer_with_default(value, name, default)
    if item < 0:
        raise ConfigError(f"{name} must not be negative")
    return item


def _optional_non_negative_integer(value: dict[str, Any], name: str) -> Optional[int]:
    """Read an optional non-negative seconds config value."""

    item = value.get(name)
    if item is None:
        return None
    if isinstance(item, bool) or not isinstance(item, int) or item < 0:
        raise ConfigError(f"{name} must be a non-negative integer or null")
    return item
