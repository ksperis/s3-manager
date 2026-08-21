# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
from datetime import UTC, date, datetime

import pytest
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError

from app.db import (
    BillingAssignment,
    BillingRateCard,
    BillingStorageDaily,
    BillingUsageDaily,
    BucketUsageStatsSnapshot,
    EndpointHealthCheck,
    EndpointHealthLatest,
    EndpointHealthRollup,
    EndpointHealthStatusSegment,
    HealthCheckStatus,
    QuotaAlertState,
    QuotaUsageDaily,
    QuotaUsageHourly,
    S3Account,
    S3Connection,
    StorageEndpoint,
    StorageProvider,
    User,
    UserRole,
)
from app.models.storage_endpoint import (
    StorageEndpointFeatureDetectionRequest,
    StorageEndpointCreate,
    StorageEndpointTagsUpdate,
    StorageEndpointUpdate,
)
from app.services.rgw_admin import RGWAdminError
from app.services.storage_endpoints_service import StorageEndpointsService
from app.utils.storage_endpoint_features import (
    AWS_DEFAULT_REGION,
    AWS_IAM_ENDPOINT,
    AWS_S3_ENDPOINT,
    AWS_STS_ENDPOINT,
    aws_iam_endpoint_for_region,
    aws_s3_endpoint_for_region,
    aws_sts_endpoint_for_region,
    normalize_features_config,
    resolve_feature_flags,
    resolve_iam_endpoint,
    resolve_sts_endpoint,
)
from app.utils.time import utcnow


def _create_ceph_endpoint(db_session, name: str = "ceph-main") -> StorageEndpoint:
    endpoint = StorageEndpoint(
        name=name,
        endpoint_url=f"https://{name}.example.test",
        provider=StorageProvider.CEPH.value,
        admin_access_key="AKIA-ADMIN",
        admin_secret_key="SECRET-ADMIN",
        features_config="features:\n  admin:\n    enabled: true\n",
        is_default=True,
        is_editable=True,
    )
    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)
    return endpoint


def _create_ceph_endpoint_with_full_credentials(db_session, name: str = "ceph-full-creds") -> StorageEndpoint:
    endpoint = StorageEndpoint(
        name=name,
        endpoint_url=f"https://{name}.example.test",
        provider=StorageProvider.CEPH.value,
        admin_access_key="AKIA-ADMIN",
        admin_secret_key="SECRET-ADMIN",
        supervision_access_key="AKIA-SUPERVISION",
        supervision_secret_key="SECRET-SUPERVISION",
        ceph_admin_access_key="AKIA-CEPH-ADMIN",
        ceph_admin_secret_key="SECRET-CEPH-ADMIN",
        features_config=(
            "features:\n"
            "  admin:\n"
            "    enabled: true\n"
            "  usage:\n"
            "    enabled: true\n"
            "  metrics:\n"
            "    enabled: true\n"
        ),
        is_default=True,
        is_editable=True,
    )
    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)
    return endpoint


def test_list_endpoints_skips_admin_ops_permissions_by_default(db_session, monkeypatch):
    _create_ceph_endpoint(db_session)
    calls = {"count": 0}

    class FakeRGWClient:
        def get_user_by_access_key(self, access_key: str, allow_not_found: bool = False):
            calls["count"] += 1
            assert access_key == "AKIA-ADMIN"
            return {
                "caps": [
                    {"type": "users", "perm": "read,write"},
                    {"type": "accounts", "perm": "read,write"},
                ]
            }

    monkeypatch.setattr(
        "app.services.storage_endpoints_service.get_rgw_admin_client",
        lambda **kwargs: FakeRGWClient(),
    )

    service = StorageEndpointsService(db_session)
    endpoints = service.list_endpoints()
    target = next((endpoint for endpoint in endpoints if endpoint.name == "ceph-main"), None)
    assert target is not None
    assert calls["count"] == 0
    perms = target.admin_ops_permissions
    assert perms.users_read is False
    assert perms.users_write is False
    assert perms.accounts_read is False
    assert perms.accounts_write is False


def test_list_endpoints_orders_by_name_case_insensitive(db_session):
    db_session.add_all(
        [
            StorageEndpoint(
                name="Zulu",
                endpoint_url="https://zulu.example.test",
                provider=StorageProvider.CEPH.value,
                is_default=True,
                is_editable=True,
            ),
            StorageEndpoint(
                name="alpha",
                endpoint_url="https://alpha.example.test",
                provider=StorageProvider.CEPH.value,
                is_default=False,
                is_editable=True,
            ),
            StorageEndpoint(
                name="Beta",
                endpoint_url="https://beta.example.test",
                provider=StorageProvider.CEPH.value,
                is_default=False,
                is_editable=True,
            ),
        ]
    )
    db_session.commit()

    service = StorageEndpointsService(db_session)
    endpoints = service.list_endpoints()

    assert [endpoint.name for endpoint in endpoints] == ["alpha", "Beta", "Zulu"]
    assert endpoints[0].is_default is False


