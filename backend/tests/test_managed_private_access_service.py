# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from app.db import (
    AccountIAMUser,
    AccountRole,
    AuditLog,
    ManagedPrivateAccess,
    S3Account,
    S3Connection,
    S3User,
    StorageEndpoint,
    StorageProvider,
    User,
    UserRole,
    UserS3Account,
    UserS3Connection,
    UserS3User,
)
from app.models.iam import AccessKey, IAMGroup, IAMUser
from app.models.managed_private_access import (
    ManagedIAMPrivateAccessRequest,
    ManagedRGWUserPrivateAccessRequest,
)
from app.models.policy import Policy
from app.models.s3_connection import S3ConnectionUpdate
from app.models.s3_user import S3UserGeneratedKey
from app.services.managed_private_access_service import (
    ManagedPrivateAccessConflict,
    ManagedPrivateAccessError,
    ManagedPrivateAccessForbidden,
    ManagedPrivateAccessService,
)
from app.services.s3_connections_service import S3ConnectionsService
from app.services.s3_execution_context import S3ExecutionContext


class FakeIAM:
    def __init__(self, *, cleanup_fails: bool = False) -> None:
        self.cleanup_fails = cleanup_fails
        self.created_users: list[str] = []
        self.created_keys: list[str] = []
        self.deleted_keys: list[tuple[str, str]] = []
        self.deleted_users: list[str] = []
        self.groups: list[tuple[str, str]] = []
        self.attached: list[tuple[str, str]] = []
        self.inline: list[tuple[str, str]] = []

    def list_groups(self):
        return [IAMGroup(name="operators")]

    def list_policies(self):
        return [Policy(name="S3ReadOnly", arn="arn:test:readonly")]

    def get_user(self, _name):
        return None

    def create_user(self, name, create_key=False):
        assert create_key is False
        self.created_users.append(name)
        return IAMUser(name=name), None

    def add_user_to_group(self, group, username):
        self.groups.append((group, username))

    def attach_user_policy(self, username, arn):
        self.attached.append((username, arn))

    def put_user_inline_policy(self, username, name, _document):
        self.inline.append((username, name))

    def create_access_key(self, username):
        self.created_keys.append(username)
        return AccessKey(access_key_id="AK-MANAGED", secret_access_key="NEVER-IN-RESPONSE")

    def delete_access_key(self, username, access_key_id):
        if self.cleanup_fails:
            raise RuntimeError("cleanup refused")
        self.deleted_keys.append((username, access_key_id))

    def delete_user_inline_policy(self, _username, _name):
        return None

    def detach_user_policy(self, _username, _arn):
        return None

    def remove_user_from_group(self, _group, _username):
        return None

    def delete_user(self, username):
        self.deleted_users.append(username)


def _user(db_session, *, email="owner@example.test", ceph_keys=False):
    row = User(
        email=email,
        hashed_password="x",
        role=UserRole.UI_SUPERADMIN.value,
        is_active=True,
        can_access_manager_ceph_s3_user_keys=ceph_keys,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def _endpoint(db_session, *, iam=True, admin=False):
    features = ["features:"]
    features.extend(["  iam:", f"    enabled: {'true' if iam else 'false'}"])
    features.extend(["  admin:", f"    enabled: {'true' if admin else 'false'}"])
    endpoint = StorageEndpoint(
        name=f"endpoint-{int(iam)}-{int(admin)}",
        endpoint_url="https://s3.example.test",
        admin_endpoint="https://admin.example.test" if admin else None,
        region="us-east-1",
        provider=StorageProvider.CEPH.value,
        admin_access_key="ADMIN-AK" if admin else None,
        admin_secret_key="ADMIN-SK" if admin else None,
        features_config="\n".join(features) + "\n",
        force_path_style=True,
        verify_tls=True,
    )
    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)
    return endpoint


