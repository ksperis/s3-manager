# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import re

import pytest
from pydantic import ValidationError

from app.models.admin_automation import (
    AccountLinkAccountRef,
    AccountLinkUserRef,
    ExternalIdentityUserRef,
    S3AccountMatch,
    S3AccountSpec,
    S3ConnectionMatch,
    S3ConnectionSpec,
    S3UserMatch,
    S3UserSpec,
    StorageEndpointMatch,
    UiUserMatch,
)


EXACTLY_ONE_REFERENCE_MODELS = [
    pytest.param(
        StorageEndpointMatch,
        {"endpoint_url": "https://s3.example.test"},
        {"id": 1, "name": "Primary"},
        "storage_endpoints.match requires exactly one of id, name, or endpoint_url",
        id="storage-endpoint",
    ),
    pytest.param(
        UiUserMatch,
        {"email": "user@example.com"},
        {"id": 1, "email": "user@example.com"},
        "ui_users.match requires exactly one of id or email",
        id="ui-user",
    ),
    pytest.param(
        ExternalIdentityUserRef,
        {"id": 1},
        {"id": 1, "email": "user@example.com"},
        "external_identities.user requires exactly one of id or email",
        id="external-identity-user",
    ),
    pytest.param(
        S3AccountMatch,
        {"rgw_account_id": "RGW00000000000000001"},
        {"id": 1, "name": "Account"},
        "s3_accounts.match requires exactly one of id, name, or rgw_account_id",
        id="s3-account",
    ),
    pytest.param(
        S3UserMatch,
        {"uid": "tenant$user"},
        {"id": 1, "uid": "tenant$user"},
        "s3_users.match requires exactly one of id or uid",
        id="s3-user",
    ),
    pytest.param(
        S3ConnectionMatch,
        {"name": "Connection"},
        {"id": 1, "name": "Connection"},
        "s3_connections.match requires exactly one of id or name",
        id="s3-connection",
    ),
    pytest.param(
        AccountLinkUserRef,
        {"email": "user@example.com"},
        {"id": 1, "email": "user@example.com"},
        "account_links.user requires exactly one of id or email",
        id="account-link-user",
    ),
    pytest.param(
        AccountLinkAccountRef,
        {"name": "Account"},
        {"id": 1, "rgw_account_id": "RGW00000000000000001"},
        "account_links.account requires exactly one of id, name, or rgw_account_id",
        id="account-link-account",
    ),
]

AT_MOST_ONE_REFERENCE_MODELS = [
    pytest.param(
        S3AccountSpec,
        {"storage_endpoint_name": "Primary"},
        {"storage_endpoint_id": 1, "storage_endpoint_name": "Primary"},
        "s3_accounts.spec accepts only one storage endpoint reference",
        id="s3-account",
    ),
    pytest.param(
        S3UserSpec,
        {"storage_endpoint_url": "https://s3.example.test"},
        {"storage_endpoint_name": "Primary", "storage_endpoint_url": "https://s3.example.test"},
        "s3_users.spec accepts only one storage endpoint reference",
        id="s3-user",
    ),
    pytest.param(
        S3ConnectionSpec,
        {"storage_endpoint_id": 1},
        {"storage_endpoint_id": 1, "endpoint_url": "https://s3.example.test"},
        "s3_connections.spec accepts only one endpoint reference",
        id="s3-connection",
    ),
]


@pytest.mark.parametrize(
    ("model_type", "single_payload", "multiple_payload", "message"),
    EXACTLY_ONE_REFERENCE_MODELS,
)
def test_exactly_one_reference_models_share_validation(
    model_type,
    single_payload,
    multiple_payload,
    message,
):
    assert model_type.model_validate(single_payload)

    with pytest.raises(ValidationError, match=re.escape(message)):
        model_type.model_validate({})
    with pytest.raises(ValidationError, match=re.escape(message)):
        model_type.model_validate(multiple_payload)


@pytest.mark.parametrize(
    ("model_type", "single_payload", "multiple_payload", "message"),
    AT_MOST_ONE_REFERENCE_MODELS,
)
def test_at_most_one_reference_models_share_validation(
    model_type,
    single_payload,
    multiple_payload,
    message,
):
    assert model_type.model_validate({})
    assert model_type.model_validate(single_payload)

    with pytest.raises(ValidationError, match=re.escape(message)):
        model_type.model_validate(multiple_payload)
