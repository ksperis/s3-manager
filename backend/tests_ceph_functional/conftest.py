# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import sys
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Generator

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from .clients import BackendAuthenticator, BackendSession, CephVerifier  # noqa: E402
from .config import CephTestSettings, load_settings  # noqa: E402
from .resources import ResourceTracker  # noqa: E402
from .summary import RunSummary  # noqa: E402


@dataclass
class S3AccountTestContext:
    account_id: int
    account_name: str
    rgw_account_id: str | None
    manager_session: BackendSession
    manager_user_id: int
    manager_email: str


def pytest_configure(config: pytest.Config) -> None:
    config._ceph_summary = RunSummary()  # type: ignore[attr-defined]


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item: pytest.Item, call: pytest.CallInfo):
    outcome = yield
    summary: RunSummary | None = getattr(item.config, "_ceph_summary", None)  # type: ignore[attr-defined]
    if not summary:
        return
    rep = outcome.get_result()
    if rep.when == "setup" and rep.failed:
        summary.record(item.nodeid, "setup_error", rep.duration)
    elif rep.when == "call":
        status = "failed" if rep.failed else "skipped" if rep.skipped else "passed"
        summary.record(item.nodeid, status, rep.duration)
    elif rep.when == "teardown" and rep.failed:
        summary.record(item.nodeid, "teardown_error", rep.duration)


def pytest_terminal_summary(terminalreporter, exitstatus: int) -> None:  # type: ignore[override]
    summary: RunSummary | None = getattr(terminalreporter.config, "_ceph_summary", None)  # type: ignore[attr-defined]
    if not summary:
        return
    table = summary.as_table()
    terminalreporter.write_sep("=", "Ceph functional summary")
    if table:
        terminalreporter.write_line(table)
    else:
        terminalreporter.write_line("No scenarios were executed.")
    if summary.cleanup_errors:
        terminalreporter.write_sep("-", "Cleanup issues")
        for err in summary.cleanup_errors:
            terminalreporter.write_line(f"- {err}")


@pytest.fixture(scope="session")
def ceph_test_settings() -> CephTestSettings:
    return load_settings()


@pytest.fixture(scope="session")
def backend_authenticator(ceph_test_settings: CephTestSettings) -> BackendAuthenticator:
    return BackendAuthenticator(ceph_test_settings)


@pytest.fixture(scope="session")
def super_admin_session(
    backend_authenticator: BackendAuthenticator,
    ceph_test_settings: CephTestSettings,
) -> BackendSession:
    return backend_authenticator.login(
        ceph_test_settings.super_admin_email,
        ceph_test_settings.super_admin_password,
    )


@pytest.fixture(scope="session")
def ceph_verifier(ceph_test_settings: CephTestSettings) -> CephVerifier | None:
    try:
        return CephVerifier(ceph_test_settings)
    except RuntimeError:
        return None


@pytest.fixture(scope="session")
def summary_recorder(pytestconfig: pytest.Config) -> RunSummary:
    summary: RunSummary = pytestconfig._ceph_summary  # type: ignore[attr-defined]
    return summary


@pytest.fixture
def resource_tracker(
    super_admin_session: BackendSession,
    ceph_test_settings: CephTestSettings,
    summary_recorder: RunSummary,
) -> Generator[ResourceTracker, None, None]:
    tracker = ResourceTracker(
        admin_session=super_admin_session,
        delete_rgw_by_default=ceph_test_settings.cleanup_delete_rgw,
    )
    yield tracker
    errors = tracker.cleanup()
    summary_recorder.record_cleanup_errors(errors)


def _rand_suffix(length: int = 8) -> str:
    return uuid.uuid4().hex[:length]


def _provision_account(
    super_admin_session: BackendSession,
    backend_authenticator: BackendAuthenticator,
    ceph_test_settings: CephTestSettings,
    resource_tracker: ResourceTracker,
    *,
    account_payload: dict | None = None,
) -> S3AccountTestContext:
    default_payload = {
        "name": f"{ceph_test_settings.test_prefix}-acct-{_rand_suffix()}",
        "email": f"{_rand_suffix()}@example.com",
        "quota_max_size_gb": 5,
        "quota_max_objects": 5000,
    }
    if account_payload:
        default_payload.update(account_payload)

    created_account = super_admin_session.post(
        "/admin/accounts",
        json=default_payload,
        expected_status=201,
    )
    account_id = int(created_account["id"])
    resource_tracker.track_account(account_id)

    manager_email = f"{ceph_test_settings.test_prefix}.manager.{_rand_suffix(6)}@example.com"
    manager_password = f"Test-{_rand_suffix(10)}"

    created_user = super_admin_session.post(
        "/admin/users",
        json={
            "email": manager_email,
            "password": manager_password,
            "full_name": "Ceph Functional Manager",
            "role": "account_admin",
        },
        expected_status=201,
    )
    manager_user_id = created_user["id"]
    resource_tracker.track_user(manager_user_id)

    super_admin_session.post(
        f"/admin/users/{manager_user_id}/assign-account",
        json={"account_id": account_id, "account_root": False},
        expected_status=200,
    )

    manager_session = backend_authenticator.login(manager_email, manager_password)
    return S3AccountTestContext(
        account_id=account_id,
        account_name=default_payload["name"],
        rgw_account_id=created_account.get("rgw_account_id"),
        manager_session=manager_session,
        manager_user_id=manager_user_id,
        manager_email=manager_email,
    )


@pytest.fixture
def account_factory(
    super_admin_session: BackendSession,
    backend_authenticator: BackendAuthenticator,
    ceph_test_settings: CephTestSettings,
    resource_tracker: ResourceTracker,
) -> Callable[..., S3AccountTestContext]:
    def _factory(**kwargs) -> S3AccountTestContext:
        payload = kwargs.get("account_payload")
        return _provision_account(
            super_admin_session,
            backend_authenticator,
            ceph_test_settings,
            resource_tracker,
            account_payload=payload,
        )

    return _factory


@pytest.fixture
def provisioned_account(account_factory: Callable[..., S3AccountTestContext]) -> S3AccountTestContext:
    return account_factory()
