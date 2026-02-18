# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
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
    validate_ceph_admin_service_identity,
)
from app.routers.dependencies import get_current_ceph_admin
from app.services.rgw_admin import RGWAdminError, get_rgw_admin_client
from app.utils.storage_endpoint_features import resolve_admin_endpoint

router = APIRouter(prefix="/ceph-admin/endpoints", tags=["ceph-admin-endpoints"])


def _normalize_optional_str(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    return cleaned or None


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
    default_placement = _normalize_optional_str(
        payload.get("default_placement")
        or payload.get("default_placement_rule")
        or zonegroup_payload.get("default_placement")
        or zonegroup_payload.get("default_placement_rule")
    )
    zonegroup = _normalize_optional_str(payload.get("zonegroup_name"))
    if zonegroup is None:
        zonegroup = _normalize_optional_str(payload.get("zonegroup"))
    if zonegroup is None:
        zonegroup = _normalize_optional_str(zonegroup_payload.get("name"))
    realm = _normalize_optional_str(payload.get("realm_name") or payload.get("realm"))

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
    endpoints = (
        db.query(DbStorageEndpoint)
        .order_by(DbStorageEndpoint.is_default.desc(), DbStorageEndpoint.name.asc())
        .all()
    )
    results: list[CephAdminEndpoint] = []
    for endpoint in endpoints:
        if str(endpoint.provider) != StorageProvider.CEPH.value:
            continue
        payload = build_ceph_admin_endpoint_payload(endpoint)
        if not payload["capabilities"].get("admin"):
            continue
        results.append(CephAdminEndpoint(**payload))
    return results


@router.get("/{endpoint_id}/access", response_model=CephAdminEndpointAccess)
def get_ceph_admin_endpoint_access(
    endpoint: DbStorageEndpoint = Depends(get_ceph_admin_workspace_endpoint),
) -> CephAdminEndpointAccess:
    has_supervision_credentials = bool(endpoint.supervision_access_key and endpoint.supervision_secret_key)
    admin_warning = validate_ceph_admin_service_identity(endpoint)
    can_accounts = False
    if admin_warning is None:
        admin_endpoint = resolve_admin_endpoint(endpoint)
        if admin_endpoint and endpoint.ceph_admin_access_key and endpoint.ceph_admin_secret_key:
            try:
                admin_client = get_rgw_admin_client(
                    access_key=endpoint.ceph_admin_access_key,
                    secret_key=endpoint.ceph_admin_secret_key,
                    endpoint=admin_endpoint,
                    region=endpoint.region,
                )
                # Probe /admin/account directly; not_found still means the API is reachable.
                admin_client.get_account("RGW00000000000000000", allow_not_found=True)
                can_accounts = True
            except RGWAdminError:
                can_accounts = False
    return CephAdminEndpointAccess(
        endpoint_id=endpoint.id,
        can_admin=admin_warning is None,
        can_accounts=can_accounts,
        can_metrics=has_supervision_credentials,
        admin_warning=admin_warning,
    )


@router.get("/{endpoint_id}/info", response_model=CephAdminRgwInfoSummary)
def get_ceph_admin_endpoint_info(
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> CephAdminRgwInfoSummary:
    try:
        payload = ctx.rgw_admin.get_info(allow_not_found=True)
    except RGWAdminError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    if not isinstance(payload, dict) or not payload:
        return CephAdminRgwInfoSummary()
    return _summarize_rgw_info(payload)
