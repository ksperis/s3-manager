# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Callable, Literal

from fastapi import APIRouter, Depends, HTTPException, status

from app.db import S3Account
from app.models.policy import InlinePolicyInventoryItem
from app.routers.dependencies import get_account_context, require_iam_capable_manager
from app.routers.manager.iam_common import get_account_and_service, load_inline_policies
from app.utils.concurrency import bounded_ordered_map

router = APIRouter(prefix="/manager/iam/inline-policies", tags=["manager-iam-inline-policies"])
MANAGER_INLINE_POLICY_INVENTORY_MAX_WORKERS = 8

EntityType = Literal["user", "group", "role"]


def _collect_inline_policies(
    *,
    entity_type: EntityType,
    entity_names: list[str],
    list_names_fn: Callable[[str], list[str]],
    get_policy_fn: Callable[[str, str], dict | None],
) -> list[InlinePolicyInventoryItem]:
    def load_entity(entity_name: str) -> InlinePolicyInventoryItem:
        try:
            return InlinePolicyInventoryItem(
                entity_type=entity_type,
                entity_name=entity_name,
                policies=load_inline_policies(
                    entity_name,
                    list_names_fn=list_names_fn,
                    get_policy_fn=get_policy_fn,
                ),
            )
        except RuntimeError as exc:
            return InlinePolicyInventoryItem(
                entity_type=entity_type,
                entity_name=entity_name,
                policies=[],
                error=str(exc),
            )

    return bounded_ordered_map(
        entity_names,
        load_entity,
        max_workers=MANAGER_INLINE_POLICY_INVENTORY_MAX_WORKERS,
        thread_name_prefix=f"manager-inline-policy-{entity_type}",
    )


@router.get("", response_model=list[InlinePolicyInventoryItem])
def list_iam_inline_policy_inventory(
    account: S3Account = Depends(get_account_context),
    _: dict = Depends(require_iam_capable_manager),
) -> list[InlinePolicyInventoryItem]:
    _, service = get_account_and_service(account)
    try:
        users = service.list_users()
        groups = service.list_groups()
        roles = service.list_roles()
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    return [
        *_collect_inline_policies(
            entity_type="user",
            entity_names=[user.name for user in users],
            list_names_fn=service.list_user_inline_policies,
            get_policy_fn=service.get_user_inline_policy,
        ),
        *_collect_inline_policies(
            entity_type="group",
            entity_names=[group.name for group in groups],
            list_names_fn=service.list_group_inline_policies,
            get_policy_fn=service.get_group_inline_policy,
        ),
        *_collect_inline_policies(
            entity_type="role",
            entity_names=[role.name for role in roles],
            list_names_fn=service.list_role_inline_policies,
            get_policy_fn=service.get_role_inline_policy,
        ),
    ]