def _account(db_session, user, endpoint):
    account = S3Account(
        name="managed-account",
        rgw_account_id="tenant-a",
        rgw_access_key="ROOT-AK",
        rgw_secret_key="ROOT-SK",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(account)
    db_session.flush()
    db_session.add(
        UserS3Account(
            user_id=user.id,
            account_id=account.id,
            role=AccountRole.ACCOUNT_ADMINISTRATOR.value,
        )
    )
    db_session.commit()
    db_session.refresh(account)
    return account


def _payload(name="Private account access"):
    return ManagedIAMPrivateAccessRequest(
        connection_name=name,
        access_browser=True,
        access_manager=False,
        groups=["operators"],
        managed_policies=["arn:test:readonly"],
        inline_policies=[{"name": "inline-read", "document": {"Statement": []}}],
    )


def test_managed_access_iam_state_requires_string_lists():
    assert ManagedPrivateAccessService._json_list('["operators"]') == [
        "operators"
    ]
    for raw in ("{", "{}", '"operators"', '["operators",42]', '[""]'):
        with pytest.raises(ValueError):
            ManagedPrivateAccessService._json_list(raw)


def _disable_capability_probe(monkeypatch):
    monkeypatch.setattr(
        "app.services.managed_private_access_service.refresh_connection_detected_capabilities",
        lambda row: setattr(row, "capabilities_json", '{"can_manage_iam": false}'),
    )


def _connection_context(source: S3Connection) -> S3ExecutionContext:
    return S3ExecutionContext.from_connection(source)


def test_iam_provisioning_never_serializes_or_audits_secret_and_is_idempotent(db_session, monkeypatch):
    user = _user(db_session)
    account = _account(db_session, user, _endpoint(db_session))
    fake = FakeIAM()
    service = ManagedPrivateAccessService(db_session)
    monkeypatch.setattr(service, "_iam_service_for_account", lambda _account: fake)
    _disable_capability_probe(monkeypatch)

    result = service.provision_iam(user=user, account=account, payload=_payload())

    assert result.status == "active"
    assert result.connection.server_managed is True
    assert result.connection.access_key_id != "AK-MANAGED"
    serialized = result.model_dump_json()
    assert "NEVER-IN-RESPONSE" not in serialized
    assert "secret_access_key" not in serialized
    connection = db_session.query(S3Connection).filter(S3Connection.id == result.connection.id).one()
    assert connection.secret_access_key == "NEVER-IN-RESPONSE"
    assert connection.storage_endpoint_id == account.storage_endpoint_id
    audits = db_session.query(AuditLog).all()
    assert audits
    assert all("NEVER-IN-RESPONSE" not in (audit.metadata_json or "") for audit in audits)

    repeated = service.provision_iam(user=user, account=account, payload=_payload())
    assert repeated.connection.id == result.connection.id
    assert fake.created_users == [f"s3m-private-u{user.id}-acc{account.id}"]
    assert fake.created_keys == [f"s3m-private-u{user.id}-acc{account.id}"]


@pytest.mark.parametrize("shared", [False, True])
def test_iam_provisioning_accepts_authorized_private_or_shared_connection_source(db_session, monkeypatch, shared):
    user = _user(db_session, email=f"source-{shared}@example.test")
    creator = user if not shared else _user(db_session, email="shared-owner@example.test")
    source = S3Connection(
        created_by_user_id=creator.id,
        name=f"source-{shared}",
        is_shared=shared,
        is_active=True,
        access_manager=True,
        access_browser=not shared,
        custom_endpoint_config=json.dumps(
            {
                "endpoint_url": "https://custom.example.test",
                "region": "eu-west-3",
                "provider": "other",
                "force_path_style": True,
                "verify_tls": True,
            }
        ),
        access_key_id="SOURCE-AK",
        secret_access_key="SOURCE-SECRET",
        capabilities_json='{"can_manage_iam": true}',
    )
    db_session.add(source)
    db_session.flush()
    if shared:
        db_session.add(UserS3Connection(user_id=user.id, s3_connection_id=source.id))
    db_session.commit()
    context = _connection_context(source)
    fake = FakeIAM()
    service = ManagedPrivateAccessService(db_session)
    monkeypatch.setattr(service, "_iam_service_for_account", lambda _account: fake)
    monkeypatch.setattr(
        "app.services.managed_private_access_service.validate_user_supplied_s3_endpoint",
        lambda value, field_name="Endpoint URL": value,
    )
    _disable_capability_probe(monkeypatch)

    result = service.provision_iam(user=user, account=context, payload=_payload(f"private-{shared}"))

    created = db_session.query(S3Connection).filter(S3Connection.id == result.connection.id).one()
    assert created.is_shared is False
    assert created.access_key_id == "AK-MANAGED"
    assert created.access_key_id != source.access_key_id
    assert json.loads(created.custom_endpoint_config) == json.loads(source.custom_endpoint_config)


@pytest.mark.parametrize(
    ("assigned", "access_manager", "iam_capable"),
    [(False, True, True), (True, False, True), (True, True, False)],
)
def test_iam_connection_source_requires_assignment_manager_execution_and_iam_capability(
    db_session,
    assigned,
    access_manager,
    iam_capable,
):
    user = _user(db_session, email=f"denied-{assigned}-{access_manager}-{iam_capable}@example.test")
    creator = _user(db_session, email=f"creator-{assigned}-{access_manager}-{iam_capable}@example.test")
    source = S3Connection(
        created_by_user_id=creator.id,
        name=f"denied-{assigned}-{access_manager}-{iam_capable}",
        is_shared=True,
        is_active=True,
        access_manager=access_manager,
        access_browser=False,
        custom_endpoint_config='{"endpoint_url":"https://custom.example.test","force_path_style":false,"provider":null,"region":null,"verify_tls":true}',
        access_key_id="SOURCE-AK",
        secret_access_key="SOURCE-SK",
        capabilities_json=json.dumps({"can_manage_iam": iam_capable}),
    )
    db_session.add(source)
    db_session.flush()
    if assigned:
        db_session.add(UserS3Connection(user_id=user.id, s3_connection_id=source.id))
    db_session.commit()

    with pytest.raises(ManagedPrivateAccessForbidden, match="not allowed"):
        ManagedPrivateAccessService(db_session).provision_iam(
            user=user,
            account=_connection_context(source),
            payload=_payload(),
        )


def test_private_connection_permission_is_required_before_remote_calls(db_session, monkeypatch):
    user = _user(db_session, email="private-disabled@example.test")
    account = _account(db_session, user, _endpoint(db_session))
    service = ManagedPrivateAccessService(db_session)
    monkeypatch.setattr(service.access, "private_connections_allowed", lambda _user: False)
    monkeypatch.setattr(
        service,
        "_iam_service_for_account",
        lambda _account: (_ for _ in ()).throw(AssertionError("IAM must not be contacted")),
    )

    with pytest.raises(ManagedPrivateAccessForbidden, match="not allowed"):
        service.provision_iam(user=user, account=account, payload=_payload())


def test_custom_connection_destination_must_pass_private_tls_rules(db_session, monkeypatch):
    user = _user(db_session, email="tls-disabled@example.test")
    source = S3Connection(
        created_by_user_id=user.id,
        name="insecure-source",
        is_shared=False,
        is_active=True,
        access_manager=True,
        access_browser=False,
        custom_endpoint_config='{"endpoint_url":"https://custom.example.test","force_path_style":false,"provider":null,"region":null,"verify_tls":false}',
        access_key_id="SOURCE-AK",
        secret_access_key="SOURCE-SK",
        capabilities_json='{"can_manage_iam":true}',
    )
    db_session.add(source)
    db_session.commit()
    monkeypatch.setattr(
        "app.services.managed_private_access_service.validate_user_supplied_s3_endpoint",
        lambda value, field_name="Endpoint URL": value,
    )

    with pytest.raises(ManagedPrivateAccessError, match="TLS verification"):
        ManagedPrivateAccessService(db_session).provision_iam(
            user=user,
            account=_connection_context(source),
            payload=_payload(),
        )


def test_iam_provisioning_never_reuses_portal_identity(db_session, monkeypatch):
    user = _user(db_session, email="portal-distinct@example.test")
    account = _account(db_session, user, _endpoint(db_session))
    portal = AccountIAMUser(
        user_id=user.id,
        account_id=account.id,
        iam_user_id="portal-principal-id",
        iam_username="portal-u-existing",
        active_access_key="PORTAL-AK",
        active_secret_key="PORTAL-SK",
    )
    db_session.add(portal)
    db_session.commit()
    fake = FakeIAM()
    service = ManagedPrivateAccessService(db_session)
    monkeypatch.setattr(service, "_iam_service_for_account", lambda _account: fake)
    _disable_capability_probe(monkeypatch)

    result = service.provision_iam(user=user, account=account, payload=_payload())

    provisioning = db_session.query(ManagedPrivateAccess).filter_by(s3_connection_id=result.connection.id).one()
    assert provisioning.iam_username == f"s3m-private-u{user.id}-acc{account.id}"
    assert not provisioning.iam_username.startswith("portal-")
    assert provisioning.remote_principal_identifier != portal.iam_user_id
    assert portal.active_access_key == "PORTAL-AK"


def test_existing_untracked_deterministic_iam_user_is_never_adopted(db_session, monkeypatch):
    user = _user(db_session, email="remote-conflict@example.test")
    account = _account(db_session, user, _endpoint(db_session))
    fake = FakeIAM()
    fake.get_user = lambda name: IAMUser(name=name)
    service = ManagedPrivateAccessService(db_session)
    monkeypatch.setattr(service, "_iam_service_for_account", lambda _account: fake)

    with pytest.raises(ManagedPrivateAccessConflict, match="already exists"):
        service.provision_iam(user=user, account=account, payload=_payload())

    provisioning = db_session.query(ManagedPrivateAccess).one()
    assert provisioning.state == "failed"
    assert fake.created_users == []
    assert fake.created_keys == []


def test_claim_constraint_rejects_concurrent_active_source(db_session):
    user = _user(db_session, email="concurrent@example.test")
    account = _account(db_session, user, _endpoint(db_session))
    service = ManagedPrivateAccessService(db_session)
    source = service._resolve_iam_source(user, account)

    service._claim(user, source)
    with pytest.raises(ManagedPrivateAccessConflict, match="already exists"):
        service._claim(user, source)


def test_failed_local_creation_compensates_remote_resources(db_session, monkeypatch):
    user = _user(db_session, email="compensate@example.test")
    account = _account(db_session, user, _endpoint(db_session))
    fake = FakeIAM()
    service = ManagedPrivateAccessService(db_session)
    monkeypatch.setattr(service, "_iam_service_for_account", lambda _account: fake)
    monkeypatch.setattr(
        service,
        "_create_connection",
        lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("db failed secret_access_key=LEAK-ME")),
    )

    with pytest.raises(ManagedPrivateAccessError, match="Unable to create") as raised:
        service.provision_iam(user=user, account=account, payload=_payload())
    assert "LEAK-ME" not in str(raised.value)

    provisioning = db_session.query(ManagedPrivateAccess).one()
    assert provisioning.state == "failed"
    assert provisioning.s3_connection_id is None
    assert fake.deleted_keys == [(provisioning.iam_username, "AK-MANAGED")]
    assert fake.deleted_users == [provisioning.iam_username]
    actions = [row.action for row in db_session.query(AuditLog).order_by(AuditLog.id).all()]
    assert "managed_private_access.provision.failure" in actions
    assert "managed_private_access.compensation.success" in actions
    assert all(
        "LEAK-ME" not in f"{row.message or ''}{row.metadata_json or ''}"
        for row in db_session.query(AuditLog).all()
    )


