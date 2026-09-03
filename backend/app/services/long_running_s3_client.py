# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from typing import Any

from app.services import s3_client
from app.services.s3_execution_client import (
    require_s3_execution_credentials,
    s3_execution_client_kwargs,
)
from app.services.s3_execution_context import S3ExecutionTarget


class LongRunningS3ClientMixin:
    s3_credentials_error_message = "S3 account is missing credentials"
    s3_user_agent_extra: str | None = None

    def _account_credentials(self, account: S3ExecutionTarget) -> tuple[str, str]:
        return require_s3_execution_credentials(
            account,
            error_message=self.s3_credentials_error_message,
        )

    def _client_kwargs(self, account: S3ExecutionTarget) -> dict[str, Any]:
        client_kwargs = s3_execution_client_kwargs(account)
        if self.s3_user_agent_extra:
            client_kwargs["user_agent_extra"] = self.s3_user_agent_extra
        return client_kwargs

    def _build_client(self, account: S3ExecutionTarget):
        access_key, secret_key = self._account_credentials(account)
        return s3_client.get_s3_client(
            access_key=access_key,
            secret_key=secret_key,
            request_profile="long_running",
            **self._client_kwargs(account),
        )
