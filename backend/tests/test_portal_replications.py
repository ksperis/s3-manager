# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.db import AccountRole, PortalStorageSpaceMetadata, S3Account, StorageEndpoint, StorageProvider, User, UserRole
from app.models.bucket import BucketReplicationConfiguration
from app.models.portal import PortalReplicationCreate
from app.routers.dependencies import AccountAccess, AccountCapabilities
from app.services.portal.replications import PortalReplicationAccountContext
from app.services.portal_service import PortalService


def _endpoint(db_session, *, name: str, zonegroup: str, bucket_allowed: bool = True, global_configured: bool = False):
    endpoint = StorageEndpoint(
        name=name,
        endpoint_url=f"https://{name}.example.test",
        provider=StorageProvider.CEPH.value,
        ceph_zonegroup_name=zonegroup,
        ceph_zonegroup_bucket_replication_allowed=bucket_allowed,
        ceph_zonegroup_global_replication_configured=global_configured,
        features_config=(
            "features:\n"
            "  iam:\n"
            "    enabled: true\n"
            "  replication:\n"
            "    enabled: true\n"
        ),
    )
    db_session.add(endpoint)
    db_session.flush()
    return endpoint


def _account(db_session, *, name: str, endpoint: StorageEndpoint):
    account = S3Account(
        name=name,
        rgw_account_id=f"rgw-{name}",
        rgw_access_key=f"AK-{name}",
        rgw_secret_key="SECRET",
        storage_endpoint=endpoint,
    )
    db_session.add(account)
    db_session.flush()
    return account


def _user(db_session):
    user = User(email="portal-replication@example.test", hashed_password="x", role=UserRole.UI_USER.value, is_active=True)
    db_session.add(user)
    db_session.flush()
    return user


def _metadata(db_session, *, account: S3Account, bucket_name: str, display_name: str):
    db_session.add(
        PortalStorageSpaceMetadata(
            account_id=account.id,
            bucket_name=bucket_name,
            display_name=display_name,
            visibility="private",
        )
    )
    db_session.flush()


def _access(account: S3Account, user: User) -> AccountAccess:
    return AccountAccess(
        account=account,
        actor=user,
        membership=None,
        role=AccountRole.PORTAL_MANAGER.value,
        capabilities=AccountCapabilities(
            can_manage_buckets=True,
            can_manage_portal_users=True,
            can_manage_iam=False,
            can_view_root_key=False,
            using_root_key=False,
        ),
    )


class _BucketService:
    def __init__(self):
        self.versioning_calls: list[tuple[str, int, bool]] = []
        self.replication_calls: list[tuple[str, int, dict]] = []
        self.replication_by_bucket: dict[str, dict] = {}

    def get_bucket_replication(self, name: str, account: S3Account):
        return BucketReplicationConfiguration(configuration=self.replication_by_bucket.get(name, {}))

    def set_versioning(self, name: str, account: S3Account, enabled: bool):
        self.versioning_calls.append((name, account.id, enabled))

    def set_bucket_replication(self, name: str, account: S3Account, payload: BucketReplicationConfiguration):
        self.replication_calls.append((name, account.id, payload.configuration))
        self.replication_by_bucket[name] = payload.configuration
        return payload


def test_portal_replications_show_global_storage_pair(db_session):
    user = _user(db_session)
    endpoint_z1 = _endpoint(db_session, name="s3-z1", zonegroup="zg-lab", global_configured=True)
    endpoint_z2 = _endpoint(db_session, name="s3-z2", zonegroup="zg-lab", global_configured=True)
    account_z1 = _account(db_session, name="project-z1", endpoint=endpoint_z1)
    account_z2 = _account(db_session, name="project-z2", endpoint=endpoint_z2)
    _metadata(db_session, account=account_z1, bucket_name="research", display_name="Research")
    _metadata(db_session, account=account_z2, bucket_name="research", display_name="Research")
    db_session.commit()

    service = PortalService(db_session)
    payload = service.list_replications(
        user,
        [
            PortalReplicationAccountContext(access=_access(account_z1, user), label="Paris"),
            PortalReplicationAccountContext(access=_access(account_z2, user), label="Lyon"),
        ],
        bucket_service=_BucketService(),
    )

    assert payload.can_create is True
    assert [(space.id, space.project_account_label, space.storage_endpoint_zonegroup) for space in payload.storage_spaces] == [
        (f"a{account_z1.id}:research", "Paris", "zg-lab"),
        (f"a{account_z2.id}:research", "Lyon", "zg-lab"),
    ]
    assert [(item.mode, item.source.project_account_label, item.target.project_account_label, item.zonegroup) for item in payload.replications] == [
        ("global", "Paris", "Lyon", "zg-lab"),
    ]


