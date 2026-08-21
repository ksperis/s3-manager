# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime, timezone

import pytest
from botocore.exceptions import ClientError

from app.db import S3Account
from app.models.browser import ObjectMetadata, ObjectMetadataUpdate
from app.services.browser_service import BrowserService


def _account() -> S3Account:
    return S3Account(name="object-metadata-test")


def _client_error(code: str, operation: str) -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": "failed"}}, operation)


def test_update_object_metadata_preserves_source_state_and_tags(monkeypatch):
    calls: list[tuple[str, dict[str, object]]] = []
    original_tags = [
        {"Key": "project", "Value": "bucketreef"},
        {"Key": "space", "Value": "a b"},
    ]

    class FakeClient:
        def head_object(self, **kwargs):  # noqa: ANN001
            calls.append(("head", kwargs))
            return {
                "Metadata": {"old": "value"},
                "ContentType": "text/plain",
                "CacheControl": "max-age=60",
                "ContentDisposition": "attachment",
                "ContentEncoding": "gzip",
                "ContentLanguage": "fr",
                "Expires": "2026-08-21T10:00:00Z",
                "StorageClass": "STANDARD",
            }

        def get_object_tagging(self, **kwargs):  # noqa: ANN001
            calls.append(("get_tags", kwargs))
            return {"TagSet": original_tags}

        def copy_object(self, **kwargs):  # noqa: ANN001
            calls.append(("copy", kwargs))
            return {"VersionId": "v2"}

        def put_object_tagging(self, **kwargs):  # noqa: ANN001
            calls.append(("put_tags", kwargs))

    service = BrowserService()
    expected = ObjectMetadata(key="docs/report.txt", size=0)
    invalidations: list[tuple[S3Account, str]] = []
    monkeypatch.setattr(service, "_client", lambda _account: FakeClient())
    monkeypatch.setattr(
        service,
        "invalidate_object_list_cache_for_account",
        lambda account, bucket: invalidations.append((account, bucket)),
    )
    monkeypatch.setattr(service, "head_object", lambda *_args, **_kwargs: expected)

    account = _account()
    result = service.update_object_metadata(
        "bucket-a",
        account,
        ObjectMetadataUpdate(
            key="docs/report.txt",
            version_id="v1",
            content_type="application/json",
            cache_control="",
            content_encoding="",
            expires="2027-01-02T03:04:05Z",
            metadata={"team": "platform"},
        ),
    )

    assert result is expected
    assert calls[0] == (
        "head",
        {"Bucket": "bucket-a", "Key": "docs/report.txt", "VersionId": "v1"},
    )
    assert calls[1] == (
        "get_tags",
        {"Bucket": "bucket-a", "Key": "docs/report.txt", "VersionId": "v1"},
    )
    copy_request = calls[2][1]
    assert copy_request == {
        "Bucket": "bucket-a",
        "Key": "docs/report.txt",
        "CopySource": {"Bucket": "bucket-a", "Key": "docs/report.txt", "VersionId": "v1"},
        "MetadataDirective": "REPLACE",
        "Metadata": {"team": "platform"},
        "TaggingDirective": "REPLACE",
        "Tagging": "project=bucketreef&space=a+b",
        "ContentType": "application/json",
        "ContentDisposition": "attachment",
        "ContentLanguage": "fr",
        "Expires": datetime(2027, 1, 2, 3, 4, 5, tzinfo=timezone.utc),
        "StorageClass": "STANDARD",
    }
    assert calls[3] == (
        "put_tags",
        {
            "Bucket": "bucket-a",
            "Key": "docs/report.txt",
            "Tagging": {"TagSet": original_tags},
            "VersionId": "v2",
        },
    )
    assert invalidations == [(account, "bucket-a")]


def test_update_object_metadata_copies_empty_tag_set_without_restoration(monkeypatch):
    copy_requests: list[dict[str, object]] = []

    class FakeClient:
        def head_object(self, **_kwargs):  # noqa: ANN001
            return {"Metadata": {"retained": "yes"}, "ContentType": "text/plain"}

        def get_object_tagging(self, **_kwargs):  # noqa: ANN001
            return {"TagSet": []}

        def copy_object(self, **kwargs):  # noqa: ANN001
            copy_requests.append(kwargs)
            return {}

        def put_object_tagging(self, **_kwargs):  # noqa: ANN001
            raise AssertionError("Empty tags must not be restored")

    service = BrowserService()
    monkeypatch.setattr(service, "_client", lambda _account: FakeClient())
    monkeypatch.setattr(service, "invalidate_object_list_cache_for_account", lambda *_args: None)
    monkeypatch.setattr(
        service,
        "head_object",
        lambda *_args, **_kwargs: ObjectMetadata(key="docs/report.txt", size=0),
    )

    service.update_object_metadata(
        "bucket-a",
        _account(),
        ObjectMetadataUpdate(key="docs/report.txt", expires=""),
    )

    assert copy_requests == [
        {
            "Bucket": "bucket-a",
            "Key": "docs/report.txt",
            "CopySource": {"Bucket": "bucket-a", "Key": "docs/report.txt"},
            "MetadataDirective": "REPLACE",
            "Metadata": {"retained": "yes"},
            "TaggingDirective": "COPY",
            "ContentType": "text/plain",
        }
    ]


def test_update_object_metadata_rejects_invalid_expiration_before_copy(monkeypatch):
    class FakeClient:
        def head_object(self, **_kwargs):  # noqa: ANN001
            return {"Metadata": {}}

        def get_object_tagging(self, **_kwargs):  # noqa: ANN001
            return {"TagSet": []}

        def copy_object(self, **_kwargs):  # noqa: ANN001
            raise AssertionError("Invalid input must not reach copy_object")

    service = BrowserService()
    monkeypatch.setattr(service, "_client", lambda _account: FakeClient())

    with pytest.raises(RuntimeError, match="Invalid expires value: tomorrow"):
        service.update_object_metadata(
            "bucket-a",
            _account(),
            ObjectMetadataUpdate(key="docs/report.txt", expires="tomorrow"),
        )


def test_update_object_metadata_reports_tag_restoration_failure(monkeypatch):
    class FakeClient:
        def head_object(self, **_kwargs):  # noqa: ANN001
            return {"Metadata": {}}

        def get_object_tagging(self, **_kwargs):  # noqa: ANN001
            return {"TagSet": [{"Key": "team", "Value": "platform"}]}

        def copy_object(self, **_kwargs):  # noqa: ANN001
            return {"VersionId": "v2"}

        def put_object_tagging(self, **_kwargs):  # noqa: ANN001
            raise _client_error("AccessDenied", "PutObjectTagging")

    service = BrowserService()
    monkeypatch.setattr(service, "_client", lambda _account: FakeClient())

    with pytest.raises(RuntimeError, match="Unable to restore tags for 'docs/report.txt'"):
        service.update_object_metadata(
            "bucket-a",
            _account(),
            ObjectMetadataUpdate(key="docs/report.txt"),
        )
