# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import threading
import time
from datetime import datetime, timezone
from types import SimpleNamespace

from botocore.exceptions import ClientError

from app.services.bucket_integrity_service import (
    BucketIntegrityCheckService,
    BucketIntegrityOptions,
    BucketIntegrityResolvedTarget,
)


class FakeBody:
    def __init__(self, payload: bytes):
        self.payload = payload
        self.offset = 0
        self.closed = False

    def read(self, size: int = -1) -> bytes:
        if self.offset >= len(self.payload):
            return b""
        if size is None or size < 0:
            size = len(self.payload) - self.offset
        end = min(len(self.payload), self.offset + size)
        chunk = self.payload[self.offset:end]
        self.offset = end
        return chunk

    def close(self) -> None:
        self.closed = True


class FakePaginator:
    def __init__(self, pages=None, error: Exception | None = None):
        self.pages = pages or []
        self.error = error
        self.calls: list[dict] = []

    def paginate(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        yield from self.pages


class FakeS3Client:
    def __init__(self, paginators: dict[str, FakePaginator], objects: dict[tuple[str, str | None], bytes]):
        self.paginators = paginators
        self.objects = objects
        self.get_calls: list[dict] = []
        self.head_calls: list[dict] = []
        self.get_errors: dict[tuple[str, str | None], Exception] = {}
        self.head_errors: dict[tuple[str, str | None], Exception] = {}
        self.delay_seconds = 0.0
        self._lock = threading.Lock()
        self._active_gets = 0
        self.max_active_gets = 0

    def get_paginator(self, name: str) -> FakePaginator:
        return self.paginators[name]

    def get_object(self, **kwargs):
        self.get_calls.append(kwargs)
        key = (kwargs["Key"], kwargs.get("VersionId"))
        with self._lock:
            self._active_gets += 1
            self.max_active_gets = max(self.max_active_gets, self._active_gets)
        try:
            if self.delay_seconds:
                time.sleep(self.delay_seconds)
            error = self.get_errors.get(key)
            if error:
                raise error
            return {"Body": FakeBody(self.objects[key])}
        finally:
            with self._lock:
                self._active_gets -= 1

    def head_object(self, **kwargs):
        self.head_calls.append(kwargs)
        key = (kwargs["Key"], kwargs.get("VersionId"))
        error = self.head_errors.get(key)
        if error:
            raise error
        return {}


class FakeIntegrityService(BucketIntegrityCheckService):
    def __init__(self, client: FakeS3Client):
        self.client = client

    def _build_client(self, account):
        return self.client


def _target(bucket_name: str = "bucket-a") -> BucketIntegrityResolvedTarget:
    return BucketIntegrityResolvedTarget(
        account=SimpleNamespace(),
        bucket_name=bucket_name,
        context_id="ctx-1",
        context_name="Context 1",
    )


def _client_error(code: str, message: str, operation: str = "GetObject") -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": message}}, operation)


def test_integrity_service_defaults_to_head_object_without_reading_bodies():
    paginator = FakePaginator(
        [
            {"Contents": [{"Key": "a.txt", "LastModified": datetime(2026, 1, 1, tzinfo=timezone.utc)}]},
            {"Contents": [{"Key": "b.txt", "LastModified": datetime(2026, 1, 2, tzinfo=timezone.utc)}]},
        ]
    )
    client = FakeS3Client(
        {"list_objects_v2": paginator},
        {
            ("a.txt", None): b"aa",
            ("b.txt", None): b"bbb",
        },
    )
    service = FakeIntegrityService(client)

    result = service.run([_target()], BucketIntegrityOptions(parallelism=2))

    assert result.status == "passed"
    assert result.listed_count == 2
    assert result.checked_count == 2
    assert result.bytes_read == 0
    assert paginator.calls == [{"Bucket": "bucket-a"}]
    assert {call["Key"] for call in client.head_calls} == {"a.txt", "b.txt"}
    assert client.get_calls == []


def test_integrity_service_lists_paginated_latest_objects_and_reads_full_bodies():
    paginator = FakePaginator(
        [
            {"Contents": [{"Key": "a.txt", "LastModified": datetime(2026, 1, 1, tzinfo=timezone.utc)}]},
            {"Contents": [{"Key": "b.txt", "LastModified": datetime(2026, 1, 2, tzinfo=timezone.utc)}]},
        ]
    )
    client = FakeS3Client(
        {"list_objects_v2": paginator},
        {
          ("a.txt", None): b"aa",
          ("b.txt", None): b"bbb",
        },
    )
    service = FakeIntegrityService(client)

    result = service.run([_target()], BucketIntegrityOptions(parallelism=2, check_mode="get"))

    assert result.status == "passed"
    assert result.listed_count == 2
    assert result.checked_count == 2
    assert result.bytes_read == 5
    assert paginator.calls == [{"Bucket": "bucket-a"}]
    assert {call["Key"] for call in client.get_calls} == {"a.txt", "b.txt"}


def test_integrity_service_lists_versions_skips_delete_markers_and_applies_since_filter():
    cutoff = datetime(2026, 1, 2, tzinfo=timezone.utc)
    paginator = FakePaginator(
        [
            {
                "Versions": [
                    {"Key": "old.txt", "VersionId": "v1", "LastModified": datetime(2026, 1, 1, tzinfo=timezone.utc)},
                    {"Key": "new.txt", "VersionId": "v2", "LastModified": datetime(2026, 1, 3, tzinfo=timezone.utc)},
                ],
                "DeleteMarkers": [
                    {"Key": "deleted.txt", "VersionId": "v3", "LastModified": datetime(2026, 1, 3, tzinfo=timezone.utc)}
                ],
            }
        ]
    )
    client = FakeS3Client({"list_object_versions": paginator}, {("new.txt", "v2"): b"ok"})
    service = FakeIntegrityService(client)

    result = service.run(
        [_target()],
        BucketIntegrityOptions(parallelism=2, all_versions=True, check_mode="get", since=cutoff),
    )

    assert result.status == "passed"
    assert result.listed_count == 1
    assert result.checked_count == 1
    assert client.get_calls == [{"Bucket": "bucket-a", "Key": "new.txt", "VersionId": "v2"}]


def test_integrity_service_limits_bytes_read_per_object():
    payload = b"x" * (2 * 1024 * 1024)
    client = FakeS3Client(
        {"list_objects_v2": FakePaginator([{"Contents": [{"Key": "large.bin"}]}])},
        {("large.bin", None): payload},
    )
    service = FakeIntegrityService(client)

    result = service.run([_target()], BucketIntegrityOptions(check_mode="get", max_mb_per_object=1))

    assert result.status == "passed"
    assert result.bytes_read == 1024 * 1024


def test_integrity_service_reports_get_object_errors_as_object_failures():
    client = FakeS3Client(
        {"list_objects_v2": FakePaginator([{"Contents": [{"Key": "broken.txt"}]}])},
        {("broken.txt", None): b""},
    )
    client.get_errors[("broken.txt", None)] = _client_error("AccessDenied", "denied")
    service = FakeIntegrityService(client)

    result = service.run([_target()], BucketIntegrityOptions(check_mode="get"))

    bucket = result.buckets[0]
    assert result.status == "completed_with_errors"
    assert bucket.failed_count == 1
    assert bucket.failures_sample[0].stage == "get"
    assert bucket.failures_sample[0].key == "broken.txt"
    assert "AccessDenied" in bucket.failures_sample[0].message


def test_integrity_service_reports_head_object_errors_as_object_failures():
    client = FakeS3Client(
        {"list_objects_v2": FakePaginator([{"Contents": [{"Key": "missing-meta.txt"}]}])},
        {("missing-meta.txt", None): b""},
    )
    client.head_errors[("missing-meta.txt", None)] = _client_error("AccessDenied", "denied", "HeadObject")
    service = FakeIntegrityService(client)

    result = service.run([_target()], BucketIntegrityOptions())

    bucket = result.buckets[0]
    assert result.status == "completed_with_errors"
    assert bucket.failed_count == 1
    assert bucket.bytes_read == 0
    assert bucket.failures_sample[0].stage == "head"
    assert bucket.failures_sample[0].key == "missing-meta.txt"
    assert "AccessDenied" in bucket.failures_sample[0].message
    assert client.get_calls == []


def test_integrity_service_keeps_large_failure_sample_bounded():
    object_names = [f"broken-{idx}.txt" for idx in range(501)]
    client = FakeS3Client(
        {"list_objects_v2": FakePaginator([{"Contents": [{"Key": name} for name in object_names]}])},
        {(name, None): b"" for name in object_names},
    )
    for name in object_names:
        client.get_errors[(name, None)] = _client_error("AccessDenied", "denied")
    service = FakeIntegrityService(client)

    result = service.run([_target()], BucketIntegrityOptions(parallelism=1, check_mode="get"))

    bucket = result.buckets[0]
    assert bucket.failed_count == 501
    assert len(bucket.failures_sample) == 500


def test_integrity_service_reports_listing_errors_as_bucket_failures():
    client = FakeS3Client(
        {"list_objects_v2": FakePaginator(error=_client_error("NoSuchBucket", "missing", "ListObjectsV2"))},
        {},
    )
    service = FakeIntegrityService(client)

    result = service.run([_target()], BucketIntegrityOptions())

    bucket = result.buckets[0]
    assert result.status == "failed"
    assert bucket.status == "failed"
    assert bucket.checked_count == 0
    assert bucket.failures_sample[0].stage == "list"
    assert "NoSuchBucket" in bucket.failures_sample[0].message


def test_integrity_service_uses_bounded_parallel_object_reads():
    object_names = [f"object-{idx}" for idx in range(6)]
    client = FakeS3Client(
        {"list_objects_v2": FakePaginator([{"Contents": [{"Key": name} for name in object_names]}])},
        {(name, None): b"x" for name in object_names},
    )
    client.delay_seconds = 0.03
    service = FakeIntegrityService(client)

    result = service.run([_target()], BucketIntegrityOptions(parallelism=3, check_mode="get"))

    assert result.status == "passed"
    assert result.checked_count == len(object_names)
    assert 2 <= client.max_active_gets <= 3
