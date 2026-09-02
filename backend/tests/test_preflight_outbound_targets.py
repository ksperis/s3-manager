# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.core.config import Settings
from app.db import BucketMigration, S3Connection, User, UserRole
from app.scripts.preflight_outbound_targets import find_uncovered_outbound_targets, run_preflight
from app.utils.s3_connection_endpoint import build_custom_endpoint_config


def _persist_targets(db_session):
    user = User(
        email="preflight@example.test",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    db_session.add(user)
    db_session.flush()
    db_session.add(
        S3Connection(
            created_by_user_id=user.id,
            name="manual target",
            is_shared=False,
            server_managed=False,
            custom_endpoint_config=build_custom_endpoint_config(
                "https://s3.uncovered.example.test/private/path",
                None,
                False,
                True,
            ),
            access_key_id="AKIA-PREFLIGHT-MUST-NOT-APPEAR",
            secret_access_key="preflight-secret-must-not-appear",
        )
    )
    db_session.add(
        BucketMigration(
            created_by_user_id=user.id,
            source_context_id="1",
            target_context_id="2",
            webhook_url="https://hooks.uncovered.example.test/callback?signature=must-not-appear",
        )
    )
    db_session.commit()


def test_preflight_lists_only_uncovered_hostnames(db_session):
    _persist_targets(db_session)
    settings = Settings(
        _env_file=None,
        user_supplied_s3_endpoint_allowed_hosts=[],
        bucket_migration_webhook_allowed_hosts=[],
    )
    output: list[str] = []

    exit_code = run_preflight(db_session, settings, emit=output.append)

    rendered = "\n".join(output)
    assert exit_code == 1
    assert "user-s3-endpoint: s3.uncovered.example.test" in rendered
    assert "migration-webhook: hooks.uncovered.example.test" in rendered
    assert "/private/path" not in rendered
    assert "signature" not in rendered
    assert "AKIA-PREFLIGHT" not in rendered
    assert "preflight-secret" not in rendered


def test_preflight_accepts_exact_and_explicit_wildcard_coverage(db_session):
    _persist_targets(db_session)
    settings = Settings(
        _env_file=None,
        user_supplied_s3_endpoint_allowed_hosts=["*.uncovered.example.test"],
        bucket_migration_webhook_allowed_hosts=["hooks.uncovered.example.test"],
    )

    assert find_uncovered_outbound_targets(db_session, settings) == []
