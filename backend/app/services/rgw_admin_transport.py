# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from threading import Lock
from time import perf_counter
from typing import Any, Dict, Optional

import requests
from requests_aws4auth import AWS4Auth

from app.core.config import get_settings
from app.core.sensitive_data import sanitize_error_detail, sanitized_error_log_detail

settings = get_settings()
logger = logging.getLogger(__name__)


class RGWAdminError(RuntimeError):
    pass


@dataclass(frozen=True)
class RGWAdminOperationResponse:
    status_code: int
    success: bool
    error_code: Optional[str]
    message: Optional[str]
    result: Any


class RGWAdminTransport:
    def __init__(
        self,
        access_key: Optional[str] = None,
        secret_key: Optional[str] = None,
        endpoint: Optional[str] = None,
        region: Optional[str] = None,
        verify_tls: bool = True,
        request_timeout_seconds: Optional[float] = None,
        bucket_list_stats_timeout_seconds: Optional[float] = None,
    ) -> None:
        resolved_endpoint = endpoint
        if not resolved_endpoint:
            raise RGWAdminError("RGW admin endpoint is not configured")
        self.endpoint = resolved_endpoint.rstrip("/") if resolved_endpoint else ""
        self.region = region or settings.seed_s3_region
        self.access_key = access_key
        self.secret_key = secret_key
        self.verify_tls = bool(verify_tls)
        if not self.access_key or not self.secret_key:
            raise RGWAdminError("RGW admin credentials are not configured")
        self.auth = AWS4Auth(self.access_key, self.secret_key, self.region, "s3")
        self.session = requests.Session()
        self.request_timeout_seconds = (
            float(request_timeout_seconds)
            if request_timeout_seconds is not None
            else float(settings.rgw_admin_timeout_seconds)
        )
        self.bucket_list_stats_timeout_seconds = (
            float(bucket_list_stats_timeout_seconds)
            if bucket_list_stats_timeout_seconds is not None
            else float(settings.rgw_admin_bucket_list_stats_timeout_seconds)
        )
        self._account_api_support_state = "unknown"
        self._account_api_support_lock = Lock()

    @property
    def account_api_supported(self) -> Optional[bool]:
        if self._account_api_support_state == "supported":
            return True
        if self._account_api_support_state == "unsupported":
            return False
        return None

    def _mark_account_api_support(self, supported: bool) -> None:
        self._account_api_support_state = "supported" if supported else "unsupported"

    @staticmethod
    def _merge_extra_params(
        params: Dict[str, Any],
        extra_params: Optional[Dict[str, Any]],
    ) -> None:
        if not isinstance(extra_params, dict):
            return
        for key, value in extra_params.items():
            normalized_key = str(key or "").strip()
            if not normalized_key or value is None:
                continue
            params[normalized_key] = value

    def _send_request(
        self,
        method: str,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        data: Optional[Dict[str, Any]] = None,
        timeout: Optional[float] = None,
    ) -> requests.Response:
        url = f"{self.endpoint}{path}"
        start = perf_counter()
        try:
            headers = (
                {"Content-Type": "application/x-www-form-urlencoded"}
                if method.upper() in {"POST", "PUT", "DELETE"}
                else None
            )
            resp = self.session.request(
                method,
                url,
                params=params,
                data=data,
                headers=headers,
                auth=self.auth,
                timeout=self.request_timeout_seconds if timeout is None else timeout,
                verify=self.verify_tls,
            )
            logger.debug(
                "RGW request method=%s path=%s status=%s duration_ms=%.2f",
                method.upper(),
                path,
                resp.status_code,
                (perf_counter() - start) * 1000,
            )
        except requests.RequestException as exc:
            safe_detail = sanitized_error_log_detail(exc)
            logger.warning(
                "RGW request failed method=%s path=%s duration_ms=%.2f error=%s",
                method.upper(),
                path,
                (perf_counter() - start) * 1000,
                safe_detail,
            )
            raise RGWAdminError(f"RGW admin request failed: {safe_detail}") from exc
        return resp

    def _request(
        self,
        method: str,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        data: Optional[Dict[str, Any]] = None,
        allow_conflict: bool = False,
        allow_not_found: bool = False,
        allow_not_implemented: bool = False,
        timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        resp = self._send_request(
            method,
            path,
            params=params,
            data=data,
            timeout=timeout,
        )
        handled_error = (
            (resp.status_code == 409 and allow_conflict)
            or (resp.status_code == 404 and allow_not_found)
            or (resp.status_code in (405, 501) and allow_not_implemented)
            or resp.status_code >= 400
        )
        error_code: Optional[str] = None
        safe_detail = "Upstream service error."
        if handled_error:
            error_code, safe_detail = self._safe_response_error_details(resp)
        if resp.status_code == 409 and allow_conflict:
            return {
                "conflict": True,
                "status_code": resp.status_code,
                "error_code": error_code,
                "detail": safe_detail,
            }
        if resp.status_code == 404 and allow_not_found:
            return {
                "not_found": True,
                "status_code": resp.status_code,
                "error_code": error_code,
                "detail": safe_detail,
            }
        if resp.status_code in (405, 501) and allow_not_implemented:
            return {
                "not_implemented": True,
                "status_code": resp.status_code,
                "error_code": error_code,
                "detail": safe_detail,
            }
        if resp.status_code >= 400:
            logger.warning(
                "RGW admin error status=%s code=%s detail=%s",
                resp.status_code,
                error_code or "unknown",
                safe_detail,
            )
            raise RGWAdminError(
                f"RGW admin error {resp.status_code} "
                f"code={error_code or 'unknown'} detail={safe_detail}"
            )
        if not self._response_has_body(resp):
            return {}
        try:
            return resp.json()
        except ValueError:
            _, safe_detail = self._safe_response_error_details(resp)
            raise RGWAdminError(
                f"Unexpected RGW admin response format status={resp.status_code} "
                f"detail={safe_detail}"
            )

    @staticmethod
    def _xml_tag(value: str) -> str:
        return value.rsplit("}", 1)[-1]

    @classmethod
    def _xml_to_value(cls, element: ET.Element) -> Any:
        children = list(element)
        if not children:
            return (element.text or "").strip()
        value: Dict[str, Any] = {}
        for child in children:
            key = cls._xml_tag(child.tag)
            child_value = cls._xml_to_value(child)
            existing = value.get(key)
            if existing is None:
                value[key] = child_value
            elif isinstance(existing, list):
                existing.append(child_value)
            else:
                value[key] = [existing, child_value]
        return value

    @classmethod
    def _parse_operation_payload(cls, resp: requests.Response) -> Any:
        if not cls._response_has_body(resp):
            return None
        try:
            return sanitize_error_detail(resp.json())
        except ValueError:
            pass
        raw_text = resp.text.strip()
        if raw_text.startswith("<"):
            try:
                root = ET.fromstring(raw_text)
                return sanitize_error_detail(
                    {cls._xml_tag(root.tag): cls._xml_to_value(root)}
                )
            except ET.ParseError:
                pass
        return sanitize_error_detail(raw_text)

    @staticmethod
    def _response_has_body(resp: requests.Response) -> bool:
        return bool(getattr(resp, "content", b"") or getattr(resp, "text", ""))

    @staticmethod
    def _operation_error_details(payload: Any) -> tuple[Optional[str], Optional[str]]:
        candidate = payload
        if isinstance(candidate, dict) and len(candidate) == 1:
            nested = next(iter(candidate.values()))
            if isinstance(nested, dict):
                candidate = nested
        if isinstance(candidate, dict):
            nested_error = candidate.get("Error") or candidate.get("error")
            if isinstance(nested_error, dict):
                candidate = nested_error
        if not isinstance(candidate, dict):
            return None, candidate if isinstance(candidate, str) and candidate else None
        raw_code = (
            candidate.get("Code")
            or candidate.get("code")
            or candidate.get("error_code")
        )
        raw_message = (
            candidate.get("Message")
            or candidate.get("message")
            or candidate.get("error_message")
        )
        return (
            str(raw_code).strip() if raw_code is not None else None,
            str(raw_message).strip() if raw_message is not None else None,
        )

    @classmethod
    def _safe_response_error_details(
        cls,
        resp: requests.Response,
    ) -> tuple[Optional[str], str]:
        payload = cls._parse_operation_payload(resp)
        error_code, upstream_message = cls._operation_error_details(payload)
        detail_source = upstream_message or payload or "Upstream service error."
        return error_code, sanitized_error_log_detail(detail_source)

    def _request_operation(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        data: Optional[Dict[str, Any]] = None,
        timeout: Optional[float] = None,
    ) -> RGWAdminOperationResponse:
        resp = self._send_request(
            method,
            path,
            params=params,
            data=data,
            timeout=timeout,
        )
        result = self._parse_operation_payload(resp)
        error_code, upstream_message = self._operation_error_details(result)
        success = 200 <= resp.status_code < 300
        message = upstream_message
        if not message:
            message = (
                "RGW Admin Ops operation completed."
                if success
                else "RGW Admin Ops operation failed."
            )
        return RGWAdminOperationResponse(
            status_code=resp.status_code,
            success=success,
            error_code=None if success else error_code,
            message=message,
            result=result,
        )