def test_portal_create_bucket_level_replication_automates_versioning_and_rule(db_session):
    user = _user(db_session)
    endpoint_z1 = _endpoint(db_session, name="s3-z1", zonegroup="zg-lab")
    endpoint_z2 = _endpoint(db_session, name="s3-z2", zonegroup="zg-lab")
    account_z1 = _account(db_session, name="project-z1", endpoint=endpoint_z1)
    account_z2 = _account(db_session, name="project-z2", endpoint=endpoint_z2)
    _metadata(db_session, account=account_z1, bucket_name="research-source", display_name="Source")
    _metadata(db_session, account=account_z2, bucket_name="research-target", display_name="Target")
    db_session.commit()

    bucket_service = _BucketService()
    service = PortalService(db_session)

    replication = service.create_replication(
        user,
        [
            PortalReplicationAccountContext(access=_access(account_z1, user), label="Paris"),
            PortalReplicationAccountContext(access=_access(account_z2, user), label="Lyon"),
        ],
        PortalReplicationCreate(
            source_storage_space_id=f"a{account_z1.id}:research-source",
            target_storage_space_id=f"a{account_z2.id}:research-target",
        ),
        bucket_service=bucket_service,
    )

    assert bucket_service.versioning_calls == [
        ("research-source", account_z1.id, True),
        ("research-target", account_z2.id, True),
    ]
    assert len(bucket_service.replication_calls) == 1
    source_bucket, source_account_id, configuration = bucket_service.replication_calls[0]
    assert (source_bucket, source_account_id) == ("research-source", account_z1.id)
    assert configuration["Rules"][0]["Destination"] == {"Bucket": "arn:aws:s3:::research-target"}
    assert configuration["Rules"][0]["Status"] == "Enabled"
    assert replication.mode == "bucket_level"
    assert replication.source.project_account_label == "Paris"
    assert replication.target is not None
    assert replication.target.project_account_label == "Lyon"


def test_portal_create_bucket_level_replication_preserves_existing_rules(db_session):
    user = _user(db_session)
    endpoint_z1 = _endpoint(db_session, name="s3-z1", zonegroup="zg-lab")
    endpoint_z2 = _endpoint(db_session, name="s3-z2", zonegroup="zg-lab")
    account_z1 = _account(db_session, name="project-z1", endpoint=endpoint_z1)
    account_z2 = _account(db_session, name="project-z2", endpoint=endpoint_z2)
    _metadata(db_session, account=account_z1, bucket_name="research-source", display_name="Source")
    _metadata(db_session, account=account_z2, bucket_name="research-target", display_name="Target")
    db_session.commit()

    bucket_service = _BucketService()
    bucket_service.replication_by_bucket["research-source"] = {
        "Role": "arn:aws:iam::000000000000:role/existing-replication",
        "Rules": [
            {
                "ID": "keep-existing-rule",
                "Status": "Enabled",
                "Priority": 2,
                "Filter": {"Prefix": "logs/"},
                "Destination": {"Bucket": "arn:aws:s3:::audit-target"},
            }
        ],
    }
    service = PortalService(db_session)

    replication = service.create_replication(
        user,
        [
            PortalReplicationAccountContext(access=_access(account_z1, user), label="Paris"),
            PortalReplicationAccountContext(access=_access(account_z2, user), label="Lyon"),
        ],
        PortalReplicationCreate(
            source_storage_space_id=f"a{account_z1.id}:research-source",
            target_storage_space_id=f"a{account_z2.id}:research-target",
        ),
        bucket_service=bucket_service,
    )

    assert len(bucket_service.replication_calls) == 1
    configuration = bucket_service.replication_calls[0][2]
    assert configuration["Role"] == "arn:aws:iam::000000000000:role/existing-replication"
    assert [rule["ID"] for rule in configuration["Rules"]] == ["keep-existing-rule", replication.rule_id]
    assert configuration["Rules"][0]["Destination"] == {"Bucket": "arn:aws:s3:::audit-target"}
    assert configuration["Rules"][1]["Destination"] == {"Bucket": "arn:aws:s3:::research-target"}
    assert configuration["Rules"][1]["Priority"] == 3