def test_aws_endpoint_defaults_enable_supported_aws_features_and_clear_ceph_credentials(db_session):
    service = StorageEndpointsService(db_session)

    created = service.create_endpoint(
        StorageEndpointCreate(
            name="AWS Regional",
            endpoint_url=AWS_S3_ENDPOINT,
            provider=StorageProvider.AWS,
            admin_access_key="AKIA-ADMIN",
            admin_secret_key="SECRET-ADMIN",
            supervision_access_key="AKIA-SUPERVISION",
            supervision_secret_key="SECRET-SUPERVISION",
            ceph_admin_access_key="AKIA-CEPH-ADMIN",
            ceph_admin_secret_key="SECRET-CEPH-ADMIN",
        )
    )

    assert created.provider == StorageProvider.AWS
    assert created.region == AWS_DEFAULT_REGION
    assert created.admin_access_key is None
    assert created.supervision_access_key is None
    assert created.ceph_admin_access_key is None
    assert created.capabilities == {
        "admin": False,
        "account": False,
        "sts": True,
        "usage": False,
        "metrics": False,
        "static_website": True,
        "iam": True,
        "sns": False,
        "sse": True,
        "replication": False,
    }
    assert created.features.sts.enabled is True
    assert created.features.sts.endpoint == AWS_STS_ENDPOINT
    assert created.features.iam.enabled is True
    assert created.features.iam.endpoint == AWS_IAM_ENDPOINT

    persisted = db_session.query(StorageEndpoint).filter(StorageEndpoint.id == created.id).first()
    assert persisted is not None
    assert persisted.admin_secret_key is None
    assert persisted.supervision_secret_key is None
    assert persisted.ceph_admin_secret_key is None
    assert resolve_iam_endpoint(persisted) == AWS_IAM_ENDPOINT
    flags = resolve_feature_flags(persisted)
    assert flags.iam_enabled is True
    assert flags.iam_endpoint == AWS_IAM_ENDPOINT


def test_aws_endpoint_defaults_follow_selected_region(db_session):
    service = StorageEndpointsService(db_session)

    created = service.create_endpoint(
        StorageEndpointCreate(
            name="AWS Paris",
            endpoint_url=aws_s3_endpoint_for_region("eu-west-3"),
            provider=StorageProvider.AWS,
            region="eu-west-3",
        )
    )

    assert created.region == "eu-west-3"
    assert created.endpoint_url == "https://s3.eu-west-3.amazonaws.com"
    assert created.features.sts.enabled is True
    assert created.features.sts.endpoint == "https://sts.eu-west-3.amazonaws.com"
    assert created.features.iam.enabled is True
    assert created.features.iam.endpoint == AWS_IAM_ENDPOINT

    persisted = db_session.query(StorageEndpoint).filter(StorageEndpoint.id == created.id).first()
    assert persisted is not None
    assert resolve_sts_endpoint(persisted) == aws_sts_endpoint_for_region("eu-west-3")
    assert resolve_iam_endpoint(persisted) == aws_iam_endpoint_for_region("eu-west-3")


def test_create_update_and_serialize_endpoint_force_path_style(db_session):
    service = StorageEndpointsService(db_session)

    created = service.create_endpoint(
        StorageEndpointCreate(
            name="Path Style",
            endpoint_url="https://path-style.example.test",
            provider=StorageProvider.OTHER,
            force_path_style=True,
        )
    )

    assert created.force_path_style is True
    persisted = db_session.query(StorageEndpoint).filter(StorageEndpoint.id == created.id).first()
    assert persisted is not None
    assert persisted.force_path_style is True

    updated = service.update_endpoint(
        created.id,
        StorageEndpointUpdate(force_path_style=False),
    )

    assert updated.force_path_style is False
    db_session.refresh(persisted)
    assert persisted.force_path_style is False


