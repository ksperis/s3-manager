# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging

from app.core.config import get_settings
from app.db import S3Account, S3Connection, S3User
from app.services.app_settings_service import load_app_settings
from app.services.s3_client import get_s3_client
from app.services.s3_execution_context import S3ExecutionContext, S3ExecutionTarget
from app.utils.s3_endpoint import normalize_s3_endpoint, resolve_s3_client_options
from ._shared import _MIGRATION_USER_AGENT_MARKER, _MigrationRuntimeLimits, _ResolvedContext

logger = logging.getLogger(__name__)
settings = get_settings()


class BucketMigrationExecutionContextMixin:
    def _context_client(self, ctx: _ResolvedContext):
        access_key, secret_key = ctx.account.effective_rgw_credentials()
        if not access_key or not secret_key:
            raise RuntimeError(f"Context '{ctx.context_id}' has no credentials")
        token = ctx.account.session_token()
        return get_s3_client(
            access_key=access_key,
            secret_key=secret_key,
            endpoint=ctx.endpoint,
            session_token=token,
            region=ctx.region,
            force_path_style=ctx.force_path_style,
            verify_tls=ctx.verify_tls,
            user_agent_extra=_MIGRATION_USER_AGENT_MARKER,
            request_profile="long_running",
        )

    def _load_runtime_limits(self) -> _MigrationRuntimeLimits:
        env_parallelism_max = max(1, min(int(settings.bucket_migration_parallelism_max or 1), 128))
        env_parallelism_default = env_parallelism_max
        env_max_active = max(1, min(int(settings.bucket_migration_max_active_per_endpoint or 1), 64))

        try:
            manager = load_app_settings().manager
            parallelism_max = max(
                1,
                min(int(manager.bucket_migration_parallelism_max or env_parallelism_max), 128),
            )
            parallelism_default = max(
                1,
                min(int(manager.bucket_migration_parallelism_default or parallelism_max), parallelism_max),
            )
            max_active = max(
                1,
                min(int(manager.bucket_migration_max_active_per_endpoint or env_max_active), 64),
            )
            return _MigrationRuntimeLimits(
                parallelism_default=parallelism_default,
                parallelism_max=parallelism_max,
                max_active_per_endpoint=max_active,
            )
        except Exception:  # noqa: BLE001
            logger.exception(
                "Unable to load app settings for bucket migration runtime limits, falling back to environment values."
            )
            return _MigrationRuntimeLimits(
                parallelism_default=env_parallelism_default,
                parallelism_max=env_parallelism_max,
                max_active_per_endpoint=env_max_active,
            )

    def _resolve_context(self, context_id: str) -> _ResolvedContext:
        account = self._context_to_account(context_id)
        endpoint, region, force_path_style, verify_tls = resolve_s3_client_options(account)
        endpoint = normalize_s3_endpoint(endpoint)
        return _ResolvedContext(
            context_id=context_id,
            account=account,
            endpoint=endpoint,
            region=region,
            force_path_style=force_path_style,
            verify_tls=verify_tls,
        )

    def _context_to_account(self, context_id: str) -> S3ExecutionTarget:
        value = (context_id or "").strip()
        if not value:
            raise ValueError("Invalid context id")

        if value.startswith("conn-"):
            suffix = value.split("conn-", 1)[1]
            if not suffix.isdigit():
                raise ValueError("Invalid connection context id")
            conn = self.db.query(S3Connection).filter(S3Connection.id == int(suffix)).first()
            if not conn:
                raise ValueError("S3Connection not found")
            return S3ExecutionContext.from_connection(conn)

        if value.startswith("s3u-"):
            suffix = value.split("s3u-", 1)[1]
            if not suffix.isdigit():
                raise ValueError("Invalid S3 user context id")
            s3_user = self.db.query(S3User).filter(S3User.id == int(suffix)).first()
            if not s3_user:
                raise ValueError("S3 user not found")
            return S3ExecutionContext.from_legacy_user(s3_user)

        if not value.isdigit():
            raise ValueError("Invalid account context id")
        account = self.db.query(S3Account).filter(S3Account.id == int(value)).first()
        if not account:
            raise ValueError("S3 account not found")
        return account
