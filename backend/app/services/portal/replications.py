# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Optional

from app.db import S3Account
from app.models.bucket import BucketReplicationConfiguration
from app.models.portal import (
    PortalReplicationCreate,
    PortalReplicationList,
    PortalReplicationStorageSpace,
    PortalReplicationSummary,
    PortalStorageSpaceSummary,
)
from app.services.buckets_service import BucketsService
from app.utils.storage_endpoint_features import resolve_feature_flags

from ._shared import AccountRole, User


_PORTAL_REPLICATION_ROLE_ARN = "arn:aws:iam::000000000000:role/portal-bucket-replication"


@dataclass(frozen=True)
class PortalReplicationAccountContext:
    access: "AccountAccess"
    label: Optional[str] = None


@dataclass(frozen=True)
class _PortalReplicationSpaceContext:
    api: PortalReplicationStorageSpace
    account: S3Account
    bucket_name: str
    role: str


class PortalReplicationsMixin:
    def _portal_replication_space_id(self, space: PortalStorageSpaceSummary, *, account_id: int, multi_account: bool) -> str:
        bucket_name = space.internal_bucket_name or space.id
        return f"a{account_id}:{bucket_name}" if multi_account else bucket_name

    def _portal_replication_zonegroup(self, account: S3Account) -> str | None:
        endpoint = getattr(account, "storage_endpoint", None)
        value = getattr(endpoint, "ceph_zonegroup_name", None) if endpoint is not None else None
        cleaned = str(value or "").strip()
        return cleaned or None

    def _portal_replication_bucket_name_from_arn(self, value: Any) -> str | None:
        text = str(value or "").strip()
        if not text:
            return None
        if text.startswith("arn:"):
            return text.rsplit(":", 1)[-1] or None
        return text

    def _portal_replication_rule_id(self, source: _PortalReplicationSpaceContext, target: _PortalReplicationSpaceContext) -> str:
        raw = f"portal-{source.api.account_id}-{source.bucket_name}-to-{target.api.account_id}-{target.bucket_name}".lower()
        normalized = re.sub(r"[^a-z0-9-]+", "-", raw).strip("-")
        return (normalized[:120].strip("-") or "portal-replication")[:120]

    def _portal_replication_storage_spaces(
        self,
        user: User,
        account_contexts: list[PortalReplicationAccountContext],
    ) -> list[_PortalReplicationSpaceContext]:
        multi_account = len({ctx.access.account.id for ctx in account_contexts}) > 1
        results: list[_PortalReplicationSpaceContext] = []
        for context in account_contexts:
            access = context.access
            account = access.account
            endpoint = getattr(account, "storage_endpoint", None)
            features = resolve_feature_flags(endpoint) if endpoint is not None else None
            zonegroup = self._portal_replication_zonegroup(account)
            spaces = self.list_storage_spaces(user, access, include_archived=False)
            for space in spaces:
                bucket_name = space.internal_bucket_name or space.id
                if not bucket_name:
                    continue
                api_space = PortalReplicationStorageSpace(
                    id=self._portal_replication_space_id(space, account_id=account.id, multi_account=multi_account),
                    name=space.name,
                    bucket_name=bucket_name,
                    account_id=account.id,
                    account_name=account.name,
                    project_account_label=context.label,
                    storage_endpoint_id=endpoint.id if endpoint is not None else None,
                    storage_endpoint_name=endpoint.name if endpoint is not None else None,
                    storage_endpoint_zonegroup=zonegroup,
                    bucket_replication_allowed=bool(
                        endpoint is not None
                        and features is not None
                        and features.replication_enabled
                        and getattr(endpoint, "ceph_zonegroup_bucket_replication_allowed", False)
                    ),
                    global_replication_configured=bool(
                        endpoint is not None and getattr(endpoint, "ceph_zonegroup_global_replication_configured", False)
                    ),
                    can_manage=bool(access.capabilities.can_manage_buckets or access.role == AccountRole.PORTAL_MANAGER.value),
                )
                results.append(
                    _PortalReplicationSpaceContext(
                        api=api_space,
                        account=account,
                        bucket_name=bucket_name,
                        role=access.role,
                    )
                )
        return sorted(
            results,
            key=lambda item: (
                item.api.storage_endpoint_zonegroup or "",
                item.api.account_id,
                item.api.name.lower(),
                item.api.id,
            ),
        )

    def _portal_global_replication_rows(
        self,
        spaces: list[_PortalReplicationSpaceContext],
    ) -> list[PortalReplicationSummary]:
        rows: list[PortalReplicationSummary] = []
        for index, source in enumerate(spaces):
            source_zonegroup = source.api.storage_endpoint_zonegroup
            if not source_zonegroup or not source.api.global_replication_configured:
                continue
            for target in spaces[index + 1 :]:
                if source.api.id == target.api.id:
                    continue
                if target.bucket_name != source.bucket_name:
                    continue
                if target.api.storage_endpoint_zonegroup != source_zonegroup:
                    continue
                if not target.api.global_replication_configured:
                    continue
                if source.api.storage_endpoint_id == target.api.storage_endpoint_id:
                    continue
                rows.append(
                    PortalReplicationSummary(
                        id=f"global:{source.api.id}<->{target.api.id}",
                        mode="global",
                        status="configured",
                        source=source.api,
                        target=target.api,
                        target_bucket_name=target.bucket_name,
                        zonegroup=source_zonegroup,
                        message="Global zonegroup replication applies to this storage pair.",
                    )
                )
        return rows

    def _portal_bucket_replication_rows(
        self,
        spaces: list[_PortalReplicationSpaceContext],
        *,
        bucket_service: BucketsService,
    ) -> list[PortalReplicationSummary]:
        rows: list[PortalReplicationSummary] = []
        target_by_zone_bucket: dict[tuple[str, str], list[_PortalReplicationSpaceContext]] = {}
        for space in spaces:
            zonegroup = space.api.storage_endpoint_zonegroup
            if zonegroup:
                target_by_zone_bucket.setdefault((zonegroup, space.bucket_name), []).append(space)
        for source in spaces:
            if not source.api.bucket_replication_allowed:
                continue
            try:
                current = bucket_service.get_bucket_replication(source.bucket_name, source.account)
            except RuntimeError as exc:
                rows.append(
                    PortalReplicationSummary(
                        id=f"bucket-error:{source.api.id}",
                        mode="bucket_level",
                        status="error",
                        source=source.api,
                        zonegroup=source.api.storage_endpoint_zonegroup,
                        message=str(exc),
                    )
                )
                continue
            configuration = current.configuration if isinstance(current.configuration, dict) else {}
            rules = configuration.get("Rules")
            if not isinstance(rules, list):
                continue
            for rule in rules:
                if not isinstance(rule, dict) or rule.get("Status") != "Enabled":
                    continue
                destination = rule.get("Destination") if isinstance(rule.get("Destination"), dict) else {}
                target_bucket = self._portal_replication_bucket_name_from_arn(destination.get("Bucket"))
                if not target_bucket:
                    continue
                target = next(
                    (
                        candidate
                        for candidate in target_by_zone_bucket.get((source.api.storage_endpoint_zonegroup or "", target_bucket), [])
                        if candidate.api.id != source.api.id
                    ),
                    None,
                )
                rows.append(
                    PortalReplicationSummary(
                        id=f"bucket:{source.api.id}:{rule.get('ID') or target_bucket}",
                        mode="bucket_level",
                        status="configured",
                        source=source.api,
                        target=target.api if target is not None else None,
                        target_bucket_name=target_bucket,
                        zonegroup=source.api.storage_endpoint_zonegroup,
                        rule_id=str(rule.get("ID") or ""),
                        role_arn=str(configuration.get("Role") or "") or None,
                        message=None if target is not None else "Destination bucket is not visible in this Portal workspace.",
                    )
                )
        return rows

    def list_replications(
        self,
        user: User,
        account_contexts: list[PortalReplicationAccountContext],
        *,
        bucket_service: BucketsService | None = None,
    ) -> PortalReplicationList:
        bucket_service = bucket_service or BucketsService()
        spaces = self._portal_replication_storage_spaces(user, account_contexts)
        replications = [
            *self._portal_global_replication_rows(spaces),
            *self._portal_bucket_replication_rows(spaces, bucket_service=bucket_service),
        ]
        can_create = any(
            source.api.can_manage
            and source.api.bucket_replication_allowed
            and target.api.bucket_replication_allowed
            and bool(source.api.storage_endpoint_zonegroup)
            and source.api.storage_endpoint_zonegroup == target.api.storage_endpoint_zonegroup
            and source.api.id != target.api.id
            for source in spaces
            for target in spaces
        )
        unavailable_reason = None
        if not spaces:
            unavailable_reason = "No Storage Space is available in this workspace."
        elif not can_create:
            unavailable_reason = "Bucket-level replication requires a Portal manager role and at least two Storage Spaces."
        return PortalReplicationList(
            storage_spaces=[space.api for space in spaces],
            replications=replications,
            can_create=can_create,
            unavailable_reason=unavailable_reason,
        )

    def create_replication(
        self,
        user: User,
        account_contexts: list[PortalReplicationAccountContext],
        payload: PortalReplicationCreate,
        *,
        bucket_service: BucketsService | None = None,
    ) -> PortalReplicationSummary:
        bucket_service = bucket_service or BucketsService()
        spaces = self._portal_replication_storage_spaces(user, account_contexts)
        by_id = {space.api.id: space for space in spaces}
        source = by_id.get(payload.source_storage_space_id)
        target = by_id.get(payload.target_storage_space_id)
        if source is None or target is None:
            raise ValueError("Source and destination Storage Spaces must belong to this Portal workspace.")
        if source.api.id == target.api.id:
            raise ValueError("Choose two different Storage Spaces.")
        if not source.api.can_manage:
            raise PermissionError("Portal manager role is required to configure bucket replication.")
        if not source.api.bucket_replication_allowed or not target.api.bucket_replication_allowed:
            raise ValueError("Bucket-level replication is not allowed on both selected storage endpoints.")
        if not source.api.storage_endpoint_zonegroup or not target.api.storage_endpoint_zonegroup:
            raise ValueError("Both storage endpoints must define a Ceph zonegroup.")
        if source.api.storage_endpoint_zonegroup != target.api.storage_endpoint_zonegroup:
            raise ValueError("Bucket-level replication requires two Storage Spaces in the same Ceph zonegroup.")

        try:
            bucket_service.set_versioning(source.bucket_name, source.account, enabled=True)
            bucket_service.set_versioning(target.bucket_name, target.account, enabled=True)
            rule_id = self._portal_replication_rule_id(source, target)
            configuration = {
                "Role": _PORTAL_REPLICATION_ROLE_ARN,
                "Rules": [
                    {
                        "ID": rule_id,
                        "Status": "Enabled",
                        "Priority": 1,
                        "Filter": {"Prefix": ""},
                        "DeleteMarkerReplication": {"Status": "Disabled"},
                        "Destination": {"Bucket": f"arn:aws:s3:::{target.bucket_name}"},
                    }
                ],
            }
            result = bucket_service.set_bucket_replication(
                source.bucket_name,
                source.account,
                BucketReplicationConfiguration(configuration=configuration),
            )
        except RuntimeError as exc:
            raise RuntimeError(f"Unable to configure bucket replication: {exc}") from exc
        configuration = result.configuration if isinstance(result.configuration, dict) else configuration
        rules = configuration.get("Rules") if isinstance(configuration, dict) else []
        returned_rule = rules[0] if isinstance(rules, list) and rules and isinstance(rules[0], dict) else {}
        return PortalReplicationSummary(
            id=f"bucket:{source.api.id}:{returned_rule.get('ID') or rule_id}",
            mode="bucket_level",
            status="configured",
            source=source.api,
            target=target.api,
            target_bucket_name=target.bucket_name,
            zonegroup=source.api.storage_endpoint_zonegroup,
            rule_id=str(returned_rule.get("ID") or rule_id),
            role_arn=str(configuration.get("Role") or _PORTAL_REPLICATION_ROLE_ARN),
            message="Bucket-level replication configured.",
        )
