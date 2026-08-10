# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import logging
import re
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import exists, func, or_
from sqlalchemy.orm import Session

from app.db import (
    S3UserTag,
    S3User as S3UserModel,
    StorageEndpoint,
    StorageProvider,
    TagDefinition,
    UiGroup,
    UiGroupS3User,
    User,
    UserS3User as UserS3UserModel,
    UserRole,
)
from app.services.resource_deletion_purge_service import ResourceDeletionPurgeService
from app.services.tags_service import TagsService
from app.services.ui_group_avatar_service import UiGroupAvatarService
from app.services.user_avatar_service import UserAvatarService
from app.utils.storage_endpoint_features import resolve_admin_endpoint, resolve_feature_flags
from app.models.s3_user import (
    S3User as S3UserSchema,
    S3UserAccessKey,
    S3UserCreate,
    S3UserGeneratedKey,
    S3UserGroupLink,
    S3UserGroupDetail,
    S3UserImport,
    S3UserSummary,
    S3UserUserLink,
    S3UserUpdate,
)
from app.models.user import UserAssociationDetail
from app.services.rgw_admin import RGWAdminClient, RGWAdminError, get_rgw_admin_client
from app.services import s3_client
from app.utils.rgw_payloads import extract_bucket_list, extract_rgw_user_payload
from app.utils.s3_endpoint import resolve_s3_client_options
from app.utils.quota_stats import bytes_to_gb, extract_quota_limits, parse_positive_limit
from app.utils.size_units import size_to_bytes
from app.utils.name_ordering import name_order_by
from app.utils.usage_stats import extract_usage_stats

logger = logging.getLogger(__name__)


def _extract_max_buckets(payload: Any) -> Optional[int]:
    user_payload = extract_rgw_user_payload(payload)
    return parse_positive_limit(user_payload.get("max_buckets") or (payload.get("max_buckets") if isinstance(payload, dict) else None))