def test_create_update_and_serialize_endpoint_coordinates(db_session):
    service = StorageEndpointsService(db_session)

    created = service.create_endpoint(
        StorageEndpointCreate(
            name="Geo Endpoint",
            endpoint_url="https://geo.example.test",
            provider=StorageProvider.OTHER,
            latitude=48.8566,
            longitude=2.3522,
        )
    )

    assert created.latitude == 48.8566
    assert created.longitude == 2.3522
    persisted = db_session.query(StorageEndpoint).filter(StorageEndpoint.id == created.id).first()
    assert persisted is not None
    assert persisted.latitude == 48.8566
    assert persisted.longitude == 2.3522

    updated = service.update_endpoint(
        created.id,
        StorageEndpointUpdate(latitude=None, longitude=-1.5536),
    )

    assert updated.latitude is None
    assert updated.longitude == -1.5536
    db_session.refresh(persisted)
    assert persisted.latitude is None
    assert persisted.longitude == -1.5536


def test_endpoint_coordinates_reject_invalid_ranges():
    with pytest.raises(ValidationError, match="Latitude must be a finite number between -90 and 90"):
        StorageEndpointCreate(
            name="Invalid Latitude",
            endpoint_url="https://invalid-lat.example.test",
            provider=StorageProvider.OTHER,
            latitude=91,
        )

    with pytest.raises(ValidationError, match="Longitude must be a finite number between -180 and 180"):
        StorageEndpointUpdate(longitude=-181)


def test_aws_endpoint_helpers_are_partition_aware():
    assert AWS_S3_ENDPOINT == aws_s3_endpoint_for_region(AWS_DEFAULT_REGION)
    assert AWS_STS_ENDPOINT == aws_sts_endpoint_for_region(AWS_DEFAULT_REGION)
    assert aws_s3_endpoint_for_region("cn-north-1") == "https://s3.cn-north-1.amazonaws.com.cn"
    assert aws_sts_endpoint_for_region("cn-north-1") == "https://sts.cn-north-1.amazonaws.com.cn"
    assert aws_iam_endpoint_for_region("cn-north-1") == "https://iam.cn-north-1.amazonaws.com.cn"
    assert aws_iam_endpoint_for_region("us-gov-west-1") == "https://iam.us-gov.amazonaws.com"


def test_replication_feature_defaults_to_disabled_and_can_be_enabled_for_ceph():
    default_features = normalize_features_config(StorageProvider.CEPH, None)
    assert default_features["replication"]["enabled"] is False

    enabled_features = normalize_features_config(
        StorageProvider.CEPH,
        "features:\n"
        "  replication:\n"
        "    enabled: true\n",
    )
    assert enabled_features["replication"]["enabled"] is True


def test_features_config_requires_canonical_account_and_healthcheck_keys():
    admin_only_features = normalize_features_config(
        StorageProvider.CEPH,
        "features:\n"
        "  admin:\n"
        "    enabled: true\n",
    )
    assert admin_only_features["admin"]["enabled"] is True
    assert admin_only_features["account"]["enabled"] is False

    legacy_healthcheck_features = normalize_features_config(
        StorageProvider.CEPH,
        "features:\n"
        "  healthcheck:\n"
        "    enabled: true\n"
        "    endpoint: https://health.example.test\n",
    )
    assert legacy_healthcheck_features["healthcheck"]["url"] is None


def test_aws_features_reject_ceph_only_capabilities():
    with pytest.raises(ValueError, match="only available for Ceph"):
        normalize_features_config(
            StorageProvider.AWS,
            "features:\n"
            "  admin:\n"
            "    enabled: true\n"
            "  sns:\n"
            "    enabled: true\n",
        )

    with pytest.raises(ValueError, match="Feature 'replication' is only available for Ceph"):
        normalize_features_config(
            StorageProvider.AWS,
            "features:\n"
            "  replication:\n"
            "    enabled: true\n",
        )


def test_get_endpoint_exposes_admin_ops_permissions_from_caps(db_session, monkeypatch):
    endpoint = _create_ceph_endpoint(db_session, name="ceph-main-detail")

    class FakeRGWClient:
        def get_user_by_access_key(self, access_key: str, allow_not_found: bool = False):
            assert access_key == "AKIA-ADMIN"
            return {
                "caps": [
                    {"type": "users", "perm": "read,write"},
                    {"type": "accounts", "perm": "read,write"},
                ]
            }

    monkeypatch.setattr(
        "app.services.storage_endpoints_service.get_rgw_admin_client",
        lambda **kwargs: FakeRGWClient(),
    )

    service = StorageEndpointsService(db_session)
    target = service.get_endpoint(endpoint.id)
    perms = target.admin_ops_permissions
    assert perms.users_read is True
    assert perms.users_write is True
    assert perms.accounts_read is True
    assert perms.accounts_write is True


