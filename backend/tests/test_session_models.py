# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest

from app.models.session import S3KeyLogin, SessionCapabilities


@pytest.mark.parametrize(
    "model",
    [
        S3KeyLogin(access_key="access", secret_key="secret", endpoint_url=" https://s3.example.test/// "),
        SessionCapabilities(endpoint_url=" https://s3.example.test/// "),
    ],
)
def test_session_models_share_canonical_endpoint_normalization(model):
    assert model.endpoint_url == "https://s3.example.test"