class S3UsersService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.tags = TagsService(db)

    # Helpers
    def _resolve_endpoint(self, storage_endpoint_id: int) -> StorageEndpoint:
        endpoint = self.db.query(StorageEndpoint).filter(StorageEndpoint.id == storage_endpoint_id).first()
        if not endpoint:
            raise ValueError("Storage endpoint not found.")
        if StorageProvider(str(endpoint.provider)) != StorageProvider.CEPH:
            raise ValueError("Only Ceph endpoints are allowed for S3 users.")
        if not resolve_feature_flags(endpoint).admin_enabled:
            raise ValueError("Admin operations are disabled for this endpoint.")
        return endpoint

    @staticmethod
    def _endpoint_for_user(s3_user: S3UserModel) -> StorageEndpoint:
        endpoint = s3_user.storage_endpoint
        if endpoint is None:
            raise ValueError("Storage endpoint not found for S3 user.")
        return endpoint

    def _admin_for_endpoint(self, endpoint: StorageEndpoint) -> RGWAdminClient:
        try:
            admin_endpoint = resolve_admin_endpoint(endpoint)
            if not admin_endpoint:
                raise ValueError("Admin operations are disabled for this endpoint.")
            return get_rgw_admin_client(
                access_key=endpoint.admin_access_key,
                secret_key=endpoint.admin_secret_key,
                endpoint=admin_endpoint,
                region=endpoint.region,
                verify_tls=bool(getattr(endpoint, "verify_tls", True)),
            )
        except Exception as exc:
            raise ValueError(f"Unable to build admin client for {endpoint.name}: {exc}") from exc

    def _admin_for_user(self, s3_user: S3UserModel) -> RGWAdminClient:
        endpoint = self._endpoint_for_user(s3_user)
        return self._admin_for_endpoint(endpoint)

    def _interface_bucket_count(self, s3_user: S3UserModel) -> Optional[int]:
        access_key = (s3_user.rgw_access_key or "").strip()
        secret_key = (s3_user.rgw_secret_key or "").strip()
        if not access_key or not secret_key:
            return None
        try:
            endpoint, region, force_path_style, verify_tls = resolve_s3_client_options(s3_user)
            buckets = s3_client.list_buckets(
                access_key=access_key,
                secret_key=secret_key,
                endpoint=endpoint,
                region=region,
                force_path_style=force_path_style,
                verify_tls=verify_tls,
            )
            return len([bucket for bucket in buckets if isinstance(bucket, dict) and bucket.get("name")])
        except RuntimeError as exc:
            logger.warning("Unable to list buckets for user %s: %s", s3_user.rgw_user_uid, exc)
            return None

    def _user_usage(self, s3_user: S3UserModel) -> tuple[Optional[int], Optional[int], Optional[int]]:
        try:
            endpoint = self._endpoint_for_user(s3_user)
            if not resolve_feature_flags(endpoint).metrics_enabled:
                return None, None, None
            admin = self._admin_for_endpoint(endpoint)
            payload = admin.get_all_buckets(uid=s3_user.rgw_user_uid, with_stats=True)
        except (RGWAdminError, ValueError) as exc:
            logger.warning("Unable to list buckets with stats for user %s: %s", s3_user.rgw_user_uid, exc)
            return None, None, None
        buckets = extract_bucket_list(payload)
        bucket_count = len(buckets)
        total_bytes = 0
        total_objects = 0
        has_bytes = False
        has_objects = False
        for bucket in buckets:
            usage = bucket.get("usage") if isinstance(bucket, dict) else None
            usage_bytes, usage_objects = extract_usage_stats(usage)
            if usage_bytes is not None:
                total_bytes += usage_bytes
                has_bytes = True
            if usage_objects is not None:
                total_objects += usage_objects
                has_objects = True
        return (
            total_bytes if has_bytes else None,
            total_objects if has_objects else None,
            bucket_count,
        )

    def get_user_usage(self, s3_user: S3UserModel) -> tuple[Optional[int], Optional[int], Optional[int]]:
        return self._user_usage(s3_user)

    def _user_quota(
        self,
        s3_user: S3UserModel,
        admin: Optional[RGWAdminClient] = None,
    ) -> tuple[Optional[float], Optional[int]]:
        try:
            rgw_admin = admin or self._admin_for_user(s3_user)
        except ValueError as exc:
            logger.warning("Unable to resolve RGW admin for %s: %s", s3_user.rgw_user_uid, exc)
            return None, None
        try:
            max_size_bytes, max_objects = rgw_admin.get_user_quota(s3_user.rgw_user_uid)
        except RGWAdminError as exc:
            logger.warning("Unable to fetch S3 user quota for %s: %s", s3_user.rgw_user_uid, exc)
            return None, None
        return bytes_to_gb(max_size_bytes), max_objects

    def get_user_quota(self, s3_user: S3UserModel) -> tuple[Optional[float], Optional[int]]:
        return self._user_quota(s3_user)

    def get_user_limits(self, s3_user: S3UserModel) -> tuple[Optional[float], Optional[int], Optional[int]]:
        try:
            rgw_admin = self._admin_for_user(s3_user)
        except ValueError as exc:
            logger.warning("Unable to resolve RGW admin for %s: %s", s3_user.rgw_user_uid, exc)
            return None, None, None
        try:
            payload = rgw_admin.get_user(s3_user.rgw_user_uid, allow_not_found=True) or {}
        except RGWAdminError as exc:
            logger.warning("Unable to fetch S3 user limits for %s: %s", s3_user.rgw_user_uid, exc)
            return None, None, None
        max_size_bytes, max_objects = extract_quota_limits(payload, keys=("user_quota", "quota"))
        if max_size_bytes is None and max_objects is None:
            try:
                max_size_bytes, max_objects = rgw_admin.get_user_quota(s3_user.rgw_user_uid)
            except RGWAdminError as exc:
                logger.warning("Unable to fetch S3 user quota fallback for %s: %s", s3_user.rgw_user_uid, exc)
        return bytes_to_gb(max_size_bytes), max_objects, _extract_max_buckets(payload)

    def _apply_user_quota(
        self,
        s3_user: S3UserModel,
        max_size_gb: Optional[float],
        max_objects: Optional[int],
        max_size_unit: Optional[str] = None,
    ) -> None:
        admin = self._admin_for_user(s3_user)
        try:
            max_size_bytes = size_to_bytes(max_size_gb, max_size_unit)
        except ValueError as exc:
            raise ValueError(str(exc)) from exc
        enabled = max_size_bytes is not None or max_objects is not None
        try:
            response = admin.set_user_quota(
                uid=s3_user.rgw_user_uid,
                max_size_bytes=max_size_bytes,
                max_objects=max_objects,
                enabled=enabled,
            )
        except RGWAdminError as exc:
            raise ValueError(f"RGW user quota update failed: {exc}") from exc
        if response.get("not_found"):
            raise ValueError(f"RGW user not found for quota update: {s3_user.rgw_user_uid}")
        if response.get("not_implemented"):
            raise ValueError("RGW user quota update is not supported on this cluster.")

    def _extract_keys(
        self,
        admin: RGWAdminClient,
        response: Optional[dict],
        *,
        exclude_access_key: Optional[str] = None,
    ) -> tuple[Optional[str], Optional[str]]:
        if not response:
            return None, None
        keys = admin._extract_keys(response)
        if not keys:
            return None, None

        def _normalize(value: Optional[str]) -> Optional[str]:
            return value.strip() if isinstance(value, str) and value.strip() else value

        def _entry_access(entry: dict) -> Optional[str]:
            return _normalize(entry.get("access_key") or entry.get("access-key"))

        def _entry_secret(entry: dict) -> Optional[str]:
            return _normalize(entry.get("secret_key") or entry.get("secret-key"))

        chosen_entry: Optional[dict] = None
        if exclude_access_key:
            normalized_previous = exclude_access_key.strip()
            # Prefer entries with a secret first, then fall back to any new access key.
            for prefer_secret in (True, False):
                for entry in keys:
                    access_value = _entry_access(entry)
                    if not access_value or access_value == normalized_previous:
                        continue
                    has_secret = bool(_entry_secret(entry))
                    if prefer_secret and not has_secret:
                        continue
                    chosen_entry = entry
                    break
                if chosen_entry:
                    break
        if not chosen_entry:
            chosen_entry = keys[0]
        access_key = _entry_access(chosen_entry)
        secret_key = _entry_secret(chosen_entry)
        return access_key, secret_key

    def _slugify_uid(self, name: str) -> str:
        slug = re.sub(r"[^a-zA-Z0-9-]+", "-", name.strip().lower()).strip("-")
        return slug or "s3-user"

    def _get_s3_user(self, user_id: int) -> S3UserModel:
        s3_user = self.db.query(S3UserModel).filter(S3UserModel.id == user_id).first()
        if not s3_user:
            raise ValueError("S3 user not found")
        return s3_user

    def _parse_key_created_at(self, raw_value: Any) -> Optional[datetime]:
        if raw_value is None:
            return None
        if isinstance(raw_value, datetime):
            return raw_value
        if isinstance(raw_value, (int, float)):
            try:
                return datetime.fromtimestamp(float(raw_value), tz=timezone.utc)
            except (OverflowError, ValueError):
                return None
        if isinstance(raw_value, str):
            value = raw_value.strip()
            if not value:
                return None
            try:
                return datetime.fromtimestamp(float(value), tz=timezone.utc)
            except (OverflowError, ValueError):
                pass
            # Support "2023-01-01 12:00:00" and ISO8601 strings
            candidates = [value]
            if " " in value and "T" not in value:
                candidates.append(value.replace(" ", "T"))
            for candidate in candidates:
                try:
                    return datetime.fromisoformat(candidate)
                except ValueError:
                    continue
        return None

    def _extract_key_created_source(self, entry: Optional[dict[str, Any]]) -> Any:
        if not isinstance(entry, dict):
            return None
        return (
            entry.get("create_time")
            or entry.get("create-time")
            or entry.get("create_date")
            or entry.get("create-date")
            or entry.get("created_at")
            or entry.get("create_timestamp")
            or entry.get("timestamp")
        )

    def _parse_key_active(self, raw_value: Any) -> Optional[bool]:
        if raw_value is None:
            return None
        if isinstance(raw_value, bool):
            return raw_value
        if isinstance(raw_value, (int, float)):
            return bool(raw_value)
        if isinstance(raw_value, str):
            normalized = raw_value.strip().lower()
            if normalized in {"1", "true", "enabled", "active"}:
                return True
            if normalized in {"0", "false", "disabled", "inactive", "suspended"}:
                return False
        return None

    def _is_active_status(self, status: Optional[str]) -> Optional[bool]:
        if status is None:
            return None
        normalized = status.strip().lower()
        if not normalized:
            return None
        if normalized in {"active", "enabled", "enable"}:
            return True
        if normalized in {"inactive", "disabled", "disable", "suspended"}:
            return False
        return None

    def _ensure_links(self, s3_user: S3UserModel, target_ids: list[int]) -> None:
        existing_links = self.db.query(UserS3UserModel).filter(UserS3UserModel.s3_user_id == s3_user.id).all()
        existing_ids = {link.user_id for link in existing_links}
        desired_ids = set(target_ids)
        to_remove = existing_ids - desired_ids
        to_add = desired_ids - existing_ids
        if to_remove:
            (
                self.db.query(UserS3UserModel)
                .filter(
                    UserS3UserModel.s3_user_id == s3_user.id,
                    UserS3UserModel.user_id.in_(to_remove),
                )
                .delete(synchronize_session=False)
            )
        if to_add:
            users = self.db.query(User).filter(User.id.in_(to_add)).all()
            found_ids = {user.id for user in users}
            missing = to_add - found_ids
            if missing:
                missing_ids = ", ".join(str(mid) for mid in sorted(missing))
                raise ValueError(f"Users not found: {missing_ids}")
            for user in users:
                if user.role not in {UserRole.UI_SUPERADMIN.value, UserRole.UI_ADMIN.value, UserRole.UI_USER.value}:
                    user.role = UserRole.UI_USER.value
                    self.db.add(user)
                self.db.add(UserS3UserModel(user_id=user.id, s3_user_id=s3_user.id))

    def _ensure_user_link_objects(
        self,
        s3_user: S3UserModel,
        links: list[S3UserUserLink],
    ) -> None:
        desired = {int(link.user_id): link for link in links}
        self._ensure_links(s3_user, list(desired))
        self.db.flush()
        for row in self.db.query(UserS3UserModel).filter(
            UserS3UserModel.s3_user_id == s3_user.id,
            UserS3UserModel.user_id.in_(desired),
        ).all():
            row.allow_manager_browser_data_access = bool(
                desired[row.user_id].allow_manager_browser_data_access
            )
            self.db.add(row)

    def _serialize_s3_user(
        self,
        row: S3UserModel,
        link_map: dict[int, list[int]],
        user_details_map: dict[int, list[UserAssociationDetail]],
        group_ids_map: dict[int, list[int]],
        group_details_map: dict[int, list[S3UserGroupDetail]],
        *,
        include_quota: bool = True,
    ) -> S3UserSchema:
        endpoint = self._endpoint_for_user(row)
        quota_max_size_gb = None
        quota_max_objects = None
        if include_quota:
            quota_max_size_gb, quota_max_objects = self._user_quota(row)
        return S3UserSchema(
            id=row.id,
            name=row.name,
            rgw_user_uid=row.rgw_user_uid,
            email=row.email,
            created_at=row.created_at,
            user_ids=link_map.get(row.id, []),
            user_details=user_details_map.get(row.id, []),
            group_ids=group_ids_map.get(row.id, []),
            group_details=group_details_map.get(row.id, []),
            quota_max_size_gb=quota_max_size_gb,
            quota_max_objects=quota_max_objects,
            storage_endpoint_id=endpoint.id,
            storage_endpoint_name=endpoint.name,
            storage_endpoint_url=endpoint.endpoint_url,
            allow_bucket_quota_management=bool(row.allow_bucket_quota_management),
            allow_access_key_management=bool(row.allow_access_key_management),
            allow_managed_private_connection_provisioning=bool(row.allow_managed_private_connection_provisioning),
            tags=self.tags.get_s3_user_tags(row),
        )

    def _load_user_links(
        self,
        s3_user_ids: list[int],
    ) -> tuple[dict[int, list[int]], dict[int, list[UserAssociationDetail]]]:
        if not s3_user_ids:
            return {}, {}
        rows = (
            self.db.query(
                UserS3UserModel.s3_user_id,
                User,
                UserS3UserModel.allow_manager_browser_data_access,
            )
            .join(User, User.id == UserS3UserModel.user_id)
            .filter(UserS3UserModel.s3_user_id.in_(s3_user_ids))
            .order_by(UserS3UserModel.s3_user_id.asc(), User.email.asc(), User.id.asc())
            .all()
        )
        user_ids_by_s3_user: dict[int, list[int]] = {}
        user_details_by_s3_user: dict[int, list[UserAssociationDetail]] = {}
        avatar_service = UserAvatarService(self.db)
        for s3_user_id, user, allow_manager_browser_data_access in rows:
            normalized_s3_user_id = int(s3_user_id)
            normalized_user_id = int(user.id)
            user_ids_by_s3_user.setdefault(normalized_s3_user_id, []).append(normalized_user_id)
            user_details_by_s3_user.setdefault(normalized_s3_user_id, []).append(
                UserAssociationDetail(
                    id=normalized_user_id,
                    email=user.email,
                    full_name=user.full_name,
                    display_name=user.display_name,
                    avatar=avatar_service.descriptor(user),
                    allow_manager_browser_data_access=bool(
                        allow_manager_browser_data_access
                    ),
                )
            )
        return user_ids_by_s3_user, user_details_by_s3_user

    def _load_group_links(
        self,
        s3_user_ids: list[int],
    ) -> tuple[dict[int, list[int]], dict[int, list[S3UserGroupDetail]]]:
        if not s3_user_ids:
            return {}, {}
        rows = (
            self.db.query(
                UiGroupS3User.s3_user_id,
                UiGroup,
                UiGroupS3User.allow_manager_browser_data_access,
            )
            .join(UiGroup, UiGroup.id == UiGroupS3User.group_id)
            .filter(UiGroupS3User.s3_user_id.in_(s3_user_ids))
            .order_by(UiGroupS3User.s3_user_id.asc(), UiGroup.name.asc(), UiGroup.id.asc())
            .all()
        )
        group_ids_by_user: dict[int, list[int]] = {}
        group_details_by_user: dict[int, list[S3UserGroupDetail]] = {}
        avatar_service = UiGroupAvatarService(self.db)
        for s3_user_id, group, allow_manager_browser_data_access in rows:
            normalized_user_id = int(s3_user_id)
            normalized_group_id = int(group.id)
            group_ids_by_user.setdefault(normalized_user_id, []).append(normalized_group_id)
            group_details_by_user.setdefault(normalized_user_id, []).append(
                S3UserGroupDetail(
                    id=normalized_group_id,
                    name=group.name,
                    avatar=avatar_service.descriptor(group),
                    allow_manager_browser_data_access=bool(
                        allow_manager_browser_data_access
                    ),
                )
            )
        return group_ids_by_user, group_details_by_user

    def list_users(self, include_quota: bool = False) -> list[S3UserSchema]:
        rows = self.db.query(S3UserModel).order_by(*name_order_by(S3UserModel)).all()
        user_ids = [row.id for row in rows]
        link_map, user_details_map = self._load_user_links(user_ids)
        group_ids_map, group_details_map = self._load_group_links(user_ids)
        return [
            self._serialize_s3_user(
                row,
                link_map,
                user_details_map,
                group_ids_map,
                group_details_map,
                include_quota=include_quota,
            )
            for row in rows
        ]

    def list_users_minimal(self) -> list[S3UserSummary]:
        rows = self.db.query(S3UserModel).order_by(*name_order_by(S3UserModel)).all()
        summaries: list[S3UserSummary] = []
        for row in rows:
            endpoint = self._endpoint_for_user(row)
            summaries.append(
                S3UserSummary(
                    id=row.id,
                    name=row.name,
                    rgw_user_uid=row.rgw_user_uid,
                    storage_endpoint_id=endpoint.id,
                    storage_endpoint_name=endpoint.name,
                    storage_endpoint_url=endpoint.endpoint_url,
                    allow_bucket_quota_management=bool(row.allow_bucket_quota_management),
                    allow_access_key_management=bool(row.allow_access_key_management),
                    allow_managed_private_connection_provisioning=bool(row.allow_managed_private_connection_provisioning),
                    tags=self.tags.get_s3_user_tags(row),
                )
            )
        return summaries

    def paginate_users(
        self,
        page: int,
        page_size: int,
        search: Optional[str] = None,
        sort_field: str = "name",
        sort_direction: str = "asc",
        include_quota: bool = False,
    ) -> tuple[list[S3UserSchema], int]:
        query = self.db.query(S3UserModel)
        search_value = search.strip() if isinstance(search, str) else ""
        if search_value:
            pattern = f"%{search_value}%"
            tag_match = (
                exists()
                .where(S3UserTag.s3_user_id == S3UserModel.id)
                .where(TagDefinition.id == S3UserTag.tag_definition_id)
                .where(TagDefinition.label.ilike(pattern))
            )
            query = (
                query.outerjoin(UserS3UserModel, S3UserModel.id == UserS3UserModel.s3_user_id)
                .outerjoin(User, UserS3UserModel.user_id == User.id)
                .outerjoin(UiGroupS3User, S3UserModel.id == UiGroupS3User.s3_user_id)
                .outerjoin(UiGroup, UiGroupS3User.group_id == UiGroup.id)
            )
            query = query.filter(
                or_(
                    S3UserModel.name.ilike(pattern),
                    S3UserModel.rgw_user_uid.ilike(pattern),
                    func.coalesce(S3UserModel.email, "").ilike(pattern),
                    func.coalesce(User.email, "").ilike(pattern),
                    func.coalesce(UiGroup.name, "").ilike(pattern),
                    tag_match,
                )
            )
            query = query.distinct()
        sort_map = {
            "name": S3UserModel.name,
            "uid": S3UserModel.rgw_user_uid,
            "email": S3UserModel.email,
            "created_at": S3UserModel.created_at,
        }
        requested_sort = sort_field if sort_field in sort_map else "name"
        descending = sort_direction.lower() == "desc"
        total_query = query.with_entities(func.count(func.distinct(S3UserModel.id)))
        total = total_query.scalar() or 0
        offset = max(page - 1, 0) * page_size
        if requested_sort == "name":
            if descending:
                query = query.order_by(
                    func.lower(S3UserModel.name).desc(),
                    S3UserModel.name.desc(),
                    S3UserModel.id.desc(),
                )
            else:
                query = query.order_by(*name_order_by(S3UserModel))
        else:
            sort_column = sort_map[requested_sort]
            if descending:
                query = query.order_by(sort_column.desc(), S3UserModel.id.desc())
            else:
                query = query.order_by(sort_column.asc(), S3UserModel.id.asc())
        rows = query.offset(offset).limit(page_size).all()
        user_ids = [row.id for row in rows]
        link_map, user_details_map = self._load_user_links(user_ids)
        group_ids_map, group_details_map = self._load_group_links(user_ids)
        return [
            self._serialize_s3_user(
                row,
                link_map,
                user_details_map,
                group_ids_map,
                group_details_map,
                include_quota=include_quota,
            )
            for row in rows
        ], total

    def get_user(
        self,
        user_id: int,
        include_buckets: bool = False,
        include_quota: bool = False,
    ) -> S3UserSchema:
        s3_user = self._get_s3_user(user_id)
        user_ids_map, user_details_map = self._load_user_links([s3_user.id])
        user_ids = user_ids_map.get(s3_user.id, [])
        group_ids_map, group_details_map = self._load_group_links([s3_user.id])
        endpoint = self._endpoint_for_user(s3_user)
        quota_max_size_gb = None
        quota_max_objects = None
        if include_quota:
            quota_max_size_gb, quota_max_objects = self._user_quota(s3_user)
        bucket_count = self._interface_bucket_count(s3_user) if include_buckets else None
        return S3UserSchema(
            id=s3_user.id,
            name=s3_user.name,
            rgw_user_uid=s3_user.rgw_user_uid,
            email=s3_user.email,
            created_at=s3_user.created_at,
            user_ids=user_ids,
            user_details=user_details_map.get(s3_user.id, []),
            group_ids=group_ids_map.get(s3_user.id, []),
            group_details=group_details_map.get(s3_user.id, []),
            quota_max_size_gb=quota_max_size_gb,
            quota_max_objects=quota_max_objects,
            storage_endpoint_id=endpoint.id,
            storage_endpoint_name=endpoint.name,
            storage_endpoint_url=endpoint.endpoint_url,
            bucket_count=bucket_count,
            allow_bucket_quota_management=bool(s3_user.allow_bucket_quota_management),
            allow_access_key_management=bool(s3_user.allow_access_key_management),
            allow_managed_private_connection_provisioning=bool(s3_user.allow_managed_private_connection_provisioning),
            tags=self.tags.get_s3_user_tags(s3_user),
        )

    def create_user(self, payload: S3UserCreate) -> S3UserSchema:
        uid = payload.uid.strip() if payload.uid else self._slugify_uid(payload.name)
        existing = (
            self.db.query(S3UserModel)
            .filter(S3UserModel.rgw_user_uid == uid)
            .first()
        )
        if existing:
            raise ValueError("An S3 user with this UID already exists")
        endpoint = self._resolve_endpoint(payload.storage_endpoint_id)
        admin = self._admin_for_endpoint(endpoint)
        try:
            response = admin.create_user(
                uid=uid,
                display_name=payload.name,
                email=payload.email or "",
            )
        except RGWAdminError as exc:
            raise ValueError(f"RGW user creation failed: {exc}") from exc
        access_key, secret_key = self._extract_keys(admin, response)
        if not access_key or not secret_key:
            try:
                key_response = admin.create_access_key(uid, tenant=None)
            except RGWAdminError as exc:
                raise ValueError(f"Unable to obtain RGW access keys: {exc}") from exc
            access_key, secret_key = self._extract_keys(admin, key_response)
        if not access_key or not secret_key:
            raise ValueError("RGW did not return access credentials for the new user")
        s3_user = S3UserModel(
            name=payload.name,
            rgw_user_uid=uid,
            email=payload.email,
            rgw_access_key=access_key,
            rgw_secret_key=secret_key,
            storage_endpoint_id=endpoint.id,
        )
        self.db.add(s3_user)
        self.db.flush()
        self.tags.replace_s3_user_tags(s3_user, payload.tags)

        if payload.quota_max_size_gb is not None or payload.quota_max_objects is not None:
            self._apply_user_quota(
                s3_user,
                payload.quota_max_size_gb,
                payload.quota_max_objects,
                payload.quota_max_size_unit,
            )

        self.db.commit()
        self.db.refresh(s3_user)
        quota_max_size_gb, quota_max_objects = self._user_quota(s3_user, admin)
        return S3UserSchema(
            id=s3_user.id,
            name=s3_user.name,
            rgw_user_uid=s3_user.rgw_user_uid,
            email=s3_user.email,
            created_at=s3_user.created_at,
            user_ids=[],
            group_ids=[],
            group_details=[],
            quota_max_size_gb=quota_max_size_gb,
            quota_max_objects=quota_max_objects,
            storage_endpoint_id=endpoint.id,
            storage_endpoint_name=endpoint.name,
            storage_endpoint_url=endpoint.endpoint_url,
            allow_bucket_quota_management=bool(s3_user.allow_bucket_quota_management),
            allow_access_key_management=bool(s3_user.allow_access_key_management),
            allow_managed_private_connection_provisioning=bool(s3_user.allow_managed_private_connection_provisioning),
            tags=self.tags.get_s3_user_tags(s3_user),
        )

    def import_users(self, items: list[S3UserImport]) -> list[S3UserSchema]:
        created: list[S3UserSchema] = []
        for payload in items:
            uid = payload.uid.strip()
            if not uid:
                raise ValueError("uid is required")
            endpoint = self._resolve_endpoint(payload.storage_endpoint_id)
            admin = self._admin_for_endpoint(endpoint)
            exists = (
                self.db.query(S3UserModel)
                .filter(S3UserModel.rgw_user_uid == uid)
                .first()
            )
            if exists:
                continue
            try:
                user_info = admin.get_user(uid, tenant=None, allow_not_found=True)
            except RGWAdminError as exc:
                raise ValueError(f"RGW lookup failed for {uid}: {exc}") from exc
            if not user_info or user_info.get("not_found"):
                raise ValueError(f"RGW user {uid} not found")
            try:
                key_resp = admin.create_access_key(uid, tenant=None)
            except RGWAdminError as exc:
                raise ValueError(f"Unable to create access key for {uid}: {exc}") from exc
            access_key, secret_key = self._extract_keys(admin, key_resp)
            if not access_key or not secret_key:
                raise ValueError(f"RGW did not return access credentials for {uid}")
            name = payload.name or user_info.get("display_name") or uid
            email = payload.email or user_info.get("email")
            s3_user = S3UserModel(
                name=name,
                rgw_user_uid=uid,
                email=email,
                rgw_access_key=access_key,
                rgw_secret_key=secret_key,
                storage_endpoint_id=endpoint.id,
            )
            self.db.add(s3_user)
            self.db.flush()
            quota_max_size_gb, quota_max_objects = self._user_quota(s3_user, admin)
            created.append(
                S3UserSchema(
                    id=s3_user.id,
                    name=s3_user.name,
                    rgw_user_uid=s3_user.rgw_user_uid,
                    email=s3_user.email,
                    created_at=s3_user.created_at,
                    user_ids=[],
                    group_ids=[],
                    group_details=[],
                    quota_max_size_gb=quota_max_size_gb,
                    quota_max_objects=quota_max_objects,
                    storage_endpoint_id=endpoint.id,
                    storage_endpoint_name=endpoint.name,
                    storage_endpoint_url=endpoint.endpoint_url,
                    allow_bucket_quota_management=bool(s3_user.allow_bucket_quota_management),
                    allow_access_key_management=bool(s3_user.allow_access_key_management),
                    allow_managed_private_connection_provisioning=bool(s3_user.allow_managed_private_connection_provisioning),
                    tags=[],
                )
            )
        self.db.commit()
        return created

    def update_user(self, user_id: int, payload: S3UserUpdate) -> S3UserSchema:
        s3_user = self.db.query(S3UserModel).filter(S3UserModel.id == user_id).first()
        if not s3_user:
            raise ValueError("S3 user not found")
        if payload.name is not None:
            s3_user.name = payload.name
        if payload.email is not None:
            s3_user.email = payload.email
        if payload.user_links is not None:
            self._ensure_user_link_objects(s3_user, payload.user_links)
        elif payload.user_ids is not None:
            self._ensure_links(s3_user, payload.user_ids)
        if payload.group_links is not None:
            self._ensure_group_link_objects(s3_user, payload.group_links)
        elif payload.group_ids is not None:
            self._ensure_group_links(s3_user, payload.group_ids)
        if payload.tags is not None:
            self.tags.replace_s3_user_tags(s3_user, payload.tags)
        if payload.allow_bucket_quota_management is not None:
            s3_user.allow_bucket_quota_management = bool(payload.allow_bucket_quota_management)
        if payload.allow_access_key_management is not None:
            s3_user.allow_access_key_management = bool(payload.allow_access_key_management)
        if payload.allow_managed_private_connection_provisioning is not None:
            s3_user.allow_managed_private_connection_provisioning = bool(
                payload.allow_managed_private_connection_provisioning
            )

        if {"quota_max_size_gb", "quota_max_objects"} & payload.model_fields_set:
            self._apply_user_quota(
                s3_user,
                payload.quota_max_size_gb,
                payload.quota_max_objects,
                payload.quota_max_size_unit,
            )

        self.db.add(s3_user)
        self.db.commit()
        self.db.refresh(s3_user)
        user_ids_map, user_details_map = self._load_user_links([s3_user.id])
        user_ids = user_ids_map.get(s3_user.id, [])
        group_ids_map, group_details_map = self._load_group_links([s3_user.id])
        endpoint = self._endpoint_for_user(s3_user)
        quota_max_size_gb, quota_max_objects = self._user_quota(s3_user)
        return S3UserSchema(
            id=s3_user.id,
            name=s3_user.name,
            rgw_user_uid=s3_user.rgw_user_uid,
            email=s3_user.email,
            created_at=s3_user.created_at,
            user_ids=user_ids,
            user_details=user_details_map.get(s3_user.id, []),
            group_ids=group_ids_map.get(s3_user.id, []),
            group_details=group_details_map.get(s3_user.id, []),
            quota_max_size_gb=quota_max_size_gb,
            quota_max_objects=quota_max_objects,
            storage_endpoint_id=endpoint.id,
            storage_endpoint_name=endpoint.name,
            storage_endpoint_url=endpoint.endpoint_url,
            allow_bucket_quota_management=bool(s3_user.allow_bucket_quota_management),
            allow_access_key_management=bool(s3_user.allow_access_key_management),
            allow_managed_private_connection_provisioning=bool(s3_user.allow_managed_private_connection_provisioning),
            tags=self.tags.get_s3_user_tags(s3_user),
        )

    def _ensure_group_links(self, s3_user: S3UserModel, group_ids: list[int]) -> None:
        desired_ids = sorted({int(group_id) for group_id in group_ids if group_id is not None})
        if desired_ids:
            found = {row[0] for row in self.db.query(UiGroup.id).filter(UiGroup.id.in_(desired_ids)).all()}
            missing = set(desired_ids) - found
            if missing:
                missing_str = ", ".join(str(mid) for mid in sorted(missing))
                raise ValueError(f"UI groups not found: {missing_str}")
        existing = self.db.query(UiGroupS3User).filter(UiGroupS3User.s3_user_id == s3_user.id).all()
        existing_ids = {link.group_id for link in existing}
        desired_set = set(desired_ids)
        for group_id in existing_ids - desired_set:
            self.db.query(UiGroupS3User).filter(
                UiGroupS3User.s3_user_id == s3_user.id,
                UiGroupS3User.group_id == group_id,
            ).delete(synchronize_session=False)
        for group_id in desired_set - existing_ids:
            self.db.add(UiGroupS3User(group_id=group_id, s3_user_id=s3_user.id))

    def _ensure_group_link_objects(
        self,
        s3_user: S3UserModel,
        links: list[S3UserGroupLink],
    ) -> None:
        desired = {int(link.group_id): link for link in links}
        self._ensure_group_links(s3_user, list(desired))
        self.db.flush()
        for row in self.db.query(UiGroupS3User).filter(
            UiGroupS3User.s3_user_id == s3_user.id,
            UiGroupS3User.group_id.in_(desired),
        ).all():
            row.allow_manager_browser_data_access = bool(
                desired[row.group_id].allow_manager_browser_data_access
            )
            self.db.add(row)

    def rotate_keys(self, user_id: int) -> S3UserSchema:
        s3_user = self._get_s3_user(user_id)
        previous_access_key = s3_user.rgw_access_key
        admin = self._admin_for_user(s3_user)
        try:
            response = admin.create_access_key(s3_user.rgw_user_uid, tenant=None)
        except RGWAdminError as exc:
            raise ValueError(f"Unable to rotate keys: {exc}") from exc
        access_key, secret_key = self._extract_keys(
            admin,
            response,
            exclude_access_key=previous_access_key,
        )
        if not access_key or not secret_key:
            raise ValueError("RGW did not return new keys")
        if previous_access_key and previous_access_key != access_key:
            try:
                admin.delete_access_key(
                    s3_user.rgw_user_uid,
                    previous_access_key,
                    tenant=None,
                )
            except RGWAdminError as exc:
                # try to delete the newly created key to avoid leaking unused credentials
                try:
                    admin.delete_access_key(
                        s3_user.rgw_user_uid,
                        access_key,
                        tenant=None,
                    )
                except RGWAdminError:
                    logger.warning("Unable to clean up new key %s after rotation failure", access_key)
                raise ValueError(f"Unable to remove previous access key: {exc}") from exc
        s3_user.rgw_access_key = access_key
        s3_user.rgw_secret_key = secret_key
        self.db.add(s3_user)
        self.db.commit()
        self.db.refresh(s3_user)
        endpoint = self._endpoint_for_user(s3_user)
        user_ids_map, user_details_map = self._load_user_links([s3_user.id])
        user_ids = user_ids_map.get(s3_user.id, [])
        group_ids_map, group_details_map = self._load_group_links([s3_user.id])
        quota_max_size_gb, quota_max_objects = self._user_quota(s3_user, admin)
        return S3UserSchema(
            id=s3_user.id,
            name=s3_user.name,
            rgw_user_uid=s3_user.rgw_user_uid,
            email=s3_user.email,
            created_at=s3_user.created_at,
            user_ids=user_ids,
            user_details=user_details_map.get(s3_user.id, []),
            group_ids=group_ids_map.get(s3_user.id, []),
            group_details=group_details_map.get(s3_user.id, []),
            quota_max_size_gb=quota_max_size_gb,
            quota_max_objects=quota_max_objects,
            storage_endpoint_id=endpoint.id,
            storage_endpoint_name=endpoint.name,
            storage_endpoint_url=endpoint.endpoint_url,
            allow_bucket_quota_management=bool(s3_user.allow_bucket_quota_management),
            allow_access_key_management=bool(s3_user.allow_access_key_management),
            allow_managed_private_connection_provisioning=bool(s3_user.allow_managed_private_connection_provisioning),
            tags=self.tags.get_s3_user_tags(s3_user),
        )

    def list_keys(self, user_id: int) -> list[S3UserAccessKey]:
        s3_user = self._get_s3_user(user_id)
        admin = self._admin_for_user(s3_user)
        try:
            user_info = admin.get_user(
                s3_user.rgw_user_uid,
                allow_not_found=True,
            )
        except RGWAdminError as exc:
            raise ValueError(f"Unable to list keys: {exc}") from exc
        if not user_info or user_info.get("not_found"):
            raise ValueError("RGW user not found")
        entries = admin._extract_keys(user_info)
        result: list[S3UserAccessKey] = []
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            access_key = entry.get("access_key") or entry.get("access-key")
            if not access_key:
                continue
            status_value = entry.get("status") or entry.get("key_status") or entry.get("state")
            active_value = self._parse_key_active(entry.get("active"))
            is_active = active_value if active_value is not None else self._is_active_status(status_value)
            if is_active is None:
                is_active = True
            if status_value is None:
                status_value = "enabled" if is_active else "disabled"
            created_source = self._extract_key_created_source(entry)
            result.append(
                S3UserAccessKey(
                    access_key_id=access_key,
                    status=status_value,
                    created_at=self._parse_key_created_at(created_source),
                    is_ui_managed=access_key == s3_user.rgw_access_key,
                    is_active=is_active,
                )
            )
        return result

    def create_access_key_entry(self, user_id: int) -> S3UserGeneratedKey:
        s3_user = self._get_s3_user(user_id)
        admin = self._admin_for_user(s3_user)
        existing_access_keys: set[str] = set()
        try:
            before_payload = admin.get_user(
                s3_user.rgw_user_uid,
                allow_not_found=True,
            )
            if before_payload and not before_payload.get("not_found"):
                for existing_entry in admin._extract_keys(before_payload):
                    if not isinstance(existing_entry, dict):
                        continue
                    existing_access = str(
                        existing_entry.get("access_key") or existing_entry.get("access-key") or ""
                    ).strip()
                    if existing_access:
                        existing_access_keys.add(existing_access)
        except RGWAdminError:
            # Creation can still succeed even if pre-read fails.
            pass
        try:
            response = admin.create_access_key(s3_user.rgw_user_uid, tenant=None)
        except RGWAdminError as exc:
            raise ValueError(f"Unable to create access key: {exc}") from exc
        entries = admin._extract_keys(response)
        if not entries:
            raise ValueError("RGW did not return access credentials")

        def _entry_access(entry: dict[str, Any]) -> Optional[str]:
            access_value = entry.get("access_key") or entry.get("access-key")
            normalized = str(access_value or "").strip()
            return normalized or None

        def _entry_secret(entry: dict[str, Any]) -> Optional[str]:
            secret_value = entry.get("secret_key") or entry.get("secret-key")
            normalized = str(secret_value or "").strip()
            return normalized or None

        entry: Optional[dict[str, Any]] = None
        for candidate in entries:
            if not isinstance(candidate, dict):
                continue
            access_value = _entry_access(candidate)
            secret_value = _entry_secret(candidate)
            if not access_value or not secret_value:
                continue
            if access_value not in existing_access_keys:
                entry = candidate
                break
        if entry is None:
            for candidate in entries:
                if isinstance(candidate, dict) and _entry_secret(candidate):
                    entry = candidate
                    break
        if entry is None and isinstance(entries[0], dict):
            entry = entries[0]
        if not isinstance(entry, dict):
            raise ValueError("RGW did not return structured key data")
        access_key = _entry_access(entry)
        secret_key = _entry_secret(entry)
        if not access_key or not secret_key:
            raise ValueError("RGW did not return full access credentials")
        created_source = self._extract_key_created_source(entry)
        return S3UserGeneratedKey(
            access_key_id=access_key,
            secret_access_key=secret_key,
            created_at=self._parse_key_created_at(created_source),
        )

    def set_key_status(self, user_id: int, access_key: str, active: bool) -> S3UserAccessKey:
        s3_user = self._get_s3_user(user_id)
        admin = self._admin_for_user(s3_user)
        normalized = (access_key or "").strip()
        if not normalized:
            raise ValueError("access_key is required")
        if normalized == s3_user.rgw_access_key:
            raise ValueError("Cannot disable the interface access key; rotate it instead")
        try:
            admin.set_access_key_status(
                s3_user.rgw_user_uid,
                normalized,
                active,
                tenant=None,
            )
        except RGWAdminError as exc:
            raise ValueError(f"Unable to update access key status: {exc}") from exc
        keys = self.list_keys(user_id)
        for key in keys:
            if key.access_key_id == normalized:
                return key
        raise ValueError("Access key not found after status update")

    def delete_key(self, user_id: int, access_key: str) -> None:
        s3_user = self._get_s3_user(user_id)
        admin = self._admin_for_user(s3_user)
        normalized = (access_key or "").strip()
        if not normalized:
            raise ValueError("access_key is required")
        if normalized == s3_user.rgw_access_key:
            raise ValueError("Cannot delete the interface access key; rotate it instead")
        try:
            admin.delete_access_key(
                s3_user.rgw_user_uid,
                normalized,
                tenant=None,
            )
        except RGWAdminError as exc:
            raise ValueError(f"Unable to delete access key: {exc}") from exc

    def delete_user(self, user_id: int, delete_rgw: bool = False) -> None:
        s3_user = self.db.query(S3UserModel).filter(S3UserModel.id == user_id).first()
        if not s3_user:
            raise ValueError("S3 user not found")
        admin = self._admin_for_user(s3_user)
        if delete_rgw:
            bucket_count = self._interface_bucket_count(s3_user)
            if bucket_count is None:
                raise ValueError("Unable to verify owned buckets; cannot delete the RGW user.")
            if bucket_count > 0:
                raise ValueError(f"RGW user still owns {bucket_count} bucket(s); delete them first.")
            try:
                admin.delete_user(s3_user.rgw_user_uid, tenant=None)
            except RGWAdminError as exc:
                raise ValueError(f"Unable to delete RGW user {s3_user.rgw_user_uid}: {exc}") from exc
        else:
            key_to_delete = (s3_user.rgw_access_key or "").strip()
            if key_to_delete:
                try:
                    admin.delete_access_key(s3_user.rgw_user_uid, key_to_delete, tenant=None)
                except RGWAdminError as exc:
                    raise ValueError(f"Unable to delete interface access key: {exc}") from exc
        (
            self.db.query(UserS3UserModel)
            .filter(UserS3UserModel.s3_user_id == s3_user.id)
            .delete(synchronize_session=False)
        )
        self.db.query(UiGroupS3User).filter(UiGroupS3User.s3_user_id == s3_user.id).delete(
            synchronize_session=False
        )
        ResourceDeletionPurgeService(self.db).purge_s3_user_derived_data(s3_user.id)
        self.db.delete(s3_user)
        self.db.flush()
        self.tags.cleanup_orphan_definitions()
        self.db.commit()

def get_s3_users_service(db: Session) -> S3UsersService:
    return S3UsersService(db)
