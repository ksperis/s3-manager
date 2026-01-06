# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from sqlalchemy.orm import Session
import logging
from datetime import datetime

from app.db_models import AccountRole, S3Account, User, UserS3Account, StorageEndpoint, StorageProvider
from app.models.s3_account import (
    AccountUserLink,
    S3Account as S3AccountSchema,
    S3AccountCreate,
    S3AccountImport,
    S3AccountSummary,
    S3AccountUpdate,
)
from app.services.rgw_admin import RGWAdminClient, get_rgw_admin_client, RGWAdminError
from app.services.storage_endpoints_service import StorageEndpointsService
from app.utils.storage_endpoint_features import (
    features_to_capabilities,
    normalize_features_config,
    resolve_admin_endpoint,
    resolve_feature_flags,
)
from app.core.security import get_password_hash
from app.db_models import UserRole
import random
from typing import Optional, Any
from app.utils.rgw import extract_bucket_list, normalize_rgw_identifier, resolve_admin_uid
from app.utils.usage_stats import extract_usage_stats


logger = logging.getLogger(__name__)


class S3AccountsService:
    def __init__(
        self,
        db: Session,
        rgw_admin_client: Optional[RGWAdminClient] = None,
        allow_missing_admin: bool = False,
    ) -> None:
        self.db = db
        self.storage_endpoints = StorageEndpointsService(db)
        if rgw_admin_client is not None:
            self.rgw_admin = rgw_admin_client
        elif allow_missing_admin:
            self.rgw_admin = None
        else:
            self.rgw_admin = self._default_admin_client()
        self._topics_cache: dict[str, tuple[Optional[int], Optional[list[str]]]] = {}
        self._topics_global_cache: Optional[dict[str, list[str]]] = None

    def _default_admin_client(self) -> Optional[RGWAdminClient]:
        try:
            self.storage_endpoints.ensure_default_endpoint()
            endpoint = (
                self.db.query(StorageEndpoint)
                .filter(StorageEndpoint.is_default.is_(True))
                .order_by(StorageEndpoint.id.asc())
                .first()
            )
            if not endpoint:
                return None
            return self._admin_for_endpoint(endpoint, allow_missing=True)
        except Exception as exc:
            logger.warning("RGW admin client unavailable: %s", exc)
            return None

    def _endpoint_capabilities(self, endpoint: Optional[StorageEndpoint]) -> Optional[dict[str, bool]]:
        if not endpoint:
            return None
        features = normalize_features_config(endpoint.provider, endpoint.features_config)
        return features_to_capabilities(features)

    def _resolve_storage_endpoint(self, storage_endpoint_id: Optional[int], require_ceph: bool = False) -> StorageEndpoint:
        if storage_endpoint_id:
            endpoint = self.db.query(StorageEndpoint).filter(StorageEndpoint.id == storage_endpoint_id).first()
            if not endpoint:
                raise ValueError("Storage endpoint introuvable.")
            if require_ceph and StorageProvider(str(endpoint.provider)) != StorageProvider.CEPH:
                raise ValueError("Cet endpoint n'est pas de type Ceph.")
            return endpoint
        # Ensure default exists, then fetch it
        self.storage_endpoints.ensure_default_endpoint()
        endpoint = (
            self.db.query(StorageEndpoint)
            .filter(StorageEndpoint.is_default.is_(True))
            .order_by(StorageEndpoint.id.asc())
            .first()
        )
        if not endpoint:
            raise ValueError("Aucun endpoint de stockage par défaut n'est disponible.")
        if require_ceph and StorageProvider(str(endpoint.provider)) != StorageProvider.CEPH:
            raise ValueError("Aucun endpoint Ceph disponible.")
        return endpoint

    def _admin_for_endpoint(self, endpoint: StorageEndpoint, allow_missing: bool = False) -> Optional[RGWAdminClient]:
        if StorageProvider(str(endpoint.provider)) != StorageProvider.CEPH:
            if allow_missing:
                return None
            raise ValueError("Cet endpoint ne supporte pas les opérations Ceph admin.")
        admin_endpoint = resolve_admin_endpoint(endpoint)
        if not admin_endpoint:
            if allow_missing:
                return None
            raise ValueError("Les opérations admin sont désactivées pour cet endpoint.")
        try:
            return get_rgw_admin_client(
                access_key=endpoint.admin_access_key,
                secret_key=endpoint.admin_secret_key,
                endpoint=admin_endpoint,
                region=endpoint.region,
            )
        except Exception as exc:
            if allow_missing:
                logger.warning("Unable to build RGW admin client for endpoint %s: %s", endpoint.name, exc)
                return None
            raise

    def _admin_for_account(self, account: S3Account, allow_missing: bool = False) -> Optional[RGWAdminClient]:
        endpoint = None
        try:
            endpoint = self._resolve_storage_endpoint(account.storage_endpoint_id)
        except Exception as exc:
            if allow_missing:
                logger.warning("Unable to resolve endpoint for account %s: %s", account.id, exc)
                return None
            raise
        return self._admin_for_endpoint(endpoint, allow_missing=allow_missing)

    def _account_usage(self, acc: S3Account) -> tuple[Optional[int], Optional[int], Optional[int]]:
        try:
            endpoint = self._resolve_storage_endpoint(acc.storage_endpoint_id)
            if not resolve_feature_flags(endpoint).usage_enabled:
                return None, None, None
        except Exception:
            return None, None, None
        admin = self._admin_for_account(acc, allow_missing=True)
        if not admin:
            return None, None, None
        uid = resolve_admin_uid(acc.rgw_account_id, acc.rgw_user_uid)
        if not uid:
            return None, None, None
        try:
            payload = admin.get_all_buckets(uid=uid, with_stats=True)
        except RGWAdminError as exc:
            logger.warning("Unable to list buckets for account %s: %s", acc.rgw_account_id or acc.id, exc)
            return None, None, None
        buckets = extract_bucket_list(payload)
        bucket_count: int = len(buckets)
        total_bytes: int = 0
        total_objects: int = 0
        has_any = False
        has_objects = False
        for b in buckets:
            usage = b.get("usage") if isinstance(b, dict) else None
            usage_bytes, usage_objects = extract_usage_stats(usage)
            if usage_bytes is not None:
                total_bytes += usage_bytes
                has_any = True
            if usage_objects is not None:
                total_objects += usage_objects
                has_objects = True
        return (
            total_bytes if has_any else None,
            total_objects if has_objects else None,
            bucket_count,
        )

    def _normalize_account_key(self, account_id: Optional[str]) -> Optional[str]:
        if not account_id:
            return None
        return str(account_id).lower()

    def _root_uid(self, identifier: Any) -> str:
        value = str(identifier or "").strip()
        if not value:
            raise ValueError("Missing account identifier for RGW root user")
        normalized = normalize_rgw_identifier(value)
        if not normalized:
            raise ValueError("Missing account identifier for RGW root user")
        return f"{normalized}-admin"

    def _root_display_name(self, account_name: Optional[str], account_identifier: str) -> str:
        base = (account_name or account_identifier or "").strip()
        return base or "s3-manager admin user"

    def _derive_account_from_uid(self, uid: str) -> Optional[str]:
        if not uid:
            return None
        if "$" in uid:
            candidate = uid.split("$", 1)[0]
            return candidate or None
        if "-" in uid:
            candidate = uid.split("-", 1)[0]
            if candidate and candidate.upper().startswith("RGW"):
                return candidate
        return None

    def _rgw_account_users(self) -> Optional[dict[str, list[str]]]:
        if not self.rgw_admin:
            return None
        try:
            users = self.rgw_admin.list_users()
        except Exception as exc:
            logger.debug("Unable to list RGW users for account metadata: %s", exc)
            return None

        result: dict[str, list[str]] = {}
        for entry in users:
            uid_raw = entry.get("user") or entry.get("user_id") or entry.get("uid")
            if not uid_raw:
                continue
            uid = str(uid_raw)
            tenant_raw = entry.get("tenant") or entry.get("account_id")
            tenant = str(tenant_raw).strip() if isinstance(tenant_raw, str) else tenant_raw
            tenant_id = tenant if tenant else self._derive_account_from_uid(uid)
            key = self._normalize_account_key(tenant_id)
            if not key:
                continue
            tenant_value = tenant_id or ""
            if uid.lower() == f"{tenant_value.lower()}-admin":
                continue
            result.setdefault(key, []).append(uid)

        for key in list(result.keys()):
            result[key] = sorted(set(result[key]))

        return result

    def _topic_entry_metadata(self, topic: Any) -> tuple[Optional[str], Optional[str]]:
        name: Optional[str] = None
        account: Optional[str] = None
        arn: Optional[str] = None
        if isinstance(topic, dict):
            name = (
                topic.get("topic")
                or topic.get("name")
                or topic.get("topic_name")
                or topic.get("Topic")
            )
            arn = topic.get("arn") or topic.get("TopicArn") or topic.get("topic_arn")
            account = topic.get("account") or topic.get("account_id") or topic.get("tenant")
        else:
            name = str(topic)
        if arn and not account:
            parts = str(arn).split(":")
            if len(parts) >= 5:
                account = parts[4] or account
        if name and not account and ":" in name:
            prefix = name.split(":", 1)[0]
            if prefix.upper().startswith("RGW"):
                account = prefix
        if not name and arn:
            name = arn
        return (str(name) if name else None, str(account) if account else None)

    def _topics_from_response(self, topics: Optional[list[Any]]) -> Optional[tuple[int, list[str]]]:
        if topics is None:
            return None
        names: list[str] = []
        for topic in topics:
            name, _ = self._topic_entry_metadata(topic)
            if name:
                names.append(name)
        deduped = sorted(set(names))
        return (len(deduped), deduped)

    def _all_topics_by_account(self) -> Optional[dict[str, list[str]]]:
        if not self.rgw_admin:
            return None
        if self._topics_global_cache is not None:
            return self._topics_global_cache
        try:
            topics = self.rgw_admin.list_topics(None)
        except RGWAdminError as exc:
            logger.debug("Unable to list global topics: %s", exc)
            self._topics_global_cache = None
            return None
        if topics is None:
            self._topics_global_cache = None
            return None
        mapping: dict[str, list[str]] = {}
        for topic in topics:
            name, account = self._topic_entry_metadata(topic)
            norm_key = self._normalize_account_key(account)
            if not norm_key or not name:
                continue
            mapping.setdefault(norm_key, []).append(name)
        for key in list(mapping.keys()):
            mapping[key] = sorted(set(mapping[key]))
        self._topics_global_cache = mapping
        return mapping

    def _account_topics_info(
        self,
        account_identifier: Optional[str],
        admin: Optional[RGWAdminClient],
    ) -> tuple[Optional[int], Optional[list[str]]]:
        if not account_identifier or not admin:
            return None, None
        normalized_key = self._normalize_account_key(account_identifier)
        if not normalized_key:
            return None, None
        cached = self._topics_cache.get(normalized_key)
        if cached is not None:
            return cached
        topics_response: Optional[list[Any]]
        topics_response = None
        try:
            topics_response = admin.list_topics(account_identifier)
        except RGWAdminError as exc:
            if any(code in str(exc).lower() for code in ("405", "methodnotallowed")):
                logger.debug("Topic API unavailable for %s: treating as zero topics", account_identifier)
                result = (0, [])
                self._topics_cache[normalized_key] = result
                return result
            logger.debug("Unable to list topics for account %s: %s", account_identifier, exc)
        result = self._topics_from_response(topics_response)
        if result is None:
            global_topics = self._all_topics_by_account()
            if global_topics is not None:
                names = list(global_topics.get(normalized_key, []))
                result = (len(names), names)
            else:
                result = (0, [])
        self._topics_cache[normalized_key] = result
        return result

    def _account_rgw_users(
        self,
        account_identifier: Optional[str],
        precomputed_users: Optional[dict[str, list[str]]],
        admin: Optional[RGWAdminClient],
    ) -> tuple[Optional[int], Optional[list[str]]]:
        normalized_key = self._normalize_account_key(account_identifier)
        if not normalized_key:
            return None, None
        if precomputed_users is not None:
            users = list(precomputed_users.get(normalized_key, []))
            return len(users), users
        if not admin:
            return None, None
        try:
            account_info = admin.get_account(account_identifier, allow_not_found=True)
        except RGWAdminError as exc:
            logger.debug("Unable to fetch account info for %s: %s", account_identifier, exc)
            return None, None
        if not account_info:
            return 0, []
        user_list = account_info.get("user_list") or account_info.get("users")
        if not isinstance(user_list, list):
            return 0, []
        cleaned: list[str] = []
        for entry in user_list:
            uid = str(entry) if entry is not None else ""
            if not uid:
                continue
            if uid.lower() == f"{normalized_key}-admin":
                continue
            cleaned.append(uid)
        deduped = sorted(set(cleaned))
        return len(deduped), deduped

    def _generate_account_id(self) -> str:
        return f"RGW{random.randint(0, 10**17 - 1):017d}"

    def list_accounts(self, include_usage_stats: bool = True) -> list[S3AccountSchema]:
        db_accounts = self.db.query(S3Account).all()
        user_links = self.db.query(UserS3Account).filter(UserS3Account.is_root.is_(False)).all()
        user_ids_by_account: dict[int, list[int]] = {}
        user_links_by_account: dict[int, list[AccountUserLink]] = {}
        for link in user_links:
            user_ids_by_account.setdefault(link.account_id, []).append(link.user_id)
            user_links_by_account.setdefault(link.account_id, []).append(
                AccountUserLink(user_id=link.user_id, account_role=link.account_role, account_admin=link.account_admin)
            )

        roots_by_account: dict[str, tuple[str, int]] = {}
        for acc in db_accounts:
            root_user = (
                self.db.query(UserS3Account)
                .filter(UserS3Account.account_id == acc.id, UserS3Account.is_root.is_(True))
                .join(User)
                .with_entities(User.email, User.id)
                .first()
            )
            if root_user:
                roots_by_account[acc.rgw_account_id or str(acc.id)] = (root_user[0], root_user[1])

        results: list[S3AccountSchema] = []
        for acc in db_accounts:
            root_meta = roots_by_account.get(acc.rgw_account_id or str(acc.id))
            used_bytes = None
            used_objects = None
            bucket_count = None
            rgw_user_count = None
            rgw_user_uids = None
            rgw_topic_count = None
            rgw_topics = None
            if include_usage_stats:
                used_bytes, used_objects, bucket_count = self._account_usage(acc)
            account_identifier = acc.rgw_account_id or str(acc.id)
            admin = self._admin_for_account(acc, allow_missing=True)
            if admin:
                rgw_user_count, rgw_user_uids = self._account_rgw_users(account_identifier, None, admin)
                rgw_topic_count, rgw_topics = self._account_topics_info(account_identifier, admin)
            endpoint = self._resolve_storage_endpoint(acc.storage_endpoint_id)
            results.append(
                S3AccountSchema(
                    id=str(account_identifier),
                    db_id=acc.id,
                    name=acc.name,
                    rgw_account_id=acc.rgw_account_id,
                    rgw_user_uid=acc.rgw_user_uid,
                    quota_max_size_gb=acc.quota_max_size_gb,
                    quota_max_objects=acc.quota_max_objects,
                    root_user_email=root_meta[0] if root_meta else None,
                    root_user_id=root_meta[1] if root_meta else None,
                    email=acc.email,
                    used_bytes=used_bytes,
                    used_objects=used_objects,
                    rgw_user_count=rgw_user_count,
                    rgw_user_uids=rgw_user_uids,
                    rgw_topic_count=rgw_topic_count,
                    rgw_topics=rgw_topics,
                    bucket_count=bucket_count,
                    user_ids=user_ids_by_account.get(acc.id),
                    user_links=user_links_by_account.get(acc.id),
                    storage_endpoint_id=endpoint.id if endpoint else None,
                    storage_endpoint_name=endpoint.name if endpoint else None,
                    storage_endpoint_url=endpoint.endpoint_url if endpoint else None,
                    storage_endpoint_capabilities=self._endpoint_capabilities(endpoint),
                )
            )
        return results

    def list_accounts_minimal(self) -> list[S3AccountSummary]:
        db_accounts = self.db.query(S3Account).all()
        user_links = self.db.query(UserS3Account).filter(UserS3Account.is_root.is_(False)).all()
        user_ids_by_account: dict[int, list[int]] = {}
        user_links_by_account: dict[int, list[AccountUserLink]] = {}
        for link in user_links:
            user_ids_by_account.setdefault(link.account_id, []).append(link.user_id)
            user_links_by_account.setdefault(link.account_id, []).append(
                AccountUserLink(user_id=link.user_id, account_role=link.account_role, account_admin=link.account_admin)
            )
        summaries: list[S3AccountSummary] = []
        for acc in db_accounts:
            endpoint = self._resolve_storage_endpoint(acc.storage_endpoint_id)
            summaries.append(
                S3AccountSummary(
                    id=acc.rgw_account_id or str(acc.id),
                    db_id=acc.id,
                    name=acc.name,
                    rgw_account_id=acc.rgw_account_id,
                    user_ids=user_ids_by_account.get(acc.id),
                    user_links=user_links_by_account.get(acc.id),
                    storage_endpoint_id=endpoint.id if endpoint else None,
                    storage_endpoint_name=endpoint.name if endpoint else None,
                    storage_endpoint_url=endpoint.endpoint_url if endpoint else None,
                    storage_endpoint_capabilities=self._endpoint_capabilities(endpoint),
                )
            )
        summaries.sort(key=lambda entry: entry.name.lower())
        return summaries

    def get_account_detail(self, account_id: int, include_usage: bool = False) -> S3AccountSchema:
        account = self.db.query(S3Account).filter(S3Account.id == account_id).first()
        if not account:
            raise ValueError("S3Account not found")
        root_user = (
            self.db.query(UserS3Account)
            .filter(UserS3Account.account_id == account.id, UserS3Account.is_root.is_(True))
            .join(User)
            .with_entities(User.email, User.id)
            .first()
        )
        non_root_links = (
            self.db.query(UserS3Account)
            .filter(UserS3Account.account_id == account.id, UserS3Account.is_root.is_(False))
            .all()
        )
        user_ids = [link.user_id for link in non_root_links] if non_root_links else None
        user_links = (
            [
                AccountUserLink(
                    user_id=link.user_id,
                    account_role=link.account_role,
                    account_admin=link.account_admin,
                )
                for link in non_root_links
            ]
            if non_root_links
            else None
        )
        used_bytes = used_objects = bucket_count = None
        if include_usage:
            used_bytes, used_objects, bucket_count = self._account_usage(account)
        account_identifier = account.rgw_account_id or str(account.id)
        admin = self._admin_for_account(account, allow_missing=True)
        rgw_user_count = rgw_user_uids = rgw_topic_count = rgw_topics = None
        if admin:
            rgw_user_count, rgw_user_uids = self._account_rgw_users(account_identifier, None, admin)
            rgw_topic_count, rgw_topics = self._account_topics_info(account_identifier, admin)
        endpoint = self._resolve_storage_endpoint(account.storage_endpoint_id)
        return S3AccountSchema(
            id=account_identifier,
            db_id=account.id,
            name=account.name,
            rgw_account_id=account.rgw_account_id,
            rgw_user_uid=account.rgw_user_uid,
            quota_max_size_gb=account.quota_max_size_gb,
            quota_max_objects=account.quota_max_objects,
            root_user_email=root_user[0] if root_user else None,
            root_user_id=root_user[1] if root_user else None,
            email=account.email,
            used_bytes=used_bytes,
            used_objects=used_objects,
            bucket_count=bucket_count,
            rgw_user_count=rgw_user_count,
            rgw_user_uids=rgw_user_uids,
            rgw_topic_count=rgw_topic_count,
            rgw_topics=rgw_topics,
            user_ids=user_ids,
            user_links=user_links,
            storage_endpoint_id=endpoint.id if endpoint else None,
            storage_endpoint_name=endpoint.name if endpoint else None,
            storage_endpoint_url=endpoint.endpoint_url if endpoint else None,
            storage_endpoint_capabilities=self._endpoint_capabilities(endpoint),
        )

    def _import_account_with_keys(self, item: S3AccountImport, endpoint: StorageEndpoint) -> Optional[S3AccountSchema]:
        name = (item.name or "").strip()
        if not name:
            raise ValueError("Account name is required when importing with access_key/secret_key")
        if item.rgw_account_id:
            existing_by_id = (
                self.db.query(S3Account).filter(S3Account.rgw_account_id == item.rgw_account_id).first()
            )
            if existing_by_id:
                logger.debug("Skipping account %s: already imported", item.rgw_account_id)
                return None
        existing_by_name = self.db.query(S3Account).filter(S3Account.name == name).first()
        if existing_by_name:
            logger.debug("Skipping account %s: name already imported", name)
            return None

        account = S3Account(
            name=name,
            rgw_account_id=item.rgw_account_id or None,
            rgw_access_key=item.access_key,
            rgw_secret_key=item.secret_key,
            rgw_user_uid=None,
            email=item.email,
            storage_endpoint_id=endpoint.id,
        )
        self.db.add(account)
        self.db.flush()
        return S3AccountSchema(
            id=str(account.id),
            db_id=account.id,
            name=account.name,
            rgw_account_id=account.rgw_account_id,
            rgw_user_uid=None,
            root_user_email=None,
            root_user_id=None,
            quota_max_size_gb=None,
            quota_max_objects=None,
            email=account.email,
            user_ids=[],
            user_links=[],
            storage_endpoint_id=endpoint.id if endpoint else None,
            storage_endpoint_name=endpoint.name if endpoint else None,
            storage_endpoint_url=endpoint.endpoint_url if endpoint else None,
            storage_endpoint_capabilities=self._endpoint_capabilities(endpoint),
        )

    def import_accounts(self, imports: list[S3AccountImport]) -> list[S3AccountSchema]:
        created: list[S3AccountSchema] = []
        for item in imports:
            has_keys = bool(item.access_key and item.secret_key)
            has_rgw_id = bool(item.rgw_account_id)

            if has_keys:
                endpoint = self._resolve_storage_endpoint(item.storage_endpoint_id)
                created_with_keys = self._import_account_with_keys(item, endpoint)
                if created_with_keys:
                    created.append(created_with_keys)
                continue

            if not has_rgw_id:
                raise ValueError("rgw_account_id is required when access_key/secret_key are not provided")

            endpoint = self._resolve_storage_endpoint(item.storage_endpoint_id, require_ceph=True)
            admin = self._admin_for_endpoint(endpoint, allow_missing=False)
            if not admin:
                raise ValueError(
                    "RGW admin credentials are required to import accounts by id; provide access/secret keys instead"
                )

            # Skip if already present
            if self.db.query(S3Account).filter(S3Account.rgw_account_id == item.rgw_account_id).first():
                continue
            # Validate RGW account id format
            if not item.rgw_account_id.startswith("RGW") or not item.rgw_account_id[3:].isdigit():
                raise ValueError(f"Invalid account id format: {item.rgw_account_id}")
            # Verify account exists in RGW
            rgw_info = admin.get_account(item.rgw_account_id, allow_not_found=True)
            if not rgw_info or rgw_info.get("not_found"):
                raise ValueError(f"S3Account {item.rgw_account_id} not found in RGW")
            account_name = rgw_info.get("name") or item.name or item.rgw_account_id
            # We do not create the account in RGW (assumed existing); ensure root user keys
            root_uid = self._root_uid(item.rgw_account_id)
            root_display = self._root_display_name(account_name, item.rgw_account_id)
            access_key = item.access_key
            secret_key = item.secret_key
            try:
                existing_root = admin.get_user(root_uid, tenant=None, allow_not_found=True)
            except RGWAdminError:
                existing_root = None
            keys = admin._extract_keys(existing_root or {})
            access_key = access_key or (keys[0].get("access_key") if keys else None)
            secret_key = secret_key or (keys[0].get("secret_key") if keys else None)
            if not access_key or not secret_key:
                resp = admin.create_user_with_account_id(
                    uid=root_uid,
                    account_id=item.rgw_account_id,
                    display_name=root_display,
                    account_root=True,
                )
                keys = admin._extract_keys(resp)
                access_key = access_key or (keys[0].get("access_key") if keys else None)
                secret_key = secret_key or (keys[0].get("secret_key") if keys else None)
            if not access_key or not secret_key:
                try:
                    resp = admin.create_access_key(
                        root_uid,
                        tenant=item.rgw_account_id,
                        key_name="s3-manager",
                    )
                    keys = admin._extract_keys(resp)
                    access_key = access_key or (keys[0].get("access_key") if keys else None)
                    secret_key = secret_key or (keys[0].get("secret_key") if keys else None)
                except RGWAdminError:
                    pass
            if not access_key or not secret_key:
                raise ValueError(f"Unable to obtain root keys for account {item.rgw_account_id}")
            account = S3Account(
                name=account_name,
                rgw_account_id=item.rgw_account_id,
                rgw_access_key=access_key,
                rgw_secret_key=secret_key,
                rgw_user_uid=root_uid,
                email=item.email,
                storage_endpoint_id=endpoint.id if endpoint else None,
            )
            self.db.add(account)
            self.db.flush()
            created.append(
                S3AccountSchema(
                    id=str(account.id),
                    db_id=account.id,
                    name=account.name,
                    rgw_account_id=account.rgw_account_id,
                    rgw_user_uid=account.rgw_user_uid,
                    root_user_email=root_uid,
                    root_user_id=None,
                    quota_max_size_gb=None,
                    quota_max_objects=None,
                    email=account.email,
                    user_ids=[],
                    user_links=[],
                    storage_endpoint_id=endpoint.id if endpoint else None,
                    storage_endpoint_name=endpoint.name if endpoint else None,
                    storage_endpoint_capabilities=self._endpoint_capabilities(endpoint),
                )
            )
        self.db.commit()
        return created

    def create_account_with_manager(self, payload: S3AccountCreate) -> S3AccountSchema:
        existing = self.db.query(S3Account).filter(S3Account.name == payload.name).first()
        if existing:
            raise ValueError("S3Account already exists")

        endpoint = self._resolve_storage_endpoint(payload.storage_endpoint_id, require_ceph=True)
        admin = self._admin_for_endpoint(endpoint)
        if not admin:
            raise ValueError("Impossible de créer le compte: credentials RGW manquants pour l'endpoint sélectionné.")

        rgw_account_id = self._generate_account_id()
        # Create account in RGW
        try:
            admin.create_account(account_id=rgw_account_id, account_name=payload.name)
            logger.debug("Created RGW account %s (%s)", rgw_account_id, payload.name)
        except RGWAdminError as exc:
            raise ValueError(f"RGW account creation failed: {exc}") from exc

        # Create root user in RGW for this account
        root_uid = self._root_uid(rgw_account_id)
        root_display = self._root_display_name(payload.name, rgw_account_id)
        try:
            root_user_resp = admin.create_user_with_account_id(
                uid=root_uid,
                account_id=rgw_account_id,
                display_name=root_display,
                account_root=True,
            )
        except RGWAdminError as exc:
            raise ValueError(f"RGW root user creation failed: {exc}") from exc
        root_keys = admin._extract_keys(root_user_resp)
        access_key = root_keys[0].get("access_key") if root_keys else None
        secret_key = root_keys[0].get("secret_key") if root_keys else None
        if not access_key or not secret_key:
            raise ValueError("Unable to obtain root access/secret keys for account")

        account = S3Account(
            name=payload.name,
            rgw_account_id=rgw_account_id,
            rgw_access_key=access_key,
            rgw_secret_key=secret_key,
            rgw_user_uid=root_uid,
            email=payload.email,
            quota_max_size_gb=payload.quota_max_size_gb,
            quota_max_objects=payload.quota_max_objects,
            storage_endpoint_id=endpoint.id,
        )
        self.db.add(account)
        self.db.flush()

        # Quota values are stored in the DB only; RGW AdminOps cannot apply account quotas.

        self.db.commit()
        self.db.refresh(account)
        return S3AccountSchema(
            id=str(account.id),
            db_id=account.id,
            name=account.name,
            rgw_account_id=account.rgw_account_id,
            rgw_user_uid=account.rgw_user_uid,
            root_user_email=root_uid,
            root_user_id=None,
            quota_max_size_gb=payload.quota_max_size_gb,
            quota_max_objects=payload.quota_max_objects,
            email=account.email,
            user_ids=[],
            user_links=[],
            storage_endpoint_id=endpoint.id,
            storage_endpoint_name=endpoint.name,
            storage_endpoint_capabilities=self._endpoint_capabilities(endpoint),
        )

    def update_account(self, account_id: int, payload: S3AccountUpdate) -> S3AccountSchema:
        account = self.db.query(S3Account).filter(S3Account.id == account_id).first()
        if not account:
            raise ValueError("S3Account not found")

        if payload.name:
            account.name = payload.name
        if payload.email is not None:
            account.email = payload.email
        if payload.storage_endpoint_id is not None:
            endpoint = self._resolve_storage_endpoint(payload.storage_endpoint_id, require_ceph=True)
            account.storage_endpoint_id = endpoint.id
        account.quota_max_size_gb = payload.quota_max_size_gb
        account.quota_max_objects = payload.quota_max_objects

        # Quota values are stored in the DB only; RGW AdminOps cannot apply account quotas.

        # Update UI user associations (non-root links only)
        if payload.user_links is not None or payload.user_ids is not None:
            desired_links: list[AccountUserLink] = []
            if payload.user_links is not None:
                desired_links = payload.user_links
            elif payload.user_ids is not None:
                desired_links = [AccountUserLink(user_id=uid, account_role=AccountRole.PORTAL_MANAGER.value) for uid in payload.user_ids]

            existing_links = (
                self.db.query(UserS3Account)
                .filter(UserS3Account.account_id == account.id, UserS3Account.is_root.is_(False))
                .all()
            )
            existing_by_user = {link.user_id: link for link in existing_links}
            desired_ids = {int(link.user_id) for link in desired_links}

            to_remove = set(existing_by_user.keys()) - desired_ids
            if to_remove:
                (
                    self.db.query(UserS3Account)
                    .filter(
                        UserS3Account.account_id == account.id,
                        UserS3Account.user_id.in_(to_remove),
                        UserS3Account.is_root.is_(False),
                    )
                    .delete(synchronize_session=False)
                )

            for link in desired_links:
                user_id = int(link.user_id)
                account_role = link.account_role or AccountRole.PORTAL_MANAGER.value
                account_admin = bool(link.account_admin) if link.account_admin is not None else False
                if account_role not in {role.value for role in AccountRole}:
                    raise ValueError(f"Invalid account role for user {user_id}")
                db_link = existing_by_user.get(user_id)
                if not db_link:
                    user = self.db.query(User).filter(User.id == user_id).first()
                    if not user:
                        raise ValueError(f"User not found: {user_id}")
                    if user.role != UserRole.UI_ADMIN.value:
                        user.role = UserRole.UI_USER.value
                        self.db.add(user)
                    db_link = UserS3Account(
                        user_id=user_id,
                        account_id=account.id,
                        is_root=False,
                    )
                db_link.account_role = account_role
                db_link.account_admin = account_admin or db_link.account_admin
                db_link.can_manage_buckets = db_link.account_admin or account_role in {
                    AccountRole.PORTAL_MANAGER.value,
                    AccountRole.PORTAL_USER.value,
                }
                db_link.can_manage_portal_users = db_link.account_admin or account_role == AccountRole.PORTAL_MANAGER.value
                db_link.can_manage_iam = db_link.can_manage_portal_users
                db_link.can_view_root_key = bool(db_link.account_admin or db_link.can_manage_portal_users or db_link.can_manage_iam)
                db_link.updated_at = datetime.utcnow()
                self.db.add(db_link)

        self.db.add(account)
        self.db.commit()
        self.db.refresh(account)

        non_root_links = (
            self.db.query(UserS3Account)
            .filter(UserS3Account.account_id == account.id, UserS3Account.is_root.is_(False))
            .all()
        )
        user_ids = [link.user_id for link in non_root_links]
        user_links = [
            AccountUserLink(user_id=link.user_id, account_role=link.account_role, account_admin=link.account_admin)
            for link in non_root_links
        ]
        endpoint = self._resolve_storage_endpoint(account.storage_endpoint_id)

        return S3AccountSchema(
            id=str(account.id),
            db_id=account.id,
            name=account.name,
            rgw_account_id=account.rgw_account_id,
            rgw_user_uid=account.rgw_user_uid,
            quota_max_size_gb=account.quota_max_size_gb,
            quota_max_objects=account.quota_max_objects,
            root_user_email=None,
            root_user_id=None,
            email=account.email,
            user_ids=user_ids,
            user_links=user_links,
            storage_endpoint_id=endpoint.id if endpoint else None,
            storage_endpoint_name=endpoint.name if endpoint else None,
            storage_endpoint_capabilities=self._endpoint_capabilities(endpoint),
        )

    def delete_account(self, account_id: int, delete_rgw: bool = False) -> None:
        account = self.db.query(S3Account).filter(S3Account.id == account_id).first()
        if not account:
            raise ValueError("S3Account not found")
        admin = self._admin_for_account(account, allow_missing=True)
        if delete_rgw:
            self._delete_root_user(account, required=False)
            rgw_id = account.rgw_account_id or str(account.id)
            try:
                if not admin:
                    raise ValueError("Impossible de supprimer le compte RGW: credentials admin manquants pour l'endpoint.")
                admin.delete_account(rgw_id)
            except RGWAdminError as exc:
                logger.warning("Unable to delete RGW account %s: %s", rgw_id, exc)
        self._remove_account_entry(account)

    def unlink_account(self, account_id: int) -> None:
        account = self.db.query(S3Account).filter(S3Account.id == account_id).first()
        if not account:
            raise ValueError("S3Account not found")
        self._delete_root_user(account, required=True)
        self._remove_account_entry(account)

    def _delete_root_user(self, account: S3Account, required: bool) -> None:
        rgw_id = account.rgw_account_id or str(account.id)
        root_uid = self._root_uid(rgw_id)
        try:
            admin = self._admin_for_account(account, allow_missing=False)
            admin.delete_user(root_uid, tenant=None)
            logger.debug("Deleted RGW root user %s", root_uid)
            return
        except RGWAdminError as exc:
            logger.debug("Unable to delete RGW root user %s: %s", root_uid, exc)
        if required:
            raise ValueError(f"Unable to delete RGW root user for account {account.id}")

    def _remove_account_entry(self, account: S3Account) -> None:
        self.db.query(UserS3Account).filter(UserS3Account.account_id == account.id).delete()
        self.db.delete(account)
        self.db.commit()


def get_s3_accounts_service(
    db: Session,
    rgw_admin_client: Optional[RGWAdminClient] = None,
    allow_missing_admin: bool = False,
) -> S3AccountsService:
    return S3AccountsService(db, rgw_admin_client=rgw_admin_client, allow_missing_admin=allow_missing_admin)
