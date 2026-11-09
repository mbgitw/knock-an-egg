"""Coordinate Builda authorization, source builds, and Match Activity activation."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, NoReturn, Optional

from .archive import (
    ArchiveError,
    PackedSource,
    describe_typescript_source,
    pack_typescript_workspace,
    pack_rust_workspace,
)
from .config import (
    ActivityConfig,
    ConfigError,
    Installation,
    PartyProfileConfig,
    RoomTransferConfig,
    assert_release_matches_sdk_pin,
    detect_language,
    load_online_config,
    load_game_id,
    load_installation,
    validate_client_sdk_installation,
)
from .client_validation import validate_client_runtime_detection
from .install import InstallError, InstallRequest, run_install
from .http import (
    HttpError,
    json_request,
    multipart_request,
    quote_path,
    response_error_summary,
)


CLIENT_ADMISSION_BY_MATCH_MODE = {
    "room": "join_room",
    "pool": "join_pool",
    "rank_pool": "join_rank_pool",
}


class DeployError(RuntimeError):
    """Signals that the deployment flow cannot continue."""


def main(argv: Optional[list[str]] = None) -> int:
    """Parse commands and print stable, traceable deployment results."""

    parser = argparse.ArgumentParser(prog="builda-online")
    subcommands = parser.add_subparsers(dest="command", required=True)
    for name, help_text in (
        ("install", "Install Builda Online for the Builda SDK version pinned in .builda-agent/sdk-version"),
        ("upgrade", "Re-install Builda Online after `builda sdk upgrade` moved the pinned SDK version"),
    ):
        installer = subcommands.add_parser(name, help=help_text)
        installer.add_argument("--project-root", default=".", help="Builda game project root; defaults to the current directory")
        installer.add_argument(
            "--manifest-url",
            default="",
            help="Public Online manifest.json; required for the first install, remembered afterwards",
        )
        installer.add_argument("--client-sdk", choices=["godot", "h5", "cocos", "unity"], default="", help="Client engine; detected from the project when omitted")
        installer.add_argument("--room-language", choices=["typescript", "rust"], default="", help="Room language; detected from project evidence when omitted")
        installer.add_argument("--no-reexec", action="store_true", help=argparse.SUPPRESS)
    check = subcommands.add_parser(
        "check",
        help="Validate installation, game binding, client and Room SDK contracts, and environment detection",
    )
    check.add_argument(
        "--project-root",
        default=".",
        help="Builda game project root; defaults to the current directory",
    )
    check.add_argument(
        "--room-source",
        help="Optional Room source file or directory; applies the same migration-recovery checks as deploy",
    )
    check.add_argument(
        "--activity-config",
        default="builda.online.json",
        help="Room release configuration; defaults to builda.online.json",
    )
    deploy = subcommands.add_parser("deploy", help="Build a Room and activate its Match Activity")
    deploy.add_argument("source", help="A .ts file, a TypeScript directory containing room.ts, or a Rust workspace")
    deploy.add_argument(
        "activity_config",
        nargs="?",
        default="builda.online.json",
        help="Deployment configuration; defaults to builda.online.json",
    )
    deploy.add_argument(
        "--project-root",
        default=".",
        help="Builda game project root; defaults to the current directory",
    )
    deploy.add_argument(
        "--skip-builda-auth",
        action="store_true",
        help=argparse.SUPPRESS,
    )
    verify = subcommands.add_parser(
        "verify",
        help="Track post-deployment verification against the activated Artifact",
    )
    verify.add_argument("--project-root", default=".", help="Builda game project root")
    verify.add_argument("--room-id", default="", help="Room ID observed from a newly created Ticket")
    verify.add_argument(
        "--joined-player-count",
        type=int,
        default=0,
        help="Operator-attested number of independent real players observed in the Room",
    )
    verify.add_argument(
        "--data-channels",
        default="",
        help="Comma-separated opened channels: control_reliable,game_reliable,state_unreliable",
    )
    verify.add_argument(
        "--leave-completed",
        action="store_true",
        help="Operator confirms both real players completed authoritative leave",
    )
    migrate = subcommands.add_parser("migrate-room", help="Safely migrate a running Room to another platform location")
    migrate.add_argument("room_id", help="Room ID to migrate; a target location cannot be specified")
    migrate.add_argument("--project-root", default=".", help="Builda game project root")
    migrate.add_argument("--skip-builda-auth", action="store_true", help=argparse.SUPPRESS)
    migration_status = subcommands.add_parser("migration-status", help="Query Room migration status")
    migration_status.add_argument("room_id")
    migration_status.add_argument("migration_id")
    migration_status.add_argument("--project-root", default=".", help="Builda game project root")
    migration_status.add_argument("--skip-builda-auth", action="store_true", help=argparse.SUPPRESS)
    logs = subcommands.add_parser("logs", help="Query the current game's user logs and Room exit diagnostics")
    logs.add_argument("room_id", nargs="?", default="", help="Optional Room ID; omit to query the current game")
    logs.add_argument("--since", default="30m", help="Time range to query, such as 30m, 2h, or 7d")
    logs.add_argument("--limit", type=int, default=100, help="Return 1 to 200 entries; defaults to 100")
    logs.add_argument("--json", action="store_true", help="Emit stable JSON for AI or script processing")
    logs.add_argument("--project-root", default=".", help="Builda game project root")
    logs.add_argument("--skip-builda-auth", action="store_true", help=argparse.SUPPRESS)
    alerts = subcommands.add_parser("alerts", help="Query important resource and Room failure alerts for the current game")
    alerts.add_argument("--room-id", default="", help="Optional Room ID filter")
    alerts.add_argument("--since", default="30m", help="Time range such as 30m, 2h, or 7d")
    alerts.add_argument("--limit", type=int, default=100, help="Return 1 to 200 alerts")
    alerts.add_argument("--json", action="store_true", help="Emit stable JSON")
    alerts.add_argument("--project-root", default=".", help="Builda game project root")
    alerts.add_argument("--skip-builda-auth", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)

    try:
        if args.command in {"install", "upgrade"}:
            return run_install(
                InstallRequest(
                    project_root=Path(args.project_root),
                    manifest_url=args.manifest_url or None,
                    client_sdk=args.client_sdk or None,
                    room_language=args.room_language or None,
                    upgrade=args.command == "upgrade",
                    allow_reexec=not args.no_reexec,
                )
            )
        if args.command == "check":
            project_root = Path(args.project_root).resolve()
            installation = load_installation(project_root)
            sdk_pin = assert_release_matches_sdk_pin(project_root, installation)
            detected_version = validate_client_sdk_installation(project_root, installation)
            validate_client_runtime_detection(project_root)
            game_id = load_game_id(project_root)
            activity_config_path = _resolve_from_project(project_root, Path(args.activity_config))
            online_config = (
                load_online_config(activity_config_path, installation.room_language)
                if activity_config_path.is_file()
                else None
            )
            if args.room_source:
                if online_config is None:
                    raise ConfigError(f"Missing configuration file: {activity_config_path}")
                source = _resolve_from_project(project_root, Path(args.room_source))
                language = detect_language(source)
                if language not in installation.deployment_languages:
                    raise DeployError(f"Current deployment client does not support {language}")
                if language != installation.room_language:
                    raise DeployError(
                        "Room source language does not match installation.json roomLanguage; reinstall the Skill"
                    )
                _validate_room_transfer_source(
                    source,
                    language,
                    online_config.room_transfer,
                )
            print("builda-online-check=ok")
            print(f"gameId={game_id}")
            print(f"onlineRelease={installation.release_id or 'unrecorded (run builda-online install to record)'}")
            print(f"sdkVersion={sdk_pin or 'unpinned'}")
            print(f"clientSdk={installation.client_sdk}")
            print(f"clientSdkVersion={detected_version}")
            print(f"clientProtocolVersion={installation.client_protocol_version}")
            print(f"roomLanguage={installation.room_language}")
            print(f"serverSdkVersion={installation.server_sdk_version}")
            print(f"roomContractVersion={installation.room_contract_version}")
            print(f"pythonInterpreterSource={_python_interpreter_source()}")
            print(
                "pythonInterpreterVersion="
                f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
            )
            if online_config is not None:
                print(
                    f"onlineCompatibilityRevision={online_config.online_compatibility_revision}"
                )
                initial_revision = online_config.online_compatibility_revision == 1
                print("compatibilityReviewRequired=true")
                print(f"initialRevision={str(initial_revision).lower()}")
                # Old fields stay for one compatibility window; the new Status field carries the manual review status so existing output keeps its meaning.
                print("compatibilityDecision=keep-unless-existing-client-protocol-breaks")
                print("compatibilityDecisionDeprecated=true")
                print("compatibilityQuestion1=old-client-requests-still-accepted")
                print("compatibilityQuestion1Status=pending")
                print("compatibilityQuestion2=old-client-understands-new-room-responses")
                print("compatibilityQuestion2Status=pending")
                print("compatibilityQuestion3=old-client-lifecycle-still-completes")
                print("compatibilityQuestion3Status=pending")
            print("clientRuntimeDetection=safe")
            if args.room_source:
                print(f"roomSourceLanguage={language}")
                print("roomTransferRecovery=safe")
            return 0
        if args.command == "deploy":
            result = deploy_room(
                Path(args.project_root).resolve(),
                Path(args.source),
                Path(args.activity_config),
                run_auth=not args.skip_builda_auth,
            )
            print("builda-online-deploy=ok")
            for key in (
                "gameId",
                "buildId",
                "artifactId",
                "sourceSha256",
                "onlineCompatibilityRevision",
                "serverReleaseId",
                "releaseStatus",
            ):
                print(f"{key}={result[key]}")
            print(f"matchKeys={','.join(result['matchKeys'])}")
            print(f"partyKeys={','.join(result['partyKeys'])}")
            return 0
        if args.command == "verify":
            return verify_deployment(
                Path(args.project_root).resolve(),
                room_id=args.room_id,
                joined_player_count=args.joined_player_count,
                data_channels=args.data_channels,
                leave_completed=args.leave_completed,
            )
        if args.command == "migrate-room":
            result = migrate_room(
                Path(args.project_root).resolve(),
                args.room_id,
                run_auth=not args.skip_builda_auth,
            )
            print("builda-online-migrate-room=ok")
            for key in ("room_id", "migration_id", "generation"):
                print(f"{key}={result.get(key, '')}")
            return 0
        if args.command == "migration-status":
            result = get_migration_status(
                Path(args.project_root).resolve(),
                args.room_id,
                args.migration_id,
                run_auth=not args.skip_builda_auth,
            )
            print("builda-online-migration-status=ok")
            for key in ("room_id", "migration_id", "status", "generation"):
                print(f"{key}={result.get(key, '')}")
            return 0
        if args.command == "alerts":
            result = get_alerts(Path(args.project_root).resolve(), args.room_id, args.since,
                args.limit, run_auth=not args.skip_builda_auth)
            if args.json:
                print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
                return 0
            print("builda-online-alerts=ok")
            print(f"gameId={result.get('game_id', '')}")
            print(f"scope={'room' if args.room_id else 'game'}")
            print(f"hasMore={str(bool(result.get('has_more', False))).lower()}")
            print(f"delivery={result.get('delivery', 'unknown')}")
            print("Alerts are best effort; empty results do not prove the game is healthy")
            if result.get("has_more"):
                print("Query a shorter time range or filter by a returned Room ID for more detail")
            for alert in result.get("alerts", []):
                if isinstance(alert, dict):
                    print("alert=" + json.dumps(alert, ensure_ascii=False, separators=(",", ":")))
            return 0
        if args.command == "logs":
            result = get_room_logs(
                Path(args.project_root).resolve(),
                args.room_id,
                args.since,
                args.limit,
                run_auth=not args.skip_builda_auth,
            )
            if args.json:
                print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
                return 0
            print("builda-online-logs=ok")
            print(f"gameId={result.get('game_id', '')}")
            if args.room_id:
                print(f"roomId={result.get('room_id', '')}")
                print(f"artifactId={result.get('artifact_id', '')}")
            else:
                print("scope=game")
                print(f"partial={str(bool(result.get('partial', False))).lower()}")
                print(f"hasMore={str(bool(result.get('has_more', False))).lower()}")
                if result.get("partial") or result.get("has_more"):
                    print("Query a shorter time range or a returned Room ID for more detail")
                for room in result.get("rooms", []):
                    if isinstance(room, dict):
                        print("room=" + json.dumps(room, ensure_ascii=False, separators=(",", ":")))
            exit_summary = result.get("exit")
            if isinstance(exit_summary, dict):
                print(f"exitStatus={exit_summary.get('status', '')}")
                print(f"exitReason={exit_summary.get('reason_code', '')}")
            print(f"droppedEvents={result.get('dropped_events', 0)}")
            print(f"droppedBytes={result.get('dropped_bytes', 0)}")
            for entry in result.get("entries", []):
                if isinstance(entry, dict):
                    context = ""
                    if not args.room_id:
                        context = (
                            f"room={json.dumps(entry.get('room_id', ''), ensure_ascii=False)} "
                            f"artifact={json.dumps(entry.get('artifact_id', ''), ensure_ascii=False)} "
                            f"generation={entry.get('generation', '')} "
                        )
                    print(
                        f"{entry.get('logged_at_millis', '')} {context}"
                        f"{str(entry.get('level', 'info')).upper()} "
                        f"{json.dumps(str(entry.get('message', '')), ensure_ascii=False)}"
                    )
            return 0
    except (
        ArchiveError,
        ConfigError,
        DeployError,
        HttpError,
        InstallError,
    ) as error:
        print(f"builda-online-{args.command}=failed\n{error}", file=sys.stderr)
        return 1
    return 1


def migrate_room(project_root: Path, room_id: str, *, run_auth: bool) -> dict[str, Any]:
    """Start a single-Room migration as the author; Online always chooses the target placement."""

    if not room_id or len(room_id) > 128:
        raise DeployError("Invalid room_id")
    installation, game_id, deploy_token = _authorize_room_operation(project_root, run_auth)
    try:
        return json_request(
            "POST",
            (
                f"{installation.online_api_base_url}/v1/games/{quote_path(game_id)}"
                f"/rooms/{quote_path(room_id)}/migrations"
            ),
            {},
            deploy_token,
        )
    except HttpError as error:
        _raise_stage_http_error(
            "Migrate Room",
            error,
            unauthorized_hint="Rerun the command to request a new deploy token",
        )


def get_migration_status(
    project_root: Path,
    room_id: str,
    migration_id: str,
    *,
    run_auth: bool,
) -> dict[str, Any]:
    """Query the migration status of a given Room without exposing placement selection."""

    if not room_id or len(room_id) > 128 or not migration_id or len(migration_id) > 128:
        raise DeployError("Invalid room_id or migration_id")
    installation, game_id, deploy_token = _authorize_room_operation(project_root, run_auth)
    try:
        return json_request(
            "GET",
            (
                f"{installation.online_api_base_url}/v1/games/{quote_path(game_id)}"
                f"/rooms/{quote_path(room_id)}/migrations/{quote_path(migration_id)}"
            ),
            bearer_token=deploy_token,
        )
    except HttpError as error:
        _raise_stage_http_error(
            "Query Room migration",
            error,
            unauthorized_hint="Rerun the command to request a new deploy token",
        )


def get_room_logs(
    project_root: Path,
    room_id: str,
    since: str,
    limit: int,
    *,
    run_auth: bool,
) -> dict[str, Any]:
    """Query the current game's logs, optionally filtering by a known Room ID."""

    if (room_id and not room_id.strip()) or len(room_id) > 256 or not 1 <= limit <= 200:
        raise DeployError("Invalid room_id or limit")
    since_millis = _duration_to_since_millis(since)
    installation, game_id, deploy_token = _authorize_room_operation(project_root, run_auth)
    query = f"since_millis={since_millis}&limit={limit}"
    room_path = f"/{quote_path(room_id)}" if room_id else ""
    try:
        return json_request(
            "GET",
            (
                f"{installation.online_api_base_url}/v1/games/{quote_path(game_id)}"
                f"/room-logs{room_path}?{query}"
            ),
            bearer_token=deploy_token,
        )
    except HttpError as error:
        _raise_stage_http_error(
            "Query Room logs",
            error,
            unauthorized_hint="Rerun the command to request a new diagnostics token",
        )