def test_failed_capability_probe_rolls_back_flushed_local_connection(db_session, monkeypatch):
    user = _user(db_session, email="probe-rollback@example.test")
    account = _account(db_session, user, _endpoint(db_session))
    fake = FakeIAM()
    service = ManagedPrivateAccessService(db_session)
    monkeypatch.setattr(service, "_iam_service_for_account", lambda _account: fake)
    monkeypatch.setattr(
        "app.services.managed_private_access_service.refresh_connection_detected_capabilities",
        lambda _row: (_ for _ in ()).throw(RuntimeError("probe failed")),
    )

    with pytest.raises(ManagedPrivateAccessError, match="Unable to create"):
        service.provision_iam(user=user, account=account, payload=_payload())

    assert db_session.query(S3Connection).count() == 0
    provisioning = db_session.query(ManagedPrivateAccess).one()
    assert provisioning.state == "failed"
    assert provisioning.s3_connection_id is None
    assert fake.deleted_keys == [(provisioning.iam_username, "AK-MANAGED")]


def test_failed_compensation_is_durable_cleanup_pending(db_session, monkeypatch):
    user = _user(db_session, email="cleanup@example.test")
    account = _account(db_session, user, _endpoint(db_session))
    fake = FakeIAM(cleanup_fails=True)
    service = ManagedPrivateAccessService(db_session)
    monkeypatch.setattr(service, "_iam_service_for_account", lambda _account: fake)
    monkeypatch.setattr(service, "_create_connection", lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("db failed")))

    with pytest.raises(ManagedPrivateAccessError):
        service.provision_iam(user=user, account=account, payload=_payload())

    provisioning = db_session.query(ManagedPrivateAccess).one()
    assert provisioning.state == "cleanup_pending"
    assert provisioning.access_key_id == "AK-MANAGED"
    assert "cleanup refused" in (provisioning.cleanup_error or "")
    actions = [row.action for row in db_session.query(AuditLog).order_by(AuditLog.id).all()]
    assert "managed_private_access.compensation.failure" in actions
    assert "managed_private_access.cleanup_pending" in actions

    fake.cleanup_fails = False
    service.retry_provisioning_cleanup(user=user, provisioning_id=provisioning.id)
    assert db_session.query(ManagedPrivateAccess).filter_by(id=provisioning.id).first() is None
    assert fake.deleted_keys == [(provisioning.iam_username, "AK-MANAGED")]
    retry_audit = db_session.query(AuditLog).filter_by(
        action="managed_private_access.compensation.retry.success"
    ).one()
    assert "NEVER-IN-RESPONSE" not in (retry_audit.message or "")


