# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from typing import Any, Optional

from app.services.rgw_admin import RGWAdminClient, RGWAdminError


logger = logging.getLogger(__name__)


def normalize_account_key(account_id: Optional[str]) -> Optional[str]:
    if not account_id:
        return None
    return str(account_id).lower()


class RgwAccountTopicsResolver:
    """Resolve RGW notification topics for accounts within one request scope."""

    def __init__(self) -> None:
        self._account_cache: dict[
            tuple[int, str], tuple[Optional[int], Optional[list[str]]]
        ] = {}
        self._global_cache: dict[int, Optional[dict[str, list[str]]]] = {}

    @staticmethod
    def _entry_metadata(topic: Any) -> tuple[Optional[str], Optional[str]]:
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
            account = (
                topic.get("account")
                or topic.get("account_id")
                or topic.get("tenant")
            )
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

    def _from_response(
        self,
        topics: Optional[list[Any]],
    ) -> Optional[tuple[int, list[str]]]:
        if topics is None:
            return None
        names: list[str] = []
        for topic in topics:
            name, _ = self._entry_metadata(topic)
            if name is not None:
                names.append(name)
        deduped = sorted(set(names))
        return len(deduped), deduped

    def _all_by_account(
        self,
        admin: RGWAdminClient,
        storage_endpoint_id: int,
    ) -> Optional[dict[str, list[str]]]:
        if storage_endpoint_id in self._global_cache:
            return self._global_cache[storage_endpoint_id]
        try:
            topics = admin.list_topics(None)
        except RGWAdminError as exc:
            logger.debug("Unable to list global topics: %s", exc)
            self._global_cache[storage_endpoint_id] = None
            return None
        if topics is None:
            self._global_cache[storage_endpoint_id] = None
            return None
        mapping: dict[str, list[str]] = {}
        for topic in topics:
            name, account = self._entry_metadata(topic)
            normalized_account = normalize_account_key(account)
            if not normalized_account or not name:
                continue
            mapping.setdefault(normalized_account, []).append(name)
        for account, names in mapping.items():
            mapping[account] = sorted(set(names))
        self._global_cache[storage_endpoint_id] = mapping
        return mapping

    def resolve(
        self,
        account_identifier: Optional[str],
        admin: Optional[RGWAdminClient],
        storage_endpoint_id: int,
    ) -> tuple[Optional[int], Optional[list[str]]]:
        if not account_identifier or not admin:
            return None, None
        normalized_account = normalize_account_key(account_identifier)
        if not normalized_account:
            return None, None
        cache_key = storage_endpoint_id, normalized_account
        cached = self._account_cache.get(cache_key)
        if cached is not None:
            return cached

        topics_response: Optional[list[Any]] = None
        try:
            topics_response = admin.list_topics(account_identifier)
        except RGWAdminError as exc:
            if any(code in str(exc).lower() for code in ("405", "methodnotallowed")):
                logger.debug(
                    "Topic API unavailable for %s: treating as zero topics",
                    account_identifier,
                )
                result = 0, []
                self._account_cache[cache_key] = result
                return result
            logger.debug(
                "Unable to list topics for account %s: %s",
                account_identifier,
                exc,
            )

        result = self._from_response(topics_response)
        if result is None:
            global_topics = self._all_by_account(admin, storage_endpoint_id)
            if global_topics is not None:
                names = list(global_topics.get(normalized_account, []))
                result = len(names), names
            else:
                result = 0, []
        self._account_cache[cache_key] = result
        return result