def get_alerts(project_root: Path, room_id: str, since: str, limit: int, *, run_auth: bool) -> dict[str, Any]:
    """Query trusted alerts independently of Room user logs, scoped to the authorized game."""
    if (room_id and not room_id.strip()) or len(room_id) > 256 or not 1 <= limit <= 200:
        raise DeployError("Invalid room_id or limit")
    since_millis = _duration_to_since_millis(since)
    installation, game_id, deploy_token = _authorize_room_operation(project_root, run_auth)
    query = f"since_millis={since_millis}&limit={limit}"
    if room_id:
        query += f"&room_id={quote_path(room_id)}"
    try:
        return json_request("GET", f"{installation.online_api_base_url}/v1/games/{quote_path(game_id)}/alerts?{query}",
            bearer_token=deploy_token)
    except HttpError as error:
        _raise_stage_http_error("Query game alerts", error,
            unauthorized_hint="Rerun the command to request a new diagnostics token")


def _duration_to_since_millis(value: str) -> int:
    """Convert a bounded human time range into absolute millisecond timestamps."""

    match = re.fullmatch(r"([1-9][0-9]*)([mhd])", value.strip().lower())
    if not match:
        raise DeployError("--since must be a positive integer followed by m, h, or d, such as 30m")
    amount = int(match.group(1))
    unit_millis = {"m": 60_000, "h": 3_600_000, "d": 86_400_000}[match.group(2)]
    duration_millis = amount * unit_millis
    if duration_millis > 7 * 86_400_000:
        raise DeployError("--since must not exceed the 7-day log retention period")
    return int(time.time() * 1_000) - duration_millis


