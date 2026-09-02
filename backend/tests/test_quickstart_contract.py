# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import os
import shutil
import socket
import subprocess
from pathlib import Path

import pytest
import yaml


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
QUICKSTART = REPOSITORY_ROOT / "quickstart"
CONFIG_KEYS = (
    "BUCKETREEF_BIND_ADDRESS",
    "BUCKETREEF_BACKEND_PORT",
    "BUCKETREEF_FRONTEND_PORT",
    "PUBLIC_ORIGIN",
    "WEBAUTHN_ORIGIN",
    "WEBAUTHN_RP_ID",
    "CORS_ORIGINS",
    "ALLOWED_HOSTS",
)
SECRET_KEYS = (
    "UI_JWT_KEYS",
    "API_JWT_KEYS",
    "CREDENTIAL_KEYS",
    "INTERNAL_CRON_TOKEN",
)


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _parse_env(path: Path) -> dict[str, str]:
    return dict(
        line.split("=", 1)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line and not line.startswith("#")
    )


@pytest.fixture
def quickstart_runtime(tmp_path: Path) -> tuple[Path, dict[str, str], Path]:
    workdir = tmp_path / "workspace"
    bin_dir = tmp_path / "bin"
    state_dir = tmp_path / "state"
    volume_source = tmp_path / "volume"
    for directory in (workdir, bin_dir, state_dir, volume_source):
        directory.mkdir()
    shutil.copy2(QUICKSTART, workdir / "quickstart")
    (workdir / "quickstart").chmod(0o755)
    (workdir / "docker-compose.build.yml").write_text("services: {}\n", encoding="utf-8")
    (volume_source / "app.db").write_bytes(b"sqlite fixture")

    docker = bin_dir / "docker"
    docker.write_text(
        """#!/bin/sh
set -eu
printf '%s\n' "$*" >> "$FAKE_DOCKER_LOG"
if [ "${1:-}" = "info" ]; then
  exit 0
fi
if [ "${1:-}" = "volume" ] && [ "${2:-}" = "ls" ]; then
  printf '%s\n' 'bucketreef-quickstart_backend-data'
  exit 0
fi
if [ "${1:-}" = "volume" ] && [ "${2:-}" = "rm" ]; then
  exit 0
fi
if [ "${1:-}" = "run" ]; then
  backup_dir=''
  for argument in "$@"; do
    case "$argument" in
      *:/backup) backup_dir="${argument%:/backup}" ;;
    esac
  done
  [ -n "$backup_dir" ]
  tar -C "$FAKE_VOLUME_SOURCE" -cf "$backup_dir/backend-data.tar" .
  exit 0
fi
if [ "${1:-}" = "compose" ]; then
  case " $* " in
    *" version "*) exit 0 ;;
    *" ps --status running --quiet backend "*)
      [ "${FAKE_BACKEND_RUNNING:-1}" = "1" ] && printf '%s\n' backend-id
      exit 0
      ;;
    *" ps --status running --quiet frontend "*)
      [ "${FAKE_FRONTEND_RUNNING:-1}" = "1" ] && printf '%s\n' frontend-id
      exit 0
      ;;
    *" exec --no-TTY backend python -m app.scripts.issue_first_admin_bootstrap "*)
      case "${FAKE_BOOTSTRAP_MODE:-issue}" in
        issue)
          printf '%s\n' 'Bootstrap URL: http://demo.local/setup/first-admin#token=secret'
          printf '%s\n' 'Expires at: 2030-01-01T00:00:00+00:00'
          exit 0
          ;;
        existing)
          printf '%s\n' 'The database already contains users' >&2
          exit 1
          ;;
        *)
          printf '%s\n' 'bootstrap failure' >&2
          exit 1
          ;;
      esac
      ;;
    *" ps ")
      printf '%s\n' 'NAME STATUS' 'backend Up (healthy)' 'frontend Up (healthy)'
      exit 0
      ;;
    *) exit 0 ;;
  esac
fi
exit 1
""",
        encoding="utf-8",
    )
    docker.chmod(0o755)

    curl = bin_dir / "curl"
    curl.write_text(
        """#!/bin/sh
set -eu
url=''
for argument in "$@"; do url="$argument"; done
case "${FAKE_CURL_MODE:-healthy}" in
  unavailable) exit 22 ;;
  frontend-down)
    case "$url" in */setup/first-admin) exit 22 ;; esac
    ;;
esac
case "$url" in
  */api/auth/bootstrap/first-admin/status)
    printf '%s' '{"available":true}'
    ;;
esac
""",
        encoding="utf-8",
    )
    curl.chmod(0o755)

    openssl = bin_dir / "openssl"
    openssl.write_text(
        """#!/bin/sh
set -eu
counter_file="$FAKE_OPENSSL_COUNTER"
counter=0
[ ! -f "$counter_file" ] || counter="$(sed -n '1p' "$counter_file")"
counter=$((counter + 1))
printf '%s\n' "$counter" > "$counter_file"
printf '%096d\n' "$counter"
""",
        encoding="utf-8",
    )
    openssl.chmod(0o755)

    environment = {
        **os.environ,
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "FAKE_DOCKER_LOG": str(state_dir / "docker.log"),
        "FAKE_OPENSSL_COUNTER": str(state_dir / "openssl-counter"),
        "FAKE_VOLUME_SOURCE": str(volume_source),
        "QUICKSTART_HEALTH_TIMEOUT_SECONDS": "1",
    }
    return workdir, environment, state_dir / "docker.log"


