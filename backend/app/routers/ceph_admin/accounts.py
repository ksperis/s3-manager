# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.models.ceph_admin import CephAdminRgwAccountSummary, PaginatedCephAdminAccountsResponse
from app.routers.ceph_admin.dependencies import CephAdminContext, get_ceph_admin_context
from app.services.rgw_admin import RGWAdminError

router = APIRouter(prefix="/ceph-admin/endpoints/{endpoint_id}/accounts", tags=["ceph-admin-accounts"])


@router.get("", response_model=PaginatedCephAdminAccountsResponse)
def list_rgw_accounts(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    search: str | None = Query(None),
    sort_by: str = Query("account_id"),
    sort_dir: str = Query("asc"),
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> PaginatedCephAdminAccountsResponse:
    try:
        payload = ctx.rgw_admin.list_accounts()
    except RGWAdminError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    results: list[CephAdminRgwAccountSummary] = []
    for entry in payload or []:
        if not isinstance(entry, dict):
            continue
        account_id = str(entry.get("account_id") or entry.get("id") or "").strip()
        if not account_id:
            continue
        name = entry.get("account_name") or entry.get("name") or entry.get("display_name")
        account_name = str(name).strip() if isinstance(name, str) and name.strip() else None
        results.append(CephAdminRgwAccountSummary(account_id=account_id, account_name=account_name))

    search_value = search.strip().lower() if isinstance(search, str) else ""
    if search_value:
        results = [
            item
            for item in results
            if search_value in item.account_id.lower()
            or search_value in (item.account_name or "").lower()
        ]

    def sort_key(item: CephAdminRgwAccountSummary):
        if sort_by == "account_name" or sort_by == "name":
            return (item.account_name or item.account_id).lower()
        return item.account_id.lower()

    results.sort(key=sort_key, reverse=sort_dir == "desc")

    total = len(results)
    start = max(page - 1, 0) * page_size
    end = start + page_size
    page_items = results[start:end]
    has_next = end < total

    return PaginatedCephAdminAccountsResponse(
        items=page_items,
        total=total,
        page=page,
        page_size=page_size,
        has_next=has_next,
    )


@router.get("/{account_id}")
def get_rgw_account(
    account_id: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> dict[str, Any]:
    try:
        payload = ctx.rgw_admin.get_account(account_id, allow_not_found=True)
    except RGWAdminError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    if not payload:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="RGW account not found")
    if isinstance(payload, dict) and payload.get("not_found"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="RGW account not found")
    return payload if isinstance(payload, dict) else {"payload": payload}