def _authorize_room_operation(
    project_root: Path,
    run_auth: bool,
) -> tuple[Installation, str, str]:
    """Reuse Builda author authorization to obtain a one-time Online token scoped to the current game."""

    installation = load_installation(project_root)
    assert_release_matches_sdk_pin(project_root, installation)
    game_id = load_game_id(project_root)
    if run_auth:
        _run_builda_command(project_root, "check")
        _run_builda_command(project_root, "auth")
    return installation, game_id, _request_deploy_token(
        installation,
        game_id,
        _read_publish_grant(),
    )


def deploy_room(
    project_root: Path,
    source_argument: Path,
    activity_config_argument: Path,
    *,
    run_auth: bool,
) -> dict[str, Any]:
    """Run one full deployment from Builda author authorization to the Match Activity update."""

    project_root = project_root.resolve()
    source = _resolve_from_project(project_root, source_argument)
    activity_config_path = _resolve_from_project(project_root, activity_config_argument)
    language = detect_language(source)
    installation = load_installation(project_root)
    assert_release_matches_sdk_pin(project_root, installation)
    validate_client_sdk_installation(project_root, installation)
    validate_client_runtime_detection(project_root)
    if language not in installation.deployment_languages:
        raise DeployError(f"Current deployment client does not support {language}")
    if language != installation.room_language:
        raise DeployError(
            "Room source language does not match installation.json roomLanguage; reinstall the Skill"
        )
    online_config = load_online_config(activity_config_path, language)
    _validate_room_transfer_source(source, language, online_config.room_transfer)
    build_config = online_config.build_activity
    game_id = load_game_id(project_root)

    if run_auth:
        _run_builda_command(project_root, "check")
        _run_builda_command(project_root, "auth")
    publish_grant = _read_publish_grant()

    with tempfile.TemporaryDirectory(prefix="builda-online-deploy-") as temporary:
        packed = _prepare_source(
            source,
            language,
            build_config,
            Path(temporary),
        )
        deploy_token = _request_deploy_token(
            installation,
            game_id,
            publish_grant,
            expected_compatibility_revision=online_config.online_compatibility_revision,
        )
        build = _create_build(
            installation,
            game_id,
            language,
            build_config,
            packed,
            deploy_token,
        )
        build = _wait_for_build(
            installation,
            game_id,
            build,
            deploy_token,
        )
        artifact_id = build.get("artifact_id")
        if not artifact_id:
            raise DeployError("Build succeeded but did not return artifact_id")
        release = _publish_release_configuration(
            installation,
            game_id,
            online_config.party_profiles,
            online_config.activities,
            deploy_token,
            f"release-{artifact_id}",
        )

    returned_revision = int(release.get("online_compatibility_revision", 0))
    if returned_revision != online_config.online_compatibility_revision:
        raise DeployError(
            "Activated release compatibility revision does not match builda.online.json; "
            "sync the Builda client draft before deploying"
        )

    receipt = {
        "environment": installation.environment,
        "gameId": game_id,
        "buildId": str(build.get("build_id")),
        "artifactId": str(artifact_id),
        "onlineCompatibilityRevision": returned_revision,
        "serverReleaseId": str(release.get("server_release_id", "")),
        "releaseStatus": str(release.get("status", "")),
        "matchKeys": [activity.match_key for activity in online_config.activities],
        "partyKeys": [profile.party_key for profile in online_config.party_profiles],
        "clientAdmissions": {
            activity.match_key: _client_admission(activity.match_policy.mode)
            for activity in online_config.activities
            if activity.match_policy.public_matchmaking
        },
        "sourceLanguage": language,
        "sourceSha256": packed.sha256,
        "roomTransfer": {
            "snapshotSchemaVersion": online_config.room_transfer.snapshot_schema_version,
            "authoritativeState": list(online_config.room_transfer.authoritative_state),
            "failureRecovery": online_config.room_transfer.failure_recovery,
            "pauseBudgetMillis": online_config.room_transfer.pause_budget_millis,
        },
    }
    _write_receipt(project_root, receipt)
    return receipt


