# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from urllib.parse import parse_qs, urlsplit

import boto3
from botocore.config import Config

from app.models.browser import PresignRequest
from app.services.browser_service import BrowserService


def test_put_presign_keeps_content_type_out_of_signature(monkeypatch):
    client = boto3.client(
        "s3",
        endpoint_url="https://s3.example.test",
        region_name="us-east-1",
        aws_access_key_id="temporary-access-key",
        aws_secret_access_key="temporary-secret-key",
        aws_session_token="temporary-session-token",
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path"},
        ),
    )
    service = BrowserService()
    monkeypatch.setattr(service, "_client", lambda _account: client)

    result = service.presign(
        "bucket-a",
        object(),
        PresignRequest(
            key="images/photo.jpeg",
            operation="put_object",
            content_type="image/jpeg",
            expires_in=600,
        ),
    )

    query = parse_qs(urlsplit(result.url).query)
    assert query["X-Amz-SignedHeaders"] == ["host"]
    assert "X-Amz-Security-Token" in query
    assert result.method == "PUT"
    assert result.headers == {"Content-Type": "image/jpeg"}
