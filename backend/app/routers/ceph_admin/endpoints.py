# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.config import get_settings
from app.db import StorageEndpoint as DbStorageEndpoint, StorageProvider, User
from app.models.ceph_admin import (
    CephAdminEndpoint,
    CephAdminEndpointAccess,
    CephAdminRgwInfoSummary,
    CephAdminRgwPlacementTarget,
)
from app.routers.ceph_admin.dependencies import (
    build_ceph_admin_endpoint_payload,
    CephAdminContext,
    get_ceph_admin_context,
    get_ceph_admin_workspace_endpoint,
    validate_ceph_admin_service_configuration,
    probe_ceph_admin_service_identity,
)
from app.routers.dependencies import get_current_ceph_admin
from app.services.rgw_admin import RGWAdminError, get_rgw_admin_client
from app.services.tags_service import TagsService
from app.utils.normalize import normalize_optional_string
from app.utils.rgw import extract_rgw_user_identity
from app.utils.storage_endpoint_features import resolve_rgw_admin_api_endpoint
from app.utils.name_ordering import name_order_by
from app.utils.http_errors import sanitize_error_detail
from app.utils.time import utcnow

router = APIRouter(prefix="/ceph-admin/endpoints", tags=["ceph-admin-endpoints"])


def _extract_storage_classes(value: Any) -> set[str]:
    classes: set[str] = set()
    if isinstance(value, str):
        normalized = value.strip()
        if normalized:
            classes.add(normalized)
        return classes
    if isinstance(value, list):
        for item in value:
            classes.update(_extract_storage_classes(item))
        return classes
    if isinstance(value, dict):
        direct = value.get("storage_class") or value.get("storage-class") or value.get("default_storage_class")
        if direct:
            classes.update(_extract_storage_classes(direct))
        nested = value.get("storage_classes") or value.get("storage-classes")
        if isinstance(nested, dict):
            for key in nested.keys():
                normalized = str(key).strip()
                if normalized:
                    classes.add(normalized)
        elif nested is not None:
            classes.update(_extract_storage_classes(nested))
        return classes
    return classes


def _iter_named_placements(value: Any) -> list[tuple[str, Any]]:
    placements: list[tuple[str, Any]] = []
    if isinstance(value, list):
        for item in value:
            if isinstance(item, dict):
                key = item.get("key")
                val = item.get("val")
                if key is not None:
                    name = str(key).strip()
                    if name:
                        placements.append((name, val if val is not None else item))
                    continue
                name = (
                    item.get("name")
                    or item.get("placement")
                    or item.get("placement_name")
                    or item.get("placement_id")
                    or item.get("id")
                )
                normalized = str(name).strip() if name is not None else ""
                if normalized:
                    placements.append((normalized, item))
            elif isinstance(item, str):
                normalized = item.strip()
                if normalized:
                    placements.append((normalized, {}))
        return placements
    if isinstance(value, dict):
        if any(k in value for k in ("name", "placement", "placement_name", "placement_id", "id")):
            name = (
                value.get("name")
                or value.get("placement")
                or value.get("placement_name")
                or value.get("placement_id")
                or value.get("id")
            )
            normalized = str(name).strip() if name is not None else ""
            if normalized:
                placements.append((normalized, value))
            return placements
        for key, entry in value.items():
            normalized = str(key).strip()
            if normalized:
                placements.append((normalized, entry))
    return placements


def _summarize_rgw_info(payload: dict[str, Any]) -> CephAdminRgwInfoSummary:
    zonegroup_payload = payload.get("zonegroup") if isinstance(payload.get("zonegroup"), dict) else {}
    default_placement = normalize_optional_string(
        payload.get("default_placement")
        or payload.get("default_placement_rule")
        or zonegroup_payload.get("default_placement")
        or zonegroup_payload.get("default_placement_rule")
    )
    zonegroup = normalize_optional_string(payload.get("zonegroup_name"))
    if zonegroup is None:
        zonegroup = normalize_optional_string(payload.get("zonegroup"))
    if zonegroup is None:
        zonegroup = normalize_optional_string(zonegroup_payload.get("name"))
    realm = normalize_optional_string(payload.get("realm_name") or payload.get("realm"))

    placement_candidates: list[Any] = [
        payload.get("placement_targets"),
        payload.get("placement-targets"),
        payload.get("placement_pools"),
        payload.get("placement-pools"),
        zonegroup_payload.get("placement_targets"),
        zonegroup_payload.get("placement-targets"),
        zonegroup_payload.get("placement_pools"),
        zonegroup_payload.get("placement-pools"),
    ]
    by_name: dict[str, set[str]] = {}
    for candidate in placement_candidates:
        for name, details in _iter_named_placements(candidate):
            classes = _extract_storage_classes(details)
            if name not in by_name:
                by_name[name] = set()
            by_name[name].update(classes)

    global_classes = _extract_storage_classes(payload) | _extract_storage_classes(zonegroup_payload)
    placements = [
        CephAdminRgwPlacementTarget(name=name, storage_classes=sorted(values))
        for name, values in sorted(by_name.items(), key=lambda item: item[0])
    ]
    for placement in placements:
        global_classes.update(placement.storage_classes)

    return CephAdminRgwInfoSummary(
        default_placement=default_placement,
        zonegroup=zonegroup,
        realm=realm,
        placement_targets=placements,
        storage_classes=sorted(global_classes),
    )


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
        if str(endpoint.provider) != StorageProvider.CEPH.value:
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
        admin_endpoint = resolve_rgw_admin_api_endpoint(endpoint)
        if admin_warning is None and admin_endpoint and endpoint.ceph_admin_access_key and endpoint.ceph_admin_secret_key:
            try:
                admin_client = get_rgw_admin_client(
                    access_key=endpoint.ceph_admin_access_key,
                    secret_key=endpoint.ceph_admin_secret_key,
                    endpoint=admin_endpoint,
                    region=endpoint.region,
                    verify_tls=bool(getattr(endpoint, "verify_tls", True)),
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


@router.get("/{endpoint_id}/info", response_model=CephAdminRgwInfoSummary)
def get_ceph_admin_endpoint_info(
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> CephAdminRgwInfoSummary:
    try:
        payload = ctx.rgw_admin.get_info(allow_not_found=True)
    except RGWAdminError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=sanitize_error_detail(str(exc))) from exc
    if not isinstance(payload, dict) or not payload:
        return CephAdminRgwInfoSummary()
    return _summarize_rgw_info(payload)