def test_get_endpoint_falls_back_to_no_admin_ops_permissions_on_rgw_error(db_session, monkeypatch):
    _create_ceph_endpoint(db_session, name="ceph-failsafe")

    class FailingRGWClient:
        def get_user_by_access_key(self, access_key: str, allow_not_found: bool = False):
            raise RGWAdminError("boom")

    monkeypatch.setattr(
        "app.services.storage_endpoints_service.get_rgw_admin_client",
        lambda **kwargs: FailingRGWClient(),
    )

    service = StorageEndpointsService(db_session)
    endpoints = service.list_endpoints(include_admin_ops_permissions=True)
    target = next((endpoint for endpoint in endpoints if endpoint.name == "ceph-failsafe"), None)
    assert target is not None
    perms = target.admin_ops_permissions
    assert perms.users_read is False
    assert perms.users_write is False
    assert perms.accounts_read is False
    assert perms.accounts_write is False


def test_sync_env_endpoints_skips_admin_ops_permissions_resolution(db_session, monkeypatch):
    calls = {"count": 0}
    monkeypatch.setattr(
        "app.services.storage_endpoints_service.settings.env_storage_endpoints",
        json.dumps(
            [
                {
                    "name": "ceph-env",
                    "endpoint_url": "https://ceph-env.example.test",
                    "provider": "ceph",
                    "force_path_style": True,
                    "admin_access_key": "AKIA-ADMIN",
                    "admin_secret_key": "SECRET-ADMIN",
                    "features_config": "features:\n  admin:\n    enabled: true\n",
                    "latitude": 43.6047,
                    "longitude": 1.4442,
                    "is_default": True,
                }
            ]
        ),
        raising=False,
    )

    class FakeRGWClient:
        def get_user_by_access_key(self, access_key: str, allow_not_found: bool = False):
            calls["count"] += 1
            return {
                "caps": [
                    {"type": "users", "perm": "read,write"},
                    {"type": "accounts", "perm": "read,write"},
                ]
            }

    monkeypatch.setattr(
        "app.services.storage_endpoints_service.get_rgw_admin_client",
        lambda **kwargs: FakeRGWClient(),
    )

    service = StorageEndpointsService(db_session)
    synced = service.sync_env_endpoints()
    assert len(synced) == 1
    assert synced[0].force_path_style is True
    assert synced[0].latitude == 43.6047
    assert synced[0].longitude == 1.4442
    assert calls["count"] == 0


def test_environment_storage_endpoint_rejects_unknown_fields(db_session, monkeypatch):
    monkeypatch.setattr(
        "app.services.storage_endpoints_service.settings.env_storage_endpoints",
        json.dumps(
            [
                {
                    "name": "ceph-env",
                    "endpoint_url": "https://ceph-env.example.test",
                    "obsolete_field": True,
                }
            ]
        ),
        raising=False,
    )

    with pytest.raises(ValueError, match="Invalid ENV_STORAGE_ENDPOINTS entry at index 0") as exc_info:
        StorageEndpointsService(db_session).sync_env_endpoints()

    assert isinstance(exc_info.value.__cause__, ValidationError)
    assert "obsolete_field" in str(exc_info.value.__cause__)


def test_sync_env_endpoints_retries_after_concurrent_unique_conflict(db_session, monkeypatch):
    monkeypatch.setattr(
        "app.services.storage_endpoints_service.settings.env_storage_endpoints",
        json.dumps(
            [
                {
                    "name": "ceph-env",
                    "endpoint_url": "https://ceph-env.example.test",
                    "provider": "ceph",
                    "features_config": "features:\n  admin:\n    enabled: false\n",
                    "is_default": True,
                }
            ]
        ),
        raising=False,
    )
    calls = {"count": 0}
    original_commit = db_session.commit

    def flaky_commit():
        calls["count"] += 1
        if calls["count"] == 1:
            raise IntegrityError("insert storage_endpoints", {}, Exception("unique"))
        return original_commit()

    monkeypatch.setattr(db_session, "commit", flaky_commit)

    service = StorageEndpointsService(db_session)
    synced = service.sync_env_endpoints()

    assert len(synced) == 1
    assert synced[0].name == "ceph-env"
    assert db_session.query(StorageEndpoint).count() == 1
    assert calls["count"] == 2