def verify_deployment(
    project_root: Path,
    *,
    room_id: str,
    joined_player_count: int,
    data_channels: str,
    leave_completed: bool,
) -> int:
    """Check the deployment receipt and track acceptance evidence that only a real player runtime can provide."""

    receipt = _read_deployment_receipt(project_root)
    target_artifact_id = receipt["artifactId"]
    observed_artifact_id = ""
    if room_id:
        room_diagnostics = get_room_logs(
            project_root,
            room_id,
            "30m",
            1,
            run_auth=True,
        )
        observed_artifact_id = str(room_diagnostics.get("artifact_id", ""))
    channels = {value.strip() for value in data_channels.split(",") if value.strip()}
    expected_channels = {"control_reliable", "game_reliable", "state_unreliable"}
    artifact_matches = observed_artifact_id == target_artifact_id
    checks = (
        ("newTicketRoom", bool(room_id), "create-a-new-ticket-after-deployment-and-record-room-id"),
        ("targetArtifact", artifact_matches, f"confirm-room-artifact-{target_artifact_id}"),
        ("twoRealPlayers", joined_player_count >= 2, "join-with-two-independent-builda-app-identities"),
        ("threeDataChannels", channels == expected_channels, "open-control_reliable-game_reliable-state_unreliable"),
        ("authoritativeLeave", leave_completed, "leave-both-players-and-wait-for-authoritative-completion"),
    )
    complete = all(passed for _, passed, _ in checks)
    print(f"builda-online-verify={'ok' if complete else 'pending'}")
    print("verificationMode=operator-attested-runtime-checklist")
    print("artifactVerificationSource=online-room-diagnostics")
    print("runtimeEvidenceSource=operator-attestation")
    print("runtimeEvidenceAutomaticallyObserved=false")
    print(f"gameId={receipt['gameId']}")
    print(f"onlineCompatibilityRevision={receipt['onlineCompatibilityRevision']}")
    print(f"serverReleaseId={receipt['serverReleaseId']}")
    print(f"releaseStatus={receipt['releaseStatus']}")
    print(f"targetArtifactId={target_artifact_id}")
    if observed_artifact_id:
        print(f"observedArtifactId={observed_artifact_id}")
    for name, passed, instruction in checks:
        print(f"check.{name}={'ok' if passed else f'pending:{instruction}'}")
    return 0 if complete else 2


