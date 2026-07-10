# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from botocore.exceptions import ClientError, ParamValidationError
from botocore.parsers import ResponseParserError
from concurrent.futures import ThreadPoolExecutor

from app.services import s3_client


class FakeS3PublicAccessClient:
    def __init__(self):
        self.put_calls = []
        self.delete_calls = []

    def put_public_access_block(self, **kwargs):
        self.put_calls.append(kwargs)

    def delete_public_access_block(self, **kwargs):
        self.delete_calls.append(kwargs)


class FakeS3EncryptionClient:
    def __init__(self):
        self.put_calls = []
        self.delete_calls = []

    def get_bucket_encryption(self, **kwargs):
        return {
            "ServerSideEncryptionConfiguration": {
                "Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]
            }
        }

    def put_bucket_encryption(self, **kwargs):
        self.put_calls.append(kwargs)

    def delete_bucket_encryption(self, **kwargs):
        self.delete_calls.append(kwargs)


def test_public_access_block_avoids_acl_flags(monkeypatch):
    fake_client = FakeS3PublicAccessClient()
    monkeypatch.setattr(s3_client, "get_s3_client", lambda *args, **kwargs: fake_client)

    s3_client.set_bucket_public_access_block("bucket-one", block=True)

    assert fake_client.put_calls, "Expected put_public_access_block to be called"
    call_args = fake_client.put_calls[0]
    assert call_args["Bucket"] == "bucket-one"
    config = call_args["PublicAccessBlockConfiguration"]
    assert config["BlockPublicPolicy"] is True
    assert config["RestrictPublicBuckets"] is True
    assert config["BlockPublicAcls"] is False
    assert config["IgnorePublicAcls"] is False


def test_public_access_block_disable(monkeypatch):
    fake_client = FakeS3PublicAccessClient()
    monkeypatch.setattr(s3_client, "get_s3_client", lambda *args, **kwargs: fake_client)

    s3_client.set_bucket_public_access_block("bucket-two", block=False)

    assert fake_client.delete_calls == [{"Bucket": "bucket-two"}]


def test_get_bucket_encryption_returns_rules(monkeypatch):
    fake_client = FakeS3EncryptionClient()
    monkeypatch.setattr(s3_client, "get_s3_client", lambda *args, **kwargs: fake_client)

    rules = s3_client.get_bucket_encryption("bucket-enc")

    assert rules == [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]


def test_put_bucket_encryption_sends_rules(monkeypatch):
    fake_client = FakeS3EncryptionClient()
    monkeypatch.setattr(s3_client, "get_s3_client", lambda *args, **kwargs: fake_client)

    payload = [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]
    s3_client.put_bucket_encryption("bucket-enc", payload)

    assert fake_client.put_calls == [
        {
            "Bucket": "bucket-enc",
            "ServerSideEncryptionConfiguration": {"Rules": payload},
        }
    ]


def test_delete_bucket_encryption_ignores_missing_configuration(monkeypatch):
    class MissingConfigClient:
        def delete_bucket_encryption(self, **kwargs):
            raise ClientError(
                {"Error": {"Code": "ServerSideEncryptionConfigurationNotFoundError", "Message": "not found"}},
                "DeleteBucketEncryption",
            )

    monkeypatch.setattr(s3_client, "get_s3_client", lambda *args, **kwargs: MissingConfigClient())

    s3_client.delete_bucket_encryption("bucket-enc")


def test_get_bucket_replication_returns_configuration(monkeypatch):
    class FakeReplicationClient:
        def get_bucket_replication(self, **kwargs):
            assert kwargs["Bucket"] == "bucket-repl"
            return {
                "ReplicationConfiguration": {
                    "Role": "arn:aws:iam::123456789012:role/replication",
                    "Rules": [{"ID": "rule-1"}],
                }
            }

    monkeypatch.setattr(s3_client, "get_s3_client", lambda *args, **kwargs: FakeReplicationClient())

    config = s3_client.get_bucket_replication("bucket-repl")

    assert config == {
        "Role": "arn:aws:iam::123456789012:role/replication",
        "Rules": [{"ID": "rule-1"}],
    }


def test_get_bucket_replication_returns_empty_when_missing(monkeypatch):
    class MissingReplicationClient:
        def get_bucket_replication(self, **kwargs):
            raise ClientError(
                {"Error": {"Code": "ReplicationConfigurationNotFoundError", "Message": "not found"}},
                "GetBucketReplication",
            )

    monkeypatch.setattr(s3_client, "get_s3_client", lambda *args, **kwargs: MissingReplicationClient())

    config = s3_client.get_bucket_replication("bucket-repl")

    assert config == {}


