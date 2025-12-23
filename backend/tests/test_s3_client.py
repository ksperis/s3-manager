# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.services import s3_client


class FakeS3PublicAccessClient:
    def __init__(self):
        self.put_calls = []
        self.delete_calls = []

    def put_public_access_block(self, **kwargs):
        self.put_calls.append(kwargs)

    def delete_public_access_block(self, **kwargs):
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