def _read_deployment_receipt(project_root: Path) -> dict[str, Any]:
    """Read only the stable public receipt fields needed for post-deploy verification."""

    path = project_root / ".builda-online" / "last-deployment.json"
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise DeployError("Deployment receipt is missing or invalid; run deploy first") from error
    if not isinstance(value, dict):
        raise DeployError("Deployment receipt must be a JSON object; run deploy again")
    required_strings = ("gameId", "artifactId", "serverReleaseId")
    if any(not isinstance(value.get(key), str) or not value[key].strip() for key in required_strings):
        raise DeployError("Deployment receipt is incomplete; run deploy again")
    if value.get("releaseStatus") != "active":
        raise DeployError("Deployment receipt does not contain an active Release")
    revision = value.get("onlineCompatibilityRevision")
    if not isinstance(revision, int) or isinstance(revision, bool) or revision <= 0:
        raise DeployError("Deployment receipt has an invalid compatibility revision")
    return {
        "gameId": value["gameId"],
        "artifactId": value["artifactId"],
        "onlineCompatibilityRevision": revision,
        "serverReleaseId": value["serverReleaseId"],
        "releaseStatus": value["releaseStatus"],
    }


def _publish_release_configuration(
    installation: Installation,
    game_id: str,
    party_profiles: tuple[PartyProfileConfig, ...],
    activities: tuple[ActivityConfig, ...],
    deploy_token: str,
    server_release_id: str = "release-test",
) -> dict[str, Any]:
    """Allow Release activation only after all versioned configuration succeeds."""

    for profile in party_profiles:
        _update_party_profile(installation, game_id, profile, deploy_token)
    for activity in activities:
        _update_activity(installation, game_id, activity, deploy_token)
    release = _activate_release(installation, game_id, server_release_id, deploy_token)
    _validate_activated_release(release)
    return release


def _client_admission(match_mode: str) -> str:
    """Return the client Admission name uniquely mapped to the Match mode."""

    try:
        return CLIENT_ADMISSION_BY_MATCH_MODE[match_mode]
    except KeyError as error:
        raise DeployError(f"Unsupported Match mode: {match_mode}") from error


def _validate_room_transfer_source(
    source: Path,
    language: str,
    transfer: RoomTransferConfig,
) -> None:
    """Before authorization and upload, confirm the source uses the current recoverable Room lifecycle and covers the declared state."""

    suffix = ".ts" if language == "typescript" else ".rs"
    files = [source] if source.is_file() else sorted(source.rglob(f"*{suffix}"))
    files = [path for path in files if not any(part.startswith(".") for part in path.parts)]
    if not files:
        raise DeployError(f"{language} Room source does not contain a {suffix} file")
    try:
        text = "\n".join(path.read_text(encoding="utf-8") for path in files)
    except OSError as error:
        raise DeployError("Unable to read Room source during validation") from error

    legacy_names = (
        ("onSave", "onResume", "onMigrationCommitted", "onMigrationAborted")
        if language == "typescript"
        else ("on_save", "on_resume", "on_migration_committed", "on_migration_aborted")
    )
    structural_text = _mask_source_literals(text, language)
    legacy = next((name for name in legacy_names if name in structural_text), None)
    if legacy:
        raise DeployError(
            f"Room source still uses legacy lifecycle method {legacy}; use checkpoint/restore/activated"
        )

    if language == "typescript":
        room_bodies = _typescript_room_class_bodies(structural_text)
        if not room_bodies:
            raise DeployError("TypeScript Room must extend Room<TState> so its state can be checkpointed")
        mutable_field = next(
            (
                field
                for body in room_bodies
                for field in _typescript_mutable_room_fields(body)
                if field != "state"
            ),
            None,
        )
        if mutable_field is not None:
            raise DeployError(
                "TypeScript Room has a mutable field outside checkpointed state: "
                f"{mutable_field}; store it under this.state"
            )
    else:
        room_types = re.findall(
            r"\bimpl\s*(?:<[^>{}]*>\s*)?(?:(?:cysj_room_sdk|crate)::)?Room\s+for\s+([A-Za-z_][A-Za-z0-9_]*)",
            structural_text,
        )
        if not room_types:
            raise DeployError("Rust Room must implement cysj_room_sdk::Room")
        unserializable = next(
            (
                room_type
                for room_type in room_types
                if not _rust_room_is_serializable(structural_text, room_type)
            ),
            None,
        )
        if unserializable is not None:
            raise DeployError(
                f"Rust Room {unserializable} must derive Serialize + Deserialize for checkpoints"
            )

    for state_path in transfer.authoritative_state:
        leaf = state_path.rsplit(".", 1)[-1]
        if not re.search(rf"\b{re.escape(leaf)}\b", text):
            raise DeployError(
                f"roomTransfer.authoritativeState path {state_path} was not found in Room source"
            )


