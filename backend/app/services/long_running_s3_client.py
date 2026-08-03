# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from typing import Any

from app.services import s3_client
from app.services.s3_execution_context import S3ExecutionTarget
from app.utils.s3_endpoint import resolve_s3_client_kwargs


class LongRunningS3ClientService:
    s3_user_agent_extra: str

    def _account_credentials(self, account: S3ExecutionTarget) -> tuple[str, str]:
        access_key, secret_key = account.effective_rgw_credentials()
        if not access_key or not secret_key:
            raise RuntimeError("S3 account is missing credentials")
        return access_key, secret_key

    def _client_kwargs(self, account: S3ExecutionTarget) -> dict[str, Any]:
        return {
            **resolve_s3_client_kwargs(account),
            "session_token": account.session_token(),
            "user_agent_extra": self.s3_user_agent_extra,
        }

    def _build_client(self, account: S3ExecutionTarget):
        access_key, secret_key = self._account_credentials(account)
        return s3_client.get_s3_client(
            access_key=access_key,
            secret_key=secret_key,
            request_profile="long_running",
            **self._client_kwargs(account),
        )