def test_rgw_user_provisioning_uses_distinct_key_and_endpoint(db_session, monkeypatch):
    user = _user(db_session, email="rgw@example.test", ceph_keys=True)
    endpoint = _endpoint(db_session, iam=False, admin=True)
    s3_user = S3User(
        name="RGW user",
        rgw_user_uid="rgw-principal",
        rgw_access_key="TECHNICAL-AK",
        rgw_secret_key="TECHNICAL-SK",
        storage_endpoint_id=endpoint.id,
        allow_manager_ceph_s3_user_keys=True,
    )
    db_session.add(s3_user)
    db_session.flush()
    db_session.add(UserS3User(user_id=user.id, s3_user_id=s3_user.id))
    db_session.commit()
    context = S3ExecutionContext.from_legacy_user(s3_user)
    monkeypatch.setattr(
        "app.services.managed_private_access_service.S3UsersService.create_access_key_entry",
        lambda _service, user_id: S3UserGeneratedKey(
            access_key_id="PERSONAL-AK",
            secret_access_key="PERSONAL-SK",
        ),
    )
    _disable_capability_probe(monkeypatch)

    result = ManagedPrivateAccessService(db_session).provision_rgw_user(
        user=user,
        account=context,
        payload=ManagedRGWUserPrivateAccessRequest(
            connection_name="RGW private",
            access_browser=True,
            access_manager=False,
        ),
    )

    created = db_session.query(S3Connection).filter(S3Connection.id == result.connection.id).one()
    assert created.storage_endpoint_id == endpoint.id
    assert created.access_key_id == "PERSONAL-AK"
    assert created.access_key_id != s3_user.rgw_access_key
    assert created.credential_owner_type == "s3_user"
    assert created.credential_owner_identifier == s3_user.rgw_user_uid
    assert "PERSONAL-SK" not in result.model_dump_json()


