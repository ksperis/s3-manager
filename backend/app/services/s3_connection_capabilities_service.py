# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from botocore.exceptions import BotoCoreError, ClientError

from app.services.rgw_iam import get_iam_client
from app.utils.s3_connection_capabilities import dump_s3_connection_capabilities
from app.utils.s3_connection_endpoint import resolve_connection_details


def probe_connection_can_manage_iam(connection) -> bool:
    details = resolve_connection_details(connection)
    if not details.endpoint_url or not connection.access_key_id or not connection.secret_access_key:
        return False
    try:
        client = get_iam_client(
            access_key=connection.access_key_id,
            secret_key=connection.secret_access_key,
            endpoint=details.endpoint_url,
            region=details.region,
            verify_tls=details.verify_tls,
        )
        client.list_users(MaxItems=1)
        return True
    except (ClientError, BotoCoreError, RuntimeError):
        return False


def refresh_connection_detected_capabilities(connection) -> None:
    connection.capabilities_json = dump_s3_connection_capabilities(
        getattr(connection, "capabilities_json", None),
        can_manage_iam=probe_connection_can_manage_iam(connection),
    )

