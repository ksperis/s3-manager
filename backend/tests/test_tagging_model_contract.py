# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import pytest
from pydantic import ValidationError

from app.models.s3_account import S3AccountCreate, S3AccountUpdate
from app.models.s3_connection import S3ConnectionCreate, S3ConnectionUpdate
from app.models.s3_connection_admin import (
    S3ConnectionAdminCreate,
    S3ConnectionAdminUpdate,
)
from app.models.s3_user import S3UserCreate, S3UserUpdate
from app.models.storage_endpoint import StorageEndpointTagsUpdate


REQUIRED_TAG_MODELS = [
    pytest.param(
        S3AccountCreate,
        {"name": "Account", "storage_endpoint_id": 1},
        id="account",
    ),
    pytest.param(
        S3ConnectionCreate,
        {
            "name": "Connection",
            "storage_endpoint_id": 1,
            "access_key_id": "access-key",
            "secret_access_key": "secret-key",
        },
        id="connection",
    ),
    pytest.param(
        S3ConnectionAdminCreate,
        {
            "name": "Admin connection",
            "storage_endpoint_id": 1,
            "access_key_id": "access-key",
            "secret_access_key": "secret-key",
        },
        id="admin-connection",
    ),
    pytest.param(
        S3UserCreate,
        {"name": "S3 user", "storage_endpoint_id": 1},
        id="s3-user",
    ),
    pytest.param(StorageEndpointTagsUpdate, {}, id="storage-endpoint"),
]

OPTIONAL_TAG_MODELS = [
    pytest.param(S3AccountUpdate, id="account"),
    pytest.param(S3ConnectionUpdate, id="connection"),
    pytest.param(S3ConnectionAdminUpdate, id="admin-connection"),
    pytest.param(S3UserUpdate, id="s3-user"),
]


@pytest.mark.parametrize(("model_type", "base_payload"), REQUIRED_TAG_MODELS)
def test_required_tag_models_share_canonical_normalization(model_type, base_payload):
    payload = {
        **base_payload,
        "tags": [
            " prod ",
            {"label": "PROD", "color_key": "red"},
            "",
            {
                "label": " ops ",
                "color_key": " BLUE ",
                "scope": " Administrative ",
            },
        ],
    }

    model = model_type.model_validate(payload)

    assert [tag.model_dump() for tag in model.tags] == [
        {"label": "prod", "color_key": "neutral", "scope": "standard"},
        {"label": "ops", "color_key": "blue", "scope": "administrative"},
    ]


@pytest.mark.parametrize(("model_type", "base_payload"), REQUIRED_TAG_MODELS)
def test_required_tag_models_normalize_explicit_null_to_empty_list(
    model_type,
    base_payload,
):
    model = model_type.model_validate({**base_payload, "tags": None})

    assert model.tags == []


@pytest.mark.parametrize("model_type", OPTIONAL_TAG_MODELS)
def test_optional_tag_models_preserve_explicit_null(model_type):
    model = model_type.model_validate({"tags": None})

    assert model.tags is None


@pytest.mark.parametrize("model_type", OPTIONAL_TAG_MODELS)
def test_optional_tag_models_normalize_present_lists(model_type):
    model = model_type.model_validate({"tags": [" prod ", "PROD", ""]})

    assert [tag.model_dump() for tag in model.tags or []] == [
        {"label": "prod", "color_key": "neutral", "scope": "standard"}
    ]


def test_shared_tag_type_rejects_non_list_payloads():
    with pytest.raises(ValidationError, match="tags must be a list of tag definitions"):
        S3UserCreate.model_validate(
            {
                "name": "S3 user",
                "storage_endpoint_id": 1,
                "tags": "prod",
            }
        )
