# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.config import get_settings
from app.db import StorageEndpoint as DbStorageEndpoint, StorageProvider, User
from app.models.ceph_admin import (
    CephAdminEndpoint,
    CephAdminEndpointAccess,
)
from app.routers.ceph_admin.dependencies import (
    build_ceph_admin_endpoint_payload,
    get_ceph_admin_workspace_endpoint,
    validate_ceph_admin_service_configuration,
    probe_ceph_admin_service_identity,
)
from app.routers.dependencies import get_current_ceph_admin
from app.services.rgw_admin import RGWAdminError, get_rgw_admin_client
from app.services.tags_service import TagsService
from app.utils.normalize import normalize_storage_provider
from app.utils.rgw_payloads import extract_rgw_user_identity
from app.utils.storage_endpoint_features import resolve_rgw_admin_api_endpoint
from app.utils.name_ordering import name_order_by
from app.utils.time import utcnow

router = APIRouter(prefix="/ceph-admin/endpoints", tags=["ceph-admin-endpoints"])


@router.get("", response_model=list[CephAdminEndpoint])
def list_ceph_admin_endpoints(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_ceph_admin),
) -> list[CephAdminEndpoint]:
    tags_service = TagsService(db)
    endpoints = (
        db.query(DbStorageEndpoint)
        .order_by(*name_order_by(DbStorageEndpoint))
        .all()
    )
    results: list[CephAdminEndpoint] = []
    for endpoint in endpoints:
        if normalize_storage_provider(endpoint.provider) != StorageProvider.CEPH:
            continue
        payload = build_ceph_admin_endpoint_payload(endpoint)
        payload["tags"] = tags_service.filter_selector_visible(tags_service.get_storage_endpoint_tags(endpoint))
        results.append(CephAdminEndpoint(**payload))
    return results


@router.get("/{endpoint_id}/access", response_model=CephAdminEndpointAccess)
def get_ceph_admin_endpoint_access(
    endpoint: DbStorageEndpoint = Depends(get_ceph_admin_workspace_endpoint),
    probe: bool = False,
) -> CephAdminEndpointAccess:
    has_supervision_credentials = bool(endpoint.supervision_access_key and endpoint.supervision_secret_key)
    admin_warning = validate_ceph_admin_service_configuration(endpoint)
    accounts_warning = None
    can_admin = admin_warning is None
    can_accounts = can_admin
    active_rgw_uid = None
    active_rgw_tenant = None
    availability_status = "misconfigured" if admin_warning else "unknown"
    availability_checked_at = None
    if probe and admin_warning is None:
        availability_checked_at = utcnow().isoformat()
        identity_probe = probe_ceph_admin_service_identity(endpoint)
        admin_warning = identity_probe.warning
        availability_status = identity_probe.status
        if identity_probe.status != "available":
            can_admin = False
            can_accounts = False
        if admin_warning is None and endpoint.ceph_admin_access_key and endpoint.ceph_admin_secret_key:
            admin_endpoint = resolve_rgw_admin_api_endpoint(endpoint)
            try:
                admin_client = get_rgw_admin_client(
                    access_key=endpoint.ceph_admin_access_key,
                    secret_key=endpoint.ceph_admin_secret_key,
                    endpoint=admin_endpoint,
                    region=endpoint.region,
                    verify_tls=endpoint.verify_tls,
                    request_timeout_seconds=get_settings().rgw_admin_probe_timeout_seconds,
                )
                active_rgw_uid, active_rgw_tenant = extract_rgw_user_identity(identity_probe.user_payload)
                # Account support is only discovered on explicit probes, never while rendering the shell.
                admin_client.get_account(
                    "RGW00000000000000000",
                    allow_not_found=True,
                    allow_not_implemented=True,
                )
                can_accounts = admin_client.account_api_supported is True
                if not can_accounts:
                    accounts_warning = "RGW Accounts API is not supported by this endpoint. Other Ceph Admin operations remain available."
            except RGWAdminError:
                can_accounts = False
                accounts_warning = "RGW Accounts API could not be checked. Other Ceph Admin operations remain available."
    return CephAdminEndpointAccess(
        endpoint_id=endpoint.id,
        can_admin=can_admin,
        can_accounts=can_accounts,
        can_metrics=has_supervision_credentials,
        admin_warning=admin_warning,
        accounts_warning=accounts_warning,
        active_rgw_uid=active_rgw_uid,
        active_rgw_tenant=active_rgw_tenant,
        availability_status=availability_status,
        availability_checked_at=availability_checked_at,
    )