def test_put_bucket_replication_sends_configuration(monkeypatch):
    class FakeReplicationClient:
        def __init__(self):
            self.calls = []

        def put_bucket_replication(self, **kwargs):
            self.calls.append(kwargs)

    fake_client = FakeReplicationClient()
    monkeypatch.setattr(s3_client, "get_s3_client", lambda *args, **kwargs: fake_client)

    configuration = {
        "Role": "arn:aws:iam::123456789012:role/replication",
        "Rules": [{"ID": "rule-1", "Status": "Enabled", "Destination": {"Bucket": "arn:aws:s3:::target"}}],
    }
    s3_client.put_bucket_replication("bucket-repl", configuration=configuration)

    assert fake_client.calls == [{"Bucket": "bucket-repl", "ReplicationConfiguration": configuration}]


def test_put_bucket_replication_maps_param_validation_to_value_error(monkeypatch):
    class InvalidReplicationClient:
        def put_bucket_replication(self, **kwargs):
            raise ParamValidationError(report="bad payload")

    monkeypatch.setattr(s3_client, "get_s3_client", lambda *args, **kwargs: InvalidReplicationClient())

    try:
        s3_client.put_bucket_replication("bucket-repl", configuration={"Rules": []})
    except ValueError as exc:
        assert "Invalid bucket replication configuration" in str(exc)
    else:
        raise AssertionError("Expected ValueError")


def test_delete_bucket_replication_is_idempotent_when_missing(monkeypatch):
    class MissingReplicationClient:
        def delete_bucket_replication(self, **kwargs):
            raise ClientError(
                {"Error": {"Code": "ReplicationConfigurationNotFoundError", "Message": "not found"}},
                "DeleteBucketReplication",
            )

    monkeypatch.setattr(s3_client, "get_s3_client", lambda *args, **kwargs: MissingReplicationClient())

    s3_client.delete_bucket_replication("bucket-repl")


def test_delete_objects_falls_back_to_individual_delete_on_invalid_xml_response():
    class InvalidXmlDeleteClient:
        def __init__(self):
            self.batch_calls = []
            self.single_calls = []

        def delete_objects(self, **kwargs):
            self.batch_calls.append(kwargs)
            raise ResponseParserError("Unable to parse response, invalid XML received")

        def delete_object(self, **kwargs):
            self.single_calls.append(kwargs)
            return {}

    client = InvalidXmlDeleteClient()

    deleted = s3_client._delete_objects_count(
        client,
        "bucket-delete",
        [
            {"Key": "a.txt"},
            {"Key": "b.txt", "VersionId": "ver-1"},
        ],
    )

    assert deleted == 2
    assert len(client.batch_calls) == 1
    assert client.single_calls == [
        {"Bucket": "bucket-delete", "Key": "a.txt"},
        {"Bucket": "bucket-delete", "Key": "b.txt", "VersionId": "ver-1"},
    ]


def test_delete_objects_fallback_tolerates_missing_version_after_ambiguous_batch_delete():
    class PartialDeleteClient:
        def __init__(self):
            self.single_calls = []

        def delete_objects(self, **kwargs):
            raise ResponseParserError("Unable to parse response, invalid XML received")

        def delete_object(self, **kwargs):
            self.single_calls.append(kwargs)
            if kwargs.get("VersionId") == "gone-version":
                raise ClientError(
                    {"Error": {"Code": "NoSuchVersion", "Message": "missing"}},
                    "DeleteObject",
                )
            return {}

    client = PartialDeleteClient()

    deleted = s3_client._delete_objects_count(
        client,
        "bucket-delete",
        [
            {"Key": "versioned.txt", "VersionId": "gone-version"},
            {"Key": "other.txt", "VersionId": "live-version"},
        ],
    )

    assert deleted == 2
    assert client.single_calls == [
        {"Bucket": "bucket-delete", "Key": "versioned.txt", "VersionId": "gone-version"},
        {"Bucket": "bucket-delete", "Key": "other.txt", "VersionId": "live-version"},
    ]