def _mask_source_literals(text: str, language: str) -> str:
    """Mask comments and strings per source language, keeping structural characters and identifier positions."""

    result = list(text)
    index = 0
    state = "code"
    quote = ""
    quotes = ('"', "'", "`") if language == "typescript" else ('"',)
    while index < len(text):
        current = text[index]
        following = text[index + 1] if index + 1 < len(text) else ""
        if state == "code":
            if language == "rust" and current == "'":
                char_end = _rust_char_literal_end(text, index)
                if char_end is not None:
                    for cursor in range(index, char_end + 1):
                        result[cursor] = " "
                    index = char_end + 1
                    continue
            if current == "/" and following == "/":
                result[index] = result[index + 1] = " "
                state = "line_comment"
                index += 2
                continue
            if current == "/" and following == "*":
                result[index] = result[index + 1] = " "
                state = "block_comment"
                index += 2
                continue
            if current in quotes:
                result[index] = " "
                quote = current
                state = "string"
        elif state == "line_comment":
            if current == "\n":
                state = "code"
            else:
                result[index] = " "
        elif state == "block_comment":
            if current == "*" and following == "/":
                result[index] = result[index + 1] = " "
                state = "code"
                index += 2
                continue
            if current != "\n":
                result[index] = " "
        else:
            if current == "\\":
                result[index] = " "
                if index + 1 < len(text) and text[index + 1] != "\n":
                    result[index + 1] = " "
                index += 2
                continue
            if current == quote:
                result[index] = " "
                state = "code"
            elif current != "\n":
                result[index] = " "
        index += 1
    return "".join(result)


def _rust_char_literal_end(text: str, start: int) -> Optional[int]:
    """Return the closing single quote of a Rust char literal; return None for lifetimes and labels."""

    cursor = start + 1
    if cursor >= len(text) or text[cursor] in ("'", "\r", "\n"):
        return None
    if text[cursor] != "\\":
        cursor += 1
    else:
        cursor += 1
        if cursor >= len(text):
            return None
        if text[cursor] == "x":
            digits = text[cursor + 1 : cursor + 3]
            if len(digits) != 2 or any(value not in "0123456789abcdefABCDEF" for value in digits):
                return None
            cursor += 3
        elif text[cursor] == "u" and cursor + 1 < len(text) and text[cursor + 1] == "{":
            closing = text.find("}", cursor + 2)
            if closing < 0 or "\n" in text[cursor:closing]:
                return None
            cursor = closing + 1
        else:
            cursor += 1
    return cursor if cursor < len(text) and text[cursor] == "'" else None


def _typescript_room_class_bodies(text: str) -> list[str]:
    """Extract every TypeScript class body that directly extends Room<TState>."""

    bodies: list[str] = []
    pattern = re.compile(
        r"\bclass\s+[A-Za-z_][A-Za-z0-9_]*\s+extends\s+Room\s*<[^>{}]+>"
    )
    for match in pattern.finditer(text):
        opening = text.find("{", match.end())
        if opening < 0:
            continue
        depth = 1
        cursor = opening + 1
        while cursor < len(text) and depth > 0:
            if text[cursor] == "{":
                depth += 1
            elif text[cursor] == "}":
                depth -= 1
            cursor += 1
        if depth == 0:
            bodies.append(text[opening + 1 : cursor - 1])
    return bodies


def _typescript_mutable_room_fields(body: str) -> list[str]:
    """Return the outermost instance fields of the Room class that are not declared readonly."""

    top_level: list[str] = []
    depth = 0
    for current in body:
        if current == "{":
            if depth == 0:
                top_level.append("{")
            depth += 1
            continue
        if current == "}":
            depth = max(0, depth - 1)
            if depth == 0:
                top_level.append("}")
            continue
        top_level.append(current if depth == 0 or current == "\n" else " ")
    declaration = re.compile(
        r"(?:^|;)\s*"
        r"(?:(?:public|protected|private|static|declare|override|abstract|accessor)\s+)*"
        r"(?P<readonly>readonly\s+)?"
        r"(?P<name>#[A-Za-z_][A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_]*)"
        r"\s*[!?]?\s*(?::[^;={]+)?\s*(?:=|;)",
        re.MULTILINE,
    )
    return [
        match.group("name").removeprefix("#")
        for match in declaration.finditer("".join(top_level))
        if match.group("readonly") is None
    ]


def _rust_room_is_serializable(text: str, room_type: str) -> bool:
    """Confirm the Rust type that actually implements Room has full Serialize/Deserialize."""

    escaped = re.escape(room_type)
    structure = re.search(
        rf"(?P<attributes>(?:\s*#\s*\[[^\]]+\]\s*)*)"
        rf"(?:pub(?:\s*\([^)]*\))?\s+)?struct\s+{escaped}\b",
        text,
    )
    if structure is None:
        return False
    derived: set[str] = set()
    for derive in re.findall(r"#\s*\[\s*derive\s*\(([^)]*)\)\s*\]", structure.group("attributes")):
        derived.update(re.findall(r"[A-Za-z_][A-Za-z0-9_]*", derive))
    serialize = "Serialize" in derived or re.search(
        rf"\bimpl(?:\s*<[^>{{}}]*>)?\s+(?:serde::)?Serialize\s+for\s+{escaped}\b",
        text,
    )
    deserialize = "Deserialize" in derived or re.search(
        rf"\bimpl(?:\s*<[^>{{}}]*>)?\s+(?:serde::)?Deserialize(?:\s*<[^>{{}}]*>)?\s+for\s+{escaped}\b",
        text,
    )
    return bool(serialize and deserialize)