def test_rgw_user_provisioning_requires_key_management_permission(db_session):
    user = _user(db_session, email="rgw-denied@example.test", ceph_keys=False)
    endpoint = _endpoint(db_session, iam=False, admin=True)
    s3_user = S3User(
        name="RGW denied",
        rgw_user_uid="rgw-denied",
        rgw_access_key="TECHNICAL-AK",
        rgw_secret_key="TECHNICAL-SK",
        storage_endpoint_id=endpoint.id,
        allow_manager_ceph_s3_user_keys=True,
    )
    db_session.add(s3_user)
    db_session.flush()
    db_session.add(UserS3User(user_id=user.id, s3_user_id=s3_user.id))
    db_session.commit()
    context = S3ExecutionContext.from_legacy_user(s3_user)

    with pytest.raises(ManagedPrivateAccessForbidden, match="not allowed"):
        ManagedPrivateAccessService(db_session).provision_rgw_user(
            user=user,
            account=context,
            payload=ManagedRGWUserPrivateAccessRequest(
                connection_name="RGW private",
                access_browser=True,
                access_manager=False,
            ),
        )


def test_managed_iam_connection_delete_cleans_remote_resources_before_local_rows(db_session, monkeypatch):
    user = _user(db_session, email="delete-managed@example.test")
    account = _account(db_session, user, _endpoint(db_session))
    fake = FakeIAM()
    service = ManagedPrivateAccessService(db_session)
    monkeypatch.setattr(service, "_iam_service_for_account", lambda _account: fake)
    _disable_capability_probe(monkeypatch)
    result = service.provision_iam(user=user, account=account, payload=_payload())

    deleted = service.delete_owned_connection(user=user, connection_id=result.connection.id)

    assert deleted is True
    assert fake.deleted_keys == [(f"s3m-private-u{user.id}-acc{account.id}", "AK-MANAGED")]
    assert fake.deleted_users == [f"s3m-private-u{user.id}-acc{account.id}"]
    assert db_session.query(S3Connection).filter_by(id=result.connection.id).first() is None
    assert db_session.query(ManagedPrivateAccess).filter_by(id=result.provisioning_id).first() is None


