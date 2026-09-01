# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from app.models.s3_user import S3UserAccessKey, S3UserGeneratedKey
from app.utils.normalize import normalize_optional_scalar


class RgwUserKeyParser:
    """Convert normalized RGW key entries into S3-user API values."""

    @staticmethod
    def _access_key(entry: dict[str, Any]) -> Optional[str]:
        return normalize_optional_scalar(
            entry.get("access_key") or entry.get("access-key")
        )

    @staticmethod
    def _secret_key(entry: dict[str, Any]) -> Optional[str]:
        return normalize_optional_scalar(
            entry.get("secret_key") or entry.get("secret-key")
        )

    @classmethod
    def select_credentials(
        cls,
        entries: list[dict],
        *,
        exclude_access_key: Optional[str] = None,
    ) -> tuple[Optional[str], Optional[str]]:
        if not entries:
            return None, None

        chosen_entry: Optional[dict[str, Any]] = None
        excluded = normalize_optional_scalar(exclude_access_key)
        if excluded:
            for require_secret in (True, False):
                for entry in entries:
                    access_key = cls._access_key(entry)
                    if not access_key or access_key == excluded:
                        continue
                    if require_secret and not cls._secret_key(entry):
                        continue
                    chosen_entry = entry
                    break
                if chosen_entry:
                    break
        if chosen_entry is None:
            chosen_entry = entries[0]
        return cls._access_key(chosen_entry), cls._secret_key(chosen_entry)

    @classmethod
    def access_key_ids(cls, entries: list[dict]) -> set[str]:
        return {
            access_key
            for entry in entries
            if (access_key := cls._access_key(entry)) is not None
        }

    @staticmethod
    def _created_source(entry: dict[str, Any]) -> Any:
        return (
            entry.get("create_time")
            or entry.get("create-time")
            or entry.get("create_date")
            or entry.get("create-date")
            or entry.get("created_at")
            or entry.get("create_timestamp")
            or entry.get("timestamp")
        )

    @staticmethod
    def _parse_created_at(raw_value: Any) -> Optional[datetime]:
        if raw_value is None:
            return None
        if isinstance(raw_value, datetime):
            return raw_value
        if isinstance(raw_value, (int, float)):
            try:
                return datetime.fromtimestamp(float(raw_value), tz=timezone.utc)
            except (OverflowError, ValueError):
                return None
        if not isinstance(raw_value, str):
            return None
        value = raw_value.strip()
        if not value:
            return None
        try:
            return datetime.fromtimestamp(float(value), tz=timezone.utc)
        except (OverflowError, ValueError):
            pass
        candidates = [value]
        if " " in value and "T" not in value:
            candidates.append(value.replace(" ", "T"))
        for candidate in candidates:
            try:
                return datetime.fromisoformat(candidate)
            except ValueError:
                continue
        return None

    @staticmethod
    def _parse_active(raw_value: Any) -> Optional[bool]:
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

    @staticmethod
    def _active_from_status(status: Any) -> Optional[bool]:
        if not isinstance(status, str):
            return None
        normalized = status.strip().lower()
        if normalized in {"active", "enabled", "enable"}:
            return True
        if normalized in {"inactive", "disabled", "disable", "suspended"}:
            return False
        return None

    @classmethod
    def to_access_keys(
        cls,
        entries: list[dict],
        *,
        ui_managed_access_key: Optional[str],
    ) -> list[S3UserAccessKey]:
        result: list[S3UserAccessKey] = []
        for entry in entries:
            access_key = cls._access_key(entry)
            if not access_key:
                continue
            status = entry.get("status") or entry.get("key_status") or entry.get("state")
            is_active = cls._parse_active(entry.get("active"))
            if is_active is None:
                is_active = cls._active_from_status(status)
            if is_active is None:
                is_active = True
            if status is None:
                status = "enabled" if is_active else "disabled"
            result.append(
                S3UserAccessKey(
                    access_key_id=access_key,
                    status=status,
                    created_at=cls._parse_created_at(cls._created_source(entry)),
                    is_ui_managed=access_key == ui_managed_access_key,
                    is_active=is_active,
                )
            )
        return result

    @classmethod
    def to_generated_key(
        cls,
        entries: list[dict],
        *,
        existing_access_keys: set[str],
    ) -> S3UserGeneratedKey:
        if not entries:
            raise ValueError("RGW did not return access credentials")

        chosen_entry: Optional[dict[str, Any]] = None
        for entry in entries:
            access_key = cls._access_key(entry)
            if (
                access_key
                and cls._secret_key(entry)
                and access_key not in existing_access_keys
            ):
                chosen_entry = entry
                break
        if chosen_entry is None:
            chosen_entry = next(
                (entry for entry in entries if cls._secret_key(entry)),
                entries[0],
            )

        access_key = cls._access_key(chosen_entry)
        secret_key = cls._secret_key(chosen_entry)
        if not access_key or not secret_key:
            raise ValueError("RGW did not return full access credentials")
        return S3UserGeneratedKey(
            access_key_id=access_key,
            secret_access_key=secret_key,
            created_at=cls._parse_created_at(cls._created_source(chosen_entry)),
        )
