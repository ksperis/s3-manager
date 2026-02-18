# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from botocore.exceptions import ClientError

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