def test_portal_create_bucket_level_replication_requires_distinct_storage_locations(db_session):
    user = _user(db_session)
    endpoint = _endpoint(db_session, name="s3-z1", zonegroup="zg-lab")
    account_a = _account(db_session, name="project-a", endpoint=endpoint)
    account_b = _account(db_session, name="project-b", endpoint=endpoint)
    _metadata(db_session, account=account_a, bucket_name="research-source", display_name="Source")
    _metadata(db_session, account=account_b, bucket_name="research-target", display_name="Target")
    db_session.commit()

    service = PortalService(db_session)
    contexts = [
        PortalReplicationAccountContext(access=_access(account_a, user), label="Paris"),
        PortalReplicationAccountContext(access=_access(account_b, user), label="Paris copy"),
    ]
    bucket_service = _BucketService()
    bucket_service.replication_by_bucket["research-source"] = {
        "Role": "arn:aws:iam::000000000000:role/existing-replication",
        "Rules": [
            {
                "ID": "same-endpoint-rule",
                "Status": "Enabled",
                "Priority": 1,
                "Destination": {"Bucket": "arn:aws:s3:::research-target"},
            }
        ],
    }
    payload = service.list_replications(user, contexts, bucket_service=bucket_service)

    assert payload.can_create is False
    assert len(payload.replications) == 1
    assert payload.replications[0].target is None
    assert payload.replications[0].message == "Destination bucket is not visible in this Portal workspace."
    try:
        service.create_replication(
            user,
            contexts,
            PortalReplicationCreate(
                source_storage_space_id=f"a{account_a.id}:research-source",
                target_storage_space_id=f"a{account_b.id}:research-target",
            ),
            bucket_service=_BucketService(),
        )
    except ValueError as exc:
        assert "different storage locations" in str(exc)
    else:
        raise AssertionError("same-endpoint replication should be rejected")


def test_portal_create_bucket_level_replication_requires_same_zonegroup(db_session):
    user = _user(db_session)
    endpoint_z1 = _endpoint(db_session, name="s3-z1", zonegroup="zg-a")
    endpoint_z2 = _endpoint(db_session, name="s3-z2", zonegroup="zg-b")
    account_z1 = _account(db_session, name="project-z1", endpoint=endpoint_z1)
    account_z2 = _account(db_session, name="project-z2", endpoint=endpoint_z2)
    _metadata(db_session, account=account_z1, bucket_name="research-source", display_name="Source")
    _metadata(db_session, account=account_z2, bucket_name="research-target", display_name="Target")
    db_session.commit()

    service = PortalService(db_session)

    try:
        service.create_replication(
            user,
            [
                PortalReplicationAccountContext(access=_access(account_z1, user), label="Paris"),
                PortalReplicationAccountContext(access=_access(account_z2, user), label="Lyon"),
            ],
            PortalReplicationCreate(
                source_storage_space_id=f"a{account_z1.id}:research-source",
                target_storage_space_id=f"a{account_z2.id}:research-target",
            ),
            bucket_service=_BucketService(),
        )
    except ValueError as exc:
        assert "same Ceph zonegroup" in str(exc)
    else:
        raise AssertionError("cross-zonegroup replication should be rejected")