def _write_environment(workdir: Path, **overrides: str) -> dict[str, str]:
    values = {
        "APP_ENV": "development",
        "UI_JWT_KEYS": '["old-ui"]',
        "API_JWT_KEYS": '["old-api"]',
        "CREDENTIAL_KEYS": '["old-credential"]',
        "INTERNAL_CRON_TOKEN": "old-cron",
        "BUCKETREEF_BIND_ADDRESS": "127.0.0.1",
        "BUCKETREEF_BACKEND_PORT": str(_free_port()),
        "BUCKETREEF_FRONTEND_PORT": str(_free_port()),
        "PUBLIC_ORIGIN": "http://demo.local",
        "WEBAUTHN_ORIGIN": "http://demo.local",
        "WEBAUTHN_RP_ID": "demo.local",
        "CORS_ORIGINS": '["http://demo.local"]',
        "ALLOWED_HOSTS": '["demo.local", "backend"]',
    }
    values.update(overrides)
    path = workdir / ".env.quickstart"
    path.write_text(
        "".join(f"{key}={value}\n" for key, value in values.items()),
        encoding="utf-8",
    )
    path.chmod(0o600)
    return values


def _run(
    workdir: Path,
    environment: dict[str, str],
    *arguments: str,
    input_text: str | None = None,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(workdir / "quickstart"), *arguments],
        cwd=workdir,
        env=environment,
        input=input_text,
        capture_output=True,
        text=True,
        check=False,
    )


def test_start_builds_checkout_and_refuses_token_when_frontend_stops(quickstart_runtime):
    workdir, environment, docker_log = quickstart_runtime
    _write_environment(workdir)
    environment["FAKE_FRONTEND_RUNNING"] = "0"

    result = _run(workdir, environment)

    assert result.returncode == 1
    assert "Backend or frontend stopped before becoming ready" in result.stderr
    log = docker_log.read_text(encoding="utf-8")
    assert "--file docker-compose.build.yml up --detach --build backend frontend" in log
    assert "issue_first_admin_bootstrap" not in log


def test_start_times_out_before_issuing_token(quickstart_runtime):
    workdir, environment, docker_log = quickstart_runtime
    _write_environment(workdir)
    environment["FAKE_CURL_MODE"] = "unavailable"

    result = _run(workdir, environment)

    assert result.returncode == 1
    assert "did not become ready within 1 seconds" in result.stderr
    assert "issue_first_admin_bootstrap" not in docker_log.read_text(encoding="utf-8")


def test_rerun_is_idempotent_and_uses_public_origin_for_login(quickstart_runtime):
    workdir, environment, docker_log = quickstart_runtime
    _write_environment(workdir, PUBLIC_ORIGIN="https://bucketreef.example")
    environment["FAKE_BOOTSTRAP_MODE"] = "existing"

    result = _run(workdir, environment)

    assert result.returncode == 0
    assert "Sign in at https://bucketreef.example/login" in result.stdout
    assert "up --detach --build backend frontend" in docker_log.read_text(encoding="utf-8")


def test_status_reports_backend_frontend_and_bootstrap_separately(quickstart_runtime):
    workdir, environment, _docker_log = quickstart_runtime
    _write_environment(workdir)

    result = _run(workdir, environment, "status")

    assert result.returncode == 0
    assert "Backend health: healthy" in result.stdout
    assert "Frontend health: healthy" in result.stdout
    assert "First-administrator bootstrap: issued and available" in result.stdout