def _prepare_source(
    source: Path,
    language: str,
    activity_config: ActivityConfig,
    temporary: Path,
) -> PackedSource:
    """Run only the source preparation logic needed for the current language."""

    if language == "typescript":
        if source.is_dir():
            return pack_typescript_workspace(source, temporary / "source.tar.gz")
        return describe_typescript_source(source)
    return pack_rust_workspace(
        source,
        temporary / "source.tar.gz",
        activity_config.manifest_path or "",
    )


def _request_deploy_token(
    installation: Installation,
    game_id: str,
    publish_grant: str,
    *,
    expected_compatibility_revision: Optional[int] = None,
) -> str:
    """Obtain and exchange a one-time deploy code via the Builda author authorization broker."""

    try:
        broker = json_request(
            "POST",
            f"{installation.builda_agent_api_base_url}/api/v1/agent/online/deploy-code",
            {"gameId": game_id},
            publish_grant,
        )
    except HttpError as error:
        _raise_stage_http_error(
            "Request deploy code",
            error,
            unauthorized_hint="Rerun Builda auth",
        )
    code = broker.get("code")
    if not isinstance(code, str) or not code:
        detail = response_error_summary(broker)
        suffix = f": {detail}" if detail else ""
        raise DeployError(f"Builda deploy-code broker returned an invalid response{suffix}")
    exchange_url = (
        f"{installation.online_api_base_url.rstrip('/')}"
        "/v1/deploy-codes/exchange"
    )
    try:
        exchange = json_request("POST", exchange_url, {"code": code})
    except HttpError as error:
        _raise_stage_http_error(
            "Exchange deploy code",
            error,
            unauthorized_hint="Rerun deployment to request a new deploy code",
        )
    deploy_token = exchange.get("access_token")
    if not isinstance(deploy_token, str) or not deploy_token:
        detail = response_error_summary(exchange)
        suffix = f": {detail}" if detail else ""
        raise DeployError(f"Deploy code is missing access_token{suffix}")
    if expected_compatibility_revision is not None:
        returned_revision = exchange.get("online_compatibility_revision")
        if (
            isinstance(returned_revision, bool)
            or not isinstance(returned_revision, int)
            or returned_revision != expected_compatibility_revision
        ):
            raise DeployError(
                "Builda client draft onlineCompatibilityRevision does not match "
                "builda.online.json; sync the client draft before uploading Room source"
            )
    return deploy_token


def _create_build(
    installation: Installation,
    game_id: str,
    language: str,
    activity_config: ActivityConfig,
    source: PackedSource,
    deploy_token: str,
) -> dict[str, Any]:
    """Upload the public source inputs for the current language and create an async build."""

    fields = {
        "language": language,
        "sdk_version": installation.server_sdk_version,
        "room_contract_version": installation.room_contract_version,
        "room_type": activity_config.room_type,
        "version": activity_config.version,
        "source_format": source.source_format,
    }
    if source.manifest_path is not None:
        fields["manifest_path"] = source.manifest_path
    elif language == "rust":
        fields["manifest_path"] = activity_config.manifest_path or ""
    if language == "rust":
        fields["package"] = activity_config.package or ""
    try:
        return multipart_request(
            (
                f"{installation.online_api_base_url}/v1/games/"
                f"{quote_path(game_id)}/room-builds"
            ),
            fields,
            source.path,
            source.content_type,
            deploy_token,
        )
    except HttpError as error:
        _raise_stage_http_error(
            "Create Room Build",
            error,
            unauthorized_hint="Rerun deployment to request a new deploy token",
        )


def _wait_for_build(
    installation: Installation,
    game_id: str,
    initial_build: dict[str, Any],
    deploy_token: str,
) -> dict[str, Any]:
    """Poll until the build succeeds or fails explicitly."""

    build_id = initial_build.get("build_id")
    if not build_id:
        raise DeployError("Build creation did not return build_id")
    poll_seconds = float(os.environ.get("BUILDA_ONLINE_BUILD_POLL_SECONDS", "2"))
    for _attempt in range(300):
        try:
            build = json_request(
                "GET",
                (
                    f"{installation.online_api_base_url}/v1/games/"
                    f"{quote_path(game_id)}/room-builds/{quote_path(str(build_id))}"
                ),
                bearer_token=deploy_token,
            )
        except HttpError as error:
            _raise_stage_http_error(
                "Query Room Build",
                error,
                unauthorized_hint="Rerun deployment to request a new deploy token",
            )
        status = build.get("status")
        if status == "succeeded":
            return build
        if status == "failed":
            detail = build.get("build_log") or "No build log was returned"
            raise DeployError(f"Online source build failed: {detail}")
        if status not in {"queued", "building"}:
            raise DeployError(f"Online source build returned an unknown status: {status}")
        if poll_seconds > 0:
            time.sleep(poll_seconds)
    raise DeployError("Online source build timed out")