def test_sync_env_endpoints_updates_in_place_and_uses_first_default(db_session, monkeypatch):
    existing = StorageEndpoint(
        name="old-env-name",
        endpoint_url="https://env-a.example.test",
        provider=StorageProvider.OTHER.value,
        is_default=False,
        is_editable=True,
    )
    previous_default = StorageEndpoint(
        name="database-default",
        endpoint_url="https://database-default.example.test",
        provider=StorageProvider.OTHER.value,
        is_default=True,
        is_editable=True,
    )
    db_session.add_all([existing, previous_default])
    db_session.commit()
    existing_id = existing.id

    monkeypatch.setattr(
        "app.services.storage_endpoints_service.settings.env_storage_endpoints",
        json.dumps(
            [
                {
                    "name": "env-a",
                    "endpoint_url": "https://env-a.example.test/",
                    "provider": "ceph",
                    "force_path_style": True,
                    "verify_tls": False,
                    "features_config": "features:\n  admin:\n    enabled: false\n",
                },
                {
                    "name": "env-b",
                    "endpoint_url": "https://env-b.example.test",
                    "provider": "other",
                },
            ]
        ),
        raising=False,
    )

    synced = StorageEndpointsService(db_session).sync_env_endpoints()

    assert [endpoint.name for endpoint in synced] == ["env-a", "env-b"]
    assert [endpoint.is_default for endpoint in synced] == [True, False]
    db_session.expire_all()
    updated = db_session.query(StorageEndpoint).filter(StorageEndpoint.id == existing_id).one()
    assert updated.name == "env-a"
    assert updated.force_path_style is True
    assert updated.verify_tls is False
    assert updated.is_editable is False
    assert previous_default.is_default is False


@pytest.mark.parametrize(
    ("entries", "message"),
    [
        (
            [
                {"name": "env-a", "endpoint_url": "https://same.example.test"},
                {"name": "env-b", "endpoint_url": "https://same.example.test/"},
            ],
            "duplicate endpoint_url",
        ),
        (
            [
                {"name": "same", "endpoint_url": "https://a.example.test"},
                {"name": "same", "endpoint_url": "https://b.example.test"},
            ],
            "duplicate name",
        ),
        (
            [
                {"name": "env-a", "endpoint_url": "https://a.example.test", "is_default": True},
                {"name": "env-b", "endpoint_url": "https://b.example.test", "is_default": True},
            ],
            "only define one default endpoint",
        ),
    ],
)
def test_sync_env_endpoints_rejects_ambiguous_inventory(
    db_session,
    monkeypatch,
    entries,
    message,
):
    monkeypatch.setattr(
        "app.services.storage_endpoints_service.settings.env_storage_endpoints",
        json.dumps(entries),
        raising=False,
    )

    with pytest.raises(ValueError, match=message):
        StorageEndpointsService(db_session).sync_env_endpoints()


def test_update_endpoint_clearing_access_keys_also_clears_secrets(db_session):
    endpoint = _create_ceph_endpoint_with_full_credentials(db_session)
    service = StorageEndpointsService(db_session)

    updated = service.update_endpoint(
        endpoint.id,
        StorageEndpointUpdate(
            admin_access_key=None,
            supervision_access_key=None,
            ceph_admin_access_key=None,
            features_config=(
                "features:\n"
                "  admin:\n"
                "    enabled: false\n"
                "  usage:\n"
                "    enabled: false\n"
                "  metrics:\n"
                "    enabled: false\n"
            ),
        ),
    )

    assert updated.admin_access_key is None
    assert updated.supervision_access_key is None
    assert updated.ceph_admin_access_key is None

    persisted = db_session.query(StorageEndpoint).filter(StorageEndpoint.id == endpoint.id).first()
    assert persisted is not None
    assert persisted.admin_access_key is None
    assert persisted.admin_secret_key is None
    assert persisted.supervision_access_key is None
    assert persisted.supervision_secret_key is None
    assert persisted.ceph_admin_access_key is None
    assert persisted.ceph_admin_secret_key is None


def test_update_endpoint_tags_normalizes_and_serializes_tags(db_session):
    endpoint = _create_ceph_endpoint(db_session, name="ceph-tags")
    service = StorageEndpointsService(db_session)

    updated = service.update_endpoint_tags(
        endpoint.id,
        StorageEndpointTagsUpdate(tags=["prod", "prod", "  rgw-a  ", ""]),
    )

    assert [tag.label for tag in updated.tags] == ["prod", "rgw-a"]
    assert [tag.color_key for tag in updated.tags] == ["neutral", "neutral"]
    db_session.expire_all()
    persisted = db_session.query(StorageEndpoint).filter(StorageEndpoint.id == endpoint.id).first()
    assert persisted is not None
    assert [
        tag.label for tag in service.tags.get_storage_endpoint_tags(persisted)
    ] == ["prod", "rgw-a"]