def test_stop_is_idempotent_and_preserves_data(quickstart_runtime):
    workdir, environment, docker_log = quickstart_runtime
    _write_environment(workdir)

    first = _run(workdir, environment, "stop")
    second = _run(workdir, environment, "stop")

    assert first.returncode == second.returncode == 0
    assert "Data and secrets were preserved" in first.stdout
    assert docker_log.read_text(encoding="utf-8").count("--profile operations stop") == 2


def test_reset_refuses_incorrect_confirmation_without_touching_volume(quickstart_runtime):
    workdir, environment, docker_log = quickstart_runtime
    _write_environment(workdir)

    result = _run(workdir, environment, "reset", input_text="NO\n")

    assert result.returncode == 1
    assert "Reset cancelled" in result.stderr
    log = docker_log.read_text(encoding="utf-8")
    assert "volume ls" not in log
    assert "volume rm" not in log


def test_reset_preserves_network_config_rotates_secrets_and_verifies_backup(quickstart_runtime):
    workdir, environment, docker_log = quickstart_runtime
    previous = _write_environment(workdir)

    result = _run(
        workdir,
        environment,
        "reset",
        input_text="RESET BUCKETREEF QUICKSTART\n",
    )

    assert result.returncode == 0, result.stderr
    current = _parse_env(workdir / ".env.quickstart")
    assert {key: current[key] for key in CONFIG_KEYS} == {
        key: previous[key] for key in CONFIG_KEYS
    }
    assert all(current[key] != previous[key] for key in SECRET_KEYS)
    assert len({current[key] for key in SECRET_KEYS}) == len(SECRET_KEYS)
    assert (workdir / ".env.quickstart").stat().st_mode & 0o777 == 0o600

    backups = list((workdir / ".bucketreef-backups").iterdir())
    assert len(backups) == 1
    backup = backups[0]
    assert _parse_env(backup / "env.quickstart") == previous
    assert (backup / "backend-data.tar").stat().st_size > 0
    assert (backup / "backend-data.manifest").stat().st_size > 0
    assert backup.stat().st_mode & 0o777 == 0o700
    log = docker_log.read_text(encoding="utf-8")
    assert "volume rm bucketreef-quickstart_backend-data" in log
    assert "down --volumes" not in log


def test_compose_defaults_are_safe_and_services_have_healthchecks():
    for filename in ("docker-compose.yml", "docker-compose.build.yml"):
        payload = yaml.safe_load((REPOSITORY_ROOT / filename).read_text(encoding="utf-8"))
        services = payload["services"]

        assert services["scheduler"]["profiles"] == ["operations"]
        assert services["backend"]["ports"] == [
            "${BUCKETREEF_BIND_ADDRESS:-127.0.0.1}:${BUCKETREEF_BACKEND_PORT:-8000}:8000"
        ]
        assert services["frontend"]["ports"] == [
            "${BUCKETREEF_BIND_ADDRESS:-127.0.0.1}:${BUCKETREEF_FRONTEND_PORT:-8080}:8080"
        ]
        assert services["frontend"]["environment"]["CSP_CONNECT_SRC"] == (
            "${CSP_CONNECT_SRC:-'self'}"
        )
        assert services["backend"]["healthcheck"]
        assert services["frontend"]["healthcheck"]


def test_quickstart_runtime_material_is_ignored():
    gitignore = (REPOSITORY_ROOT / ".gitignore").read_text(encoding="utf-8")
    assert ".env.*" in gitignore
    assert ".bucketreef-backups/" in gitignore


def test_kind_checksum_uses_busybox_compatible_check_flag():
    gitlab_ci = (REPOSITORY_ROOT / ".gitlab-ci.yml").read_text(encoding="utf-8")

    assert "sha256sum -c" in gitlab_ci
    assert "sha256sum --check" not in gitlab_ci


def test_kind_smoke_routes_the_api_through_the_dind_service():
    gitlab_ci = yaml.safe_load(
        (REPOSITORY_ROOT / ".gitlab-ci.yml").read_text(encoding="utf-8")
    )
    smoke_job = gitlab_ci["helm-kind-onboarding-smoke"]
    smoke_script = (
        REPOSITORY_ROOT / "ops" / "ci" / "kind-onboarding-smoke.sh"
    ).read_text(encoding="utf-8")

    assert smoke_job["variables"]["KIND_API_HOST"] == "docker"
    assert 'apiServerAddress: "0.0.0.0"' in smoke_script
    assert 'certSANs:' in smoke_script
    assert '--server="https://${KIND_API_HOST}:${api_port}"' in smoke_script