def test_server_managed_connection_generic_updates_protect_provenance_and_credentials(db_session):
    user = _user(db_session, email="immutable@example.test")
    connection = S3Connection(
        created_by_user_id=user.id,
        name="managed",
        is_shared=False,
        access_browser=True,
        access_manager=False,
        server_managed=True,
        custom_endpoint_config='{"endpoint_url":"https://managed.example.test","force_path_style":false,"provider":null,"region":null,"verify_tls":true}',
        access_key_id="MANAGED-AK",
        secret_access_key="MANAGED-SK",
        capabilities_json='{"can_manage_iam":false}',
    )
    db_session.add(connection)
    db_session.commit()
    service = S3ConnectionsService(db_session)

    renamed = service.update(user.id, connection.id, S3ConnectionUpdate(name="renamed", access_manager=True))
    assert renamed.name == "renamed"
    assert renamed.access_manager is True

    with pytest.raises(ValueError, match="immutable"):
        service.update(user.id, connection.id, S3ConnectionUpdate(endpoint_url="https://other.example.test"))
    with pytest.raises(ValueError, match="At least one access flag"):
        service.update(
            user.id,
            connection.id,
            S3ConnectionUpdate(access_browser=False, access_manager=False),
        )
    with pytest.raises(ValueError, match="rotated by the provisioning service"):
        service.update_credentials(
            user.id,
            connection.id,
            access_key_id="OTHER-AK",
            secret_access_key="OTHER-SK",
        )
    with pytest.raises(ValueError, match="deleted by the provisioning service"):
        service.delete(user.id, connection.id)