def test_detect_features_warns_when_usage_log_endpoint_is_unavailable(db_session, monkeypatch):
    class FakeRGWClient:
        def __init__(self, access_key: str):
            self.access_key = access_key
            self.account_api_supported = None

        def get_user_by_access_key(self, access_key: str, allow_not_found: bool = False):
            assert self.access_key == "AKIA-ADMIN"
            assert access_key == "AKIA-ADMIN"
            return {"user_id": "admin-user"}

        def get_all_buckets(self, with_stats: bool = False):
            assert self.access_key == "AKIA-SUPERVISION"
            assert with_stats is False
            return []

        def get_usage(self, show_entries: bool = False, show_summary: bool = False):
            assert self.access_key == "AKIA-SUPERVISION"
            assert show_entries is False
            assert show_summary is False
            return {"not_found": True}

        def get_account(
            self,
            account_id: str,
            allow_not_found: bool = False,
            allow_not_implemented: bool = False,
        ):
            assert self.access_key == "AKIA-ADMIN"
            assert account_id == "RGW00000000000000000"
            assert allow_not_found is True
            assert allow_not_implemented is True
            self.account_api_supported = True
            return None

    monkeypatch.setattr(
        "app.services.storage_endpoints_service.get_rgw_admin_client",
        lambda **kwargs: FakeRGWClient(kwargs["access_key"]),
    )

    service = StorageEndpointsService(db_session)
    result = service.detect_features(
        StorageEndpointFeatureDetectionRequest(
            endpoint_url="https://ceph.example.test",
            admin_access_key="AKIA-ADMIN",
            admin_secret_key="SECRET-ADMIN",
            supervision_access_key="AKIA-SUPERVISION",
            supervision_secret_key="SECRET-SUPERVISION",
        )
    )

    assert result.admin is True
    assert result.account is True
    assert result.metrics is True
    assert result.usage is False
    assert result.usage_error == "RGW usage logs endpoint is unavailable."
    assert len(result.warnings) == 1
    assert "Usage logs do not appear enabled" in result.warnings[0]


def test_detect_features_reports_incomplete_credential_pairs(db_session, monkeypatch):
    monkeypatch.setattr(
        "app.services.storage_endpoints_service.get_rgw_admin_client",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("Incomplete credentials must not be used")),
    )

    result = StorageEndpointsService(db_session).detect_features(
        StorageEndpointFeatureDetectionRequest(
            endpoint_url="https://ceph.example.test",
            admin_access_key="AKIA-ADMIN",
            supervision_secret_key="SECRET-SUPERVISION",
        )
    )

    assert result.admin is False
    assert result.admin_error == "Admin detection requires both access key and secret key."
    assert result.account is False
    assert result.metrics is False
    assert result.usage is False
    assert result.metrics_error == "Supervision detection requires both access key and secret key."
    assert result.usage_error == result.metrics_error


def test_detect_features_keeps_account_and_usage_probes_independent(db_session, monkeypatch):
    class FakeRGWClient:
        def __init__(self, access_key: str):
            self.access_key = access_key
            self.account_api_supported = None

        def get_user_by_access_key(self, *_args, **_kwargs):
            raise RGWAdminError("admin probe failed")

        def get_account(self, *_args, **_kwargs):
            self.account_api_supported = True

        def get_all_buckets(self, **_kwargs):
            raise RGWAdminError("metrics probe failed")

        def get_usage(self, **_kwargs):
            return {"entries": [], "summary": []}

    monkeypatch.setattr(
        "app.services.storage_endpoints_service.get_rgw_admin_client",
        lambda **kwargs: FakeRGWClient(kwargs["access_key"]),
    )

    result = StorageEndpointsService(db_session).detect_features(
        StorageEndpointFeatureDetectionRequest(
            endpoint_url="https://ceph.example.test",
            admin_access_key="AKIA-ADMIN",
            admin_secret_key="SECRET-ADMIN",
            supervision_access_key="AKIA-SUPERVISION",
            supervision_secret_key="SECRET-SUPERVISION",
        )
    )

    assert result.admin is False
    assert result.admin_error == "admin probe failed"
    assert result.account is True
    assert result.account_error is None
    assert result.metrics is False
    assert result.metrics_error == "metrics probe failed"
    assert result.usage is True
    assert result.usage_error is None
    assert result.warnings == []