def _update_activity(
    installation: Installation,
    game_id: str,
    activity_config: ActivityConfig,
    deploy_token: str,
) -> dict[str, Any]:
    """Write the versioned matchKey of the Bundle bound to the current deploy authorization."""

    try:
        return json_request(
            "PUT",
            (
                f"{installation.online_api_base_url}/v1/games/{quote_path(game_id)}"
                f"/activities/{quote_path(activity_config.match_key)}"
            ),
            activity_config.activation_body(),
            deploy_token,
        )
    except HttpError as error:
        _raise_stage_http_error(
            "Update Match Activity",
            error,
            unauthorized_hint="Rerun deployment to request a new deploy token",
        )


def _update_party_profile(
    installation: Installation,
    game_id: str,
    profile: PartyProfileConfig,
    deploy_token: str,
) -> dict[str, Any]:
    """Write the partyKey max member count, which clients cannot override."""

    try:
        return json_request(
            "PUT",
            (
                f"{installation.online_api_base_url}/v1/games/{quote_path(game_id)}"
                f"/party-profiles/{quote_path(profile.party_key)}"
            ),
            profile.activation_body(),
            deploy_token,
        )
    except HttpError as error:
        _raise_stage_http_error(
            "Update Party Profile",
            error,
            unauthorized_hint="Rerun deployment to request a new deploy token",
        )


def _activate_release(
    installation: Installation,
    game_id: str,
    server_release_id: str,
    deploy_token: str,
) -> dict[str, Any]:
    """Atomically activate the client/server version binding after the source build and all gameplay configuration succeed."""

    try:
        return json_request(
            "POST",
            (
                f"{installation.online_api_base_url}/v1/games/{quote_path(game_id)}"
                "/releases:activate"
            ),
            {"serverReleaseId": server_release_id},
            deploy_token,
        )
    except HttpError as error:
        _raise_stage_http_error(
            "Activate Game Release",
            error,
            unauthorized_hint="Rerun deployment to request a new deploy token",
        )


def _validate_activated_release(release: dict[str, Any]) -> None:
    """Treat the publish as successful only when the server explicitly confirms an active Release."""

    if release.get("status") != "active":
        raise DeployError("Game Release activation did not return active status")
    if int(release.get("online_compatibility_revision", 0)) <= 0:
        raise DeployError("Game Release activation did not return online_compatibility_revision")
    if not str(release.get("server_release_id", "")).strip():
        raise DeployError("Game Release activation did not return server_release_id")


def _raise_stage_http_error(
    stage: str,
    error: HttpError,
    *,
    unauthorized_hint: str,
) -> NoReturn:
    """Keep the server error; add stage recovery advice only for an explicit HTTP 401."""

    message = f"{stage} failed: {error}"
    if error.status_code == 401:
        message = f"{message}; {unauthorized_hint}"
    raise DeployError(message) from error


def _run_builda_command(project_root: Path, command: str) -> None:
    """Reuse only Builda's environment check and login; never call its Online subcommands."""

    unix_cli = project_root / ".builda-agent" / "builda"
    windows_cli = project_root / ".builda-agent" / "builda.cmd"
    if os.name == "nt":
        if not windows_cli.is_file():
            raise DeployError(
                "Builda Windows CLI is not installed; run Builda setup again to install builda.cmd"
            )
        command_processor = os.environ.get("COMSPEC") or shutil.which("cmd.exe")
        if not command_processor:
            raise DeployError("Windows command processor was not found; cannot run Builda auth")
        command_line = f"call {subprocess.list2cmdline([str(windows_cli), command])}"
        process = subprocess.run(
            [command_processor, "/d", "/s", "/c", command_line],
            cwd=project_root,
            check=False,
        )
    elif unix_cli.is_file():
        process = subprocess.run(
            ["bash", str(unix_cli), command],
            cwd=project_root,
            check=False,
        )
    else:
        raise DeployError("Builda CLI is not installed in the project; run Builda setup first")
    if process.returncode != 0:
        raise DeployError(f"Builda {command} failed")


def _python_interpreter_source() -> str:
    """Return the stable Python source injected by the launcher without exposing the local interpreter path."""

    source = os.environ.get("BUILDA_ONLINE_PYTHON_SOURCE", "current-process")
    if source not in {"installation", "python3", "python", "py", "current-process"}:
        return "current-process"
    return source


def _read_publish_grant() -> str:
    """Read the user-level short-lived grant saved by Builda auth, never printing its contents."""

    auth_directory = Path(
        os.environ.get("BUILDA_AUTH_DIR", str(Path.home() / ".builda-agent"))
    )
    token_path = auth_directory / "token"
    try:
        value = token_path.read_text(encoding="utf-8").strip()
    except OSError as error:
        raise DeployError("Builda auth did not generate a user grant; rerun Builda auth") from error
    if not value:
        raise DeployError("Builda user grant is empty; rerun Builda auth")
    return value


def _resolve_from_project(project_root: Path, value: Path) -> Path:
    """Resolve the argument stably to the game project root and reject uploading files outside the workspace."""

    if value.is_absolute():
        resolved = value.resolve()
    else:
        resolved = (project_root / value).resolve()
    try:
        resolved.relative_to(project_root)
    except ValueError as error:
        raise DeployError(f"Deployment input must be inside the game project: {value}") from error
    return resolved


def _write_receipt(project_root: Path, receipt: dict[str, Any]) -> None:
    """Atomically write a deployment receipt containing no credentials."""

    state_directory = project_root / ".builda-online"
    state_directory.mkdir(parents=True, exist_ok=True)
    target = state_directory / "last-deployment.json"
    temporary: Optional[Path] = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            prefix=".last-deployment.",
            suffix=".tmp",
            dir=state_directory,
            delete=False,
        ) as output:
            temporary = Path(output.name)
            json.dump(receipt, output, ensure_ascii=False, indent=2)
            output.write("\n")
        for attempt in range(10):
            try:
                temporary.replace(target)
                temporary = None
                break
            except PermissionError:
                if attempt == 9:
                    raise
                time.sleep(0.01)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
