# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from ._shared import *


class BrowserBucketsMixin:
    def list_buckets(self, account: S3Account) -> list[BrowserBucket]:
        allowed_portal_buckets = getattr(account, "_portal_allowed_buckets", None)
        account_key = self._account_cache_key(account)
        cached = _BUCKET_LIST_CACHE.get(account_key)
        if cached is not None:
            logger.debug("Browser bucket cache hit: account=%s count=%s", account_key, len(cached))
            if allowed_portal_buckets is not None:
                return [bucket for bucket in cached if bucket.name in allowed_portal_buckets]
            return list(cached)
        client = self._client(account)
        try:
            resp = client.list_buckets()
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to list buckets: {exc}") from exc
        buckets: list[BrowserBucket] = []
        for bucket in resp.get("Buckets", []):
            name = bucket.get("Name")
            if not name:
                continue
            buckets.append(BrowserBucket(name=name, creation_date=bucket.get("CreationDate")))
        buckets.sort(key=lambda bucket: bucket.name)
        _BUCKET_LIST_CACHE.set(account_key, buckets)
        logger.debug("Browser bucket cache miss: account=%s count=%s", account_key, len(buckets))
        if allowed_portal_buckets is not None:
            return [bucket for bucket in buckets if bucket.name in allowed_portal_buckets]
        return list(buckets)

    def search_buckets(
        self,
        account: S3Account,
        *,
        search: Optional[str] = None,
        exact: bool = False,
        page: int = 1,
        page_size: int = 50,
    ) -> PaginatedBrowserBucketsResponse:
        normalized_page = max(1, int(page or 1))
        normalized_page_size = max(1, min(200, int(page_size or 50)))
        buckets = self.list_buckets(account)
        query = (search or "").strip()
        if query:
            query_normalized = query.lower()
            if exact:
                filtered = [bucket for bucket in buckets if bucket.name.lower() == query_normalized]
            else:
                filtered = [bucket for bucket in buckets if query_normalized in bucket.name.lower()]
        else:
            filtered = buckets
        total = len(filtered)
        start = (normalized_page - 1) * normalized_page_size
        end = start + normalized_page_size
        items = filtered[start:end] if start < total else []
        return PaginatedBrowserBucketsResponse(
            items=items,
            total=total,
            page=normalized_page,
            page_size=normalized_page_size,
            has_next=end < total,
        )

    def create_bucket(
        self,
        bucket_name: str,
        account: S3Account,
        *,
        versioning: bool = False,
    ) -> None:
        access_key, secret_key, session_token = self._resolve_s3_credentials(account)
        s3_create_bucket(
            bucket_name,
            access_key=access_key,
            secret_key=secret_key,
            session_token=session_token,
            **self._s3_client_kwargs(account),
        )
        if versioning:
            s3_set_bucket_versioning(
                bucket_name,
                enabled=True,
                access_key=access_key,
                secret_key=secret_key,
                session_token=session_token,
                **self._s3_client_kwargs(account),
            )
        self.invalidate_bucket_list_cache_for_account(account)
        self.invalidate_object_list_cache_for_account(account, bucket_name)