def test_delete_endpoint_blocks_when_references_exist(db_session):
    endpoint = _create_ceph_endpoint(db_session, name="ceph-delete-blocked")
    creator = User(
        email="endpoint-block-creator@example.com",
        hashed_password="x",
        role=UserRole.UI_USER.value,
        is_active=True,
    )
    db_session.add(creator)
    db_session.flush()
    db_session.add(
        S3Connection(
            name="linked-conn",
            created_by_user_id=creator.id,
            storage_endpoint_id=endpoint.id,
            access_key_id="AKIA-LINKED",
            secret_access_key="SECRET-LINKED",
        )
    )
    db_session.commit()

    service = StorageEndpointsService(db_session)
    try:
        service.delete_endpoint(endpoint.id)
        assert False, "delete_endpoint should have raised when references exist"
    except ValueError as exc:
        assert "Unable to delete this endpoint" in str(exc)


def test_delete_endpoint_purges_derived_database_rows(db_session):
    endpoint = _create_ceph_endpoint(db_session, name="ceph-delete-health-cascade")
    account_endpoint = _create_ceph_endpoint(db_session, name="ceph-account-history")
    history_account = S3Account(
        name="endpoint-history-account",
        rgw_account_id="RGW-ENDPOINT-HISTORY",
        rgw_user_uid="rgw-endpoint-history-admin",
        storage_endpoint_id=account_endpoint.id,
    )
    db_session.add(history_account)
    db_session.flush()
    rate_card = BillingRateCard(
        name="endpoint-delete-rate",
        currency="EUR",
        effective_from=date(2026, 1, 1),
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(rate_card)
    db_session.flush()
    now = utcnow()
    db_session.add_all(
        [
            BillingAssignment(
                storage_endpoint_id=endpoint.id,
                s3_account_id=history_account.id,
                rate_card_id=rate_card.id,
            ),
            BillingUsageDaily(
                day=date(2026, 1, 1),
                storage_endpoint_id=endpoint.id,
                s3_account_id=history_account.id,
                source="rgw_admin_usage",
            ),
            BillingStorageDaily(
                day=date(2026, 1, 1),
                storage_endpoint_id=endpoint.id,
                s3_account_id=history_account.id,
                source="rgw_admin_bucket_stats",
            ),
            QuotaUsageHourly(
                hour_ts=datetime(2026, 1, 1, 8, 0, 0, tzinfo=UTC),
                storage_endpoint_id=endpoint.id,
                s3_account_id=history_account.id,
                used_bytes=1,
                used_objects=1,
            ),
            QuotaUsageDaily(
                day=date(2026, 1, 1),
                storage_endpoint_id=endpoint.id,
                s3_account_id=history_account.id,
                last_used_bytes=1,
                last_used_objects=1,
            ),
            QuotaAlertState(
                storage_endpoint_id=endpoint.id,
                s3_account_id=history_account.id,
            ),
            BucketUsageStatsSnapshot(
                scope_kind="admin_managed",
                scope_id=str(endpoint.id),
                scope_name=endpoint.name,
                bucket_name="admin-managed-bucket",
                data_type_distribution_json="[]",
                storage_class_distribution_json="[]",
                size_distribution_json="[]",
                age_distribution_json="[]",
                current_noncurrent_distribution_json="[]",
            ),
            BucketUsageStatsSnapshot(
                scope_kind="ceph_admin",
                scope_id=str(endpoint.id),
                scope_name=endpoint.name,
                bucket_name="ceph-admin-bucket",
                data_type_distribution_json="[]",
                storage_class_distribution_json="[]",
                size_distribution_json="[]",
                age_distribution_json="[]",
                current_noncurrent_distribution_json="[]",
            ),
            EndpointHealthCheck(
                storage_endpoint_id=endpoint.id,
                checked_at=now,
                http_status=200,
                latency_ms=12,
                check_mode="http",
                status=HealthCheckStatus.UP.value,
            ),
            EndpointHealthLatest(
                storage_endpoint_id=endpoint.id,
                checked_at=now,
                check_mode="http",
                check_type="availability",
                scope="endpoint",
                status=HealthCheckStatus.UP.value,
            ),
            EndpointHealthStatusSegment(
                storage_endpoint_id=endpoint.id,
                check_mode="http",
                check_type="availability",
                scope="endpoint",
                status=HealthCheckStatus.UP.value,
                started_at=now,
            ),
            EndpointHealthRollup(
                storage_endpoint_id=endpoint.id,
                check_mode="http",
                check_type="availability",
                scope="endpoint",
                resolution_seconds=300,
                bucket_start=now,
                up_count=1,
            ),
        ]
    )
    db_session.commit()

    service = StorageEndpointsService(db_session)
    service.delete_endpoint(endpoint.id)

    assert db_session.query(StorageEndpoint).filter(StorageEndpoint.id == endpoint.id).count() == 0
    assert db_session.query(BillingAssignment).filter(BillingAssignment.storage_endpoint_id == endpoint.id).count() == 0
    assert db_session.query(BillingUsageDaily).filter(BillingUsageDaily.storage_endpoint_id == endpoint.id).count() == 0
    assert (
        db_session.query(BillingStorageDaily)
        .filter(BillingStorageDaily.storage_endpoint_id == endpoint.id)
        .count()
        == 0
    )
    assert db_session.query(BillingRateCard).filter(BillingRateCard.storage_endpoint_id == endpoint.id).count() == 0
    assert db_session.query(QuotaUsageHourly).filter(QuotaUsageHourly.storage_endpoint_id == endpoint.id).count() == 0
    assert db_session.query(QuotaUsageDaily).filter(QuotaUsageDaily.storage_endpoint_id == endpoint.id).count() == 0
    assert db_session.query(QuotaAlertState).filter(QuotaAlertState.storage_endpoint_id == endpoint.id).count() == 0
    assert (
        db_session.query(BucketUsageStatsSnapshot)
        .filter(
            BucketUsageStatsSnapshot.scope_kind.in_(("admin_managed", "ceph_admin")),
            BucketUsageStatsSnapshot.scope_id == str(endpoint.id),
        )
        .count()
        == 0
    )
    assert (
        db_session.query(EndpointHealthCheck)
        .filter(EndpointHealthCheck.storage_endpoint_id == endpoint.id)
        .count()
        == 0
    )
    assert (
        db_session.query(EndpointHealthLatest)
        .filter(EndpointHealthLatest.storage_endpoint_id == endpoint.id)
        .count()
        == 0
    )
    assert (
        db_session.query(EndpointHealthStatusSegment)
        .filter(EndpointHealthStatusSegment.storage_endpoint_id == endpoint.id)
        .count()
        == 0
    )
    assert (
        db_session.query(EndpointHealthRollup)
        .filter(EndpointHealthRollup.storage_endpoint_id == endpoint.id)
        .count()
        == 0
    )


def test_detect_features_reuses_stored_secrets_in_edit_mode(db_session, monkeypatch):
    endpoint = _create_ceph_endpoint_with_full_credentials(db_session, name="ceph-edit-detect")
    endpoint.verify_tls = False
    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)

    class FakeRGWClient:
        def __init__(self, access_key: str):
            self.access_key = access_key
            self.account_api_supported = None

        def get_user_by_access_key(self, access_key: str, allow_not_found: bool = False):
            assert self.access_key == endpoint.admin_access_key
            assert access_key == endpoint.admin_access_key
            return {"user_id": "admin-user"}

        def get_all_buckets(self, with_stats: bool = False):
            assert self.access_key == endpoint.supervision_access_key
            assert with_stats is False
            return []

        def get_usage(self, show_entries: bool = False, show_summary: bool = False):
            assert self.access_key == endpoint.supervision_access_key
            assert show_entries is False
            assert show_summary is False
            return {"entries": [], "summary": []}

        def get_account(
            self,
            account_id: str,
            allow_not_found: bool = False,
            allow_not_implemented: bool = False,
        ):
            assert self.access_key == endpoint.admin_access_key
            assert account_id == "RGW00000000000000000"
            assert allow_not_found is True
            assert allow_not_implemented is True
            self.account_api_supported = True
            return {"id": "RGW00000000000000001"}

    def _fake_get_rgw_admin_client(**kwargs):
        if kwargs["access_key"] == endpoint.admin_access_key:
            assert kwargs["secret_key"] == endpoint.admin_secret_key
        if kwargs["access_key"] == endpoint.supervision_access_key:
            assert kwargs["secret_key"] == endpoint.supervision_secret_key
        assert kwargs["verify_tls"] is False
        return FakeRGWClient(kwargs["access_key"])

    monkeypatch.setattr(
        "app.services.storage_endpoints_service.get_rgw_admin_client",
        _fake_get_rgw_admin_client,
    )

    service = StorageEndpointsService(db_session)
    result = service.detect_features(
        StorageEndpointFeatureDetectionRequest(
            endpoint_id=endpoint.id,
            endpoint_url=endpoint.endpoint_url,
            admin_access_key=endpoint.admin_access_key,
            supervision_access_key=endpoint.supervision_access_key,
        )
    )

    assert result.admin is True
    assert result.account is True
    assert result.metrics is True
    assert result.usage is True
    assert result.admin_error is None
    assert result.metrics_error is None
    assert result.usage_error is None