def test_purge_bucket_contents_deletes_current_objects_versions_and_delete_markers_in_parallel_batches(monkeypatch):
    created_workers: list[int] = []

    class RecordingExecutor(ThreadPoolExecutor):
        def __init__(self, *args, **kwargs):
            created_workers.append(kwargs.get("max_workers", args[0] if args else None))
            super().__init__(*args, **kwargs)

    class PurgeClient:
        def __init__(self):
            self.object_pages = [
                {
                    "Contents": [{"Key": f"object-{idx:04d}"} for idx in range(1000)],
                    "NextContinuationToken": "page-2",
                },
                {"Contents": [{"Key": "object-1000"}]},
            ]
            self.version_pages = [
                {
                    "Versions": [{"Key": f"version-{idx:04d}", "VersionId": f"v{idx}"} for idx in range(1001)],
                    "DeleteMarkers": [{"Key": "marker", "VersionId": "delete-marker"}],
                }
            ]
            self.delete_calls: list[list[dict]] = []

        def list_objects_v2(self, **kwargs):
            expected_token = None if len(self.object_pages) == 2 else "page-2"
            assert kwargs.get("ContinuationToken") == expected_token
            return self.object_pages.pop(0)

        def list_object_versions(self, **kwargs):
            assert kwargs["Bucket"] == "bucket-purge"
            return self.version_pages.pop(0)

        def delete_objects(self, **kwargs):
            objects = list(kwargs["Delete"]["Objects"])
            self.delete_calls.append(objects)
            return {"Deleted": objects}

    monkeypatch.setattr(s3_client, "ThreadPoolExecutor", RecordingExecutor)
    client = PurgeClient()
    progress_events = []

    result = s3_client.purge_bucket_contents(
        client,
        "bucket-purge",
        parallelism=999,
        include_versions=True,
        progress_callback=progress_events.append,
    )

    assert created_workers == [64]
    assert result.listed_objects == 1001
    assert result.deleted_objects == 1001
    assert result.listed_versions == 1002
    assert result.deleted_versions == 1002
    assert result.failed_count == 0
    assert sorted(len(call) for call in client.delete_calls) == [1, 2, 1000, 1000]
    assert {event.stage for event in progress_events} >= {"list", "delete", "versions", "completed"}


def test_purge_bucket_contents_can_delete_entries_individually_in_parallel(monkeypatch):
    class PurgeClient:
        def __init__(self):
            self.single_calls: list[dict] = []

        def list_objects_v2(self, **kwargs):
            return {"Contents": [{"Key": "current-a"}, {"Key": "current-b"}]}

        def list_object_versions(self, **kwargs):
            return {
                "Versions": [
                    {"Key": "versioned", "VersionId": "v1"},
                    {"Key": "versioned", "VersionId": "v2"},
                ],
                "DeleteMarkers": [{"Key": "deleted", "VersionId": "marker-1"}],
            }

        def delete_objects(self, **kwargs):
            raise AssertionError("DeleteObjects must not be used for individual purge mode")

        def delete_object(self, **kwargs):
            self.single_calls.append(kwargs)
            return {"ResponseMetadata": {"HTTPStatusCode": 204}}

    original_delete_individually = s3_client._delete_objects_individually
    submitted_chunk_sizes: list[int] = []

    def recording_delete_individually(client, bucket_name, chunk, **kwargs):
        submitted_chunk_sizes.append(len(chunk))
        return original_delete_individually(client, bucket_name, chunk, **kwargs)

    monkeypatch.setattr(s3_client, "_delete_objects_individually", recording_delete_individually)
    client = PurgeClient()

    result = s3_client.purge_bucket_contents(
        client,
        "bucket-purge",
        parallelism=3,
        include_versions=True,
        individual_deletes=True,
    )

    assert result.deleted_objects == 2
    assert result.deleted_versions == 3
    assert result.failed_count == 0
    assert submitted_chunk_sizes == [1, 1, 1, 1, 1]
    assert sorted((call["Key"], call.get("VersionId")) for call in client.single_calls) == [
        ("current-a", None),
        ("current-b", None),
        ("deleted", "marker-1"),
        ("versioned", "v1"),
        ("versioned", "v2"),
    ]


def test_count_bucket_purge_entries_stops_after_limit_without_deleting():
    class CountClient:
        def __init__(self):
            self.list_calls = 0
            self.version_calls = 0

        def list_objects_v2(self, **kwargs):
            self.list_calls += 1
            token = kwargs.get("ContinuationToken")
            expected_token = None if self.list_calls == 1 else f"page-{self.list_calls}"
            assert token == expected_token
            page = {"Contents": [{"Key": f"object-{self.list_calls}-{idx}"} for idx in range(1000)]}
            if self.list_calls < 11:
                page["NextContinuationToken"] = f"page-{self.list_calls + 1}"
            return page

        def list_object_versions(self, **kwargs):
            self.version_calls += 1
            return {"Versions": [{"Key": "versioned", "VersionId": "v1"}]}

        def delete_objects(self, **kwargs):  # pragma: no cover - must not be called
            raise AssertionError("counting must not delete objects")

    client = CountClient()
    progress_events = []

    result = s3_client.count_bucket_purge_entries(
        client,
        "bucket-purge",
        limit=10000,
        include_versions=True,
        progress_callback=progress_events.append,
    )

    assert result.exceeded_limit is True
    assert result.listed_objects == 10001
    assert result.listed_versions == 0
    assert client.list_calls == 11
    assert client.version_calls == 0
    assert {event.stage for event in progress_events} == {"list"}
