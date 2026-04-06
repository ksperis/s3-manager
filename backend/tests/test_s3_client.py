# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from botocore.exceptions import ClientError, ParamValidationError
from botocore.parsers import ResponseParserError

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
