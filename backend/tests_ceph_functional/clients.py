# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Iterable

import requests

from .config import CephTestSettings
from app.utils.rgw_identifiers import resolve_account_scope

try:
    from app.services.rgw_admin import RGWAdminClient, RGWAdminError
except ModuleNotFoundError as exc:  # pragma: no cover - defensive guard when PYTHONPATH is missing
    raise RuntimeError(
        "Unable to import app.services.rgw_admin. Make sure PYTHONPATH includes the backend directory "
        "before running the Ceph functional tests."
    ) from exc

logger = logging.getLogger(__name__)


class BackendAPIError(RuntimeError):
    """Raised when the API returns an unexpected response."""

    def __init__(self, message: str, status_code: Optional[int] = None, payload: Any | None = None) -> None:
        self.status_code = status_code
        self.payload = payload
        suffix = f" (status={status_code})" if status_code is not None else ""
        super().__init__(f"{message}{suffix}")


def _expected_set(expected_status: int | Iterable[int]) -> set[int]:
    if isinstance(expected_status, int):
        return {expected_status}
    return set(expected_status)


@dataclass
class BackendSession:
    """Thin wrapper around an authenticated cookie session."""

    base_url: str
    verify: bool | str
    timeout: float
    request_origin: str
    csrf_cookie_name: str
    session: requests.Session = field(repr=False)

    def __post_init__(self) -> None:
        self.session.headers.update(
            {
                "Accept": "application/json",
                "Origin": self.request_origin,
                "X-S3-Workspace": "manager-browser",
            }
        )

    def _refresh(self) -> bool:
        response = self.session.post(
            f"{self.base_url}/auth/refresh",
            headers={"Accept": "application/json", "Origin": self.request_origin},
            timeout=self.timeout,
            verify=self.verify,
        )
        return response.status_code == 200

    def request(
        self,
        method: str,
        path: str,
        *,
        expected_status: int | Iterable[int] = (200,),
        **kwargs: Any,
    ) -> requests.Response:
        if not path.startswith("http"):
            url = f"{self.base_url}{path}"
        else:
            url = path
        headers = dict(kwargs.pop("headers", {}) or {})
        if method.upper() in {"POST", "PUT", "PATCH", "DELETE"}:
            csrf_token = self.session.cookies.get(self.csrf_cookie_name)
            if not csrf_token:
                raise BackendAPIError("Authenticated session is missing its CSRF cookie")
            headers.setdefault("X-CSRF-Token", csrf_token)
        if headers:
            kwargs["headers"] = headers
        response = self.session.request(
            method,
            url,
            timeout=self.timeout,
            verify=self.verify,
            **kwargs,
        )
        if response.status_code == 401 and self._refresh():
            if method.upper() in {"POST", "PUT", "PATCH", "DELETE"}:
                csrf_token = self.session.cookies.get(self.csrf_cookie_name)
                if not csrf_token:
                    raise BackendAPIError("Refreshed session is missing its CSRF cookie")
                headers["X-CSRF-Token"] = csrf_token
                kwargs["headers"] = headers
            response = self.session.request(
                method,
                url,
                timeout=self.timeout,
                verify=self.verify,
                **kwargs,
            )
        expected = _expected_set(expected_status)
        if response.status_code not in expected:
            body: Any
            try:
                body = response.json()
            except ValueError:
                body = response.text
            raise BackendAPIError(
                f"Unexpected response for {method} {url}",
                status_code=response.status_code,
                payload=body,
            )
        return response

    def json(
        self,
        method: str,
        path: str,
        *,
        expected_status: int | Iterable[int] = (200,),
        **kwargs: Any,
    ) -> Any:
        response = self.request(method, path, expected_status=expected_status, **kwargs)
        if not response.content:
            return None
        return response.json()

    def get(self, path: str, *, expected_status: int | Iterable[int] = (200,), **kwargs: Any) -> Any:
        return self.json("GET", path, expected_status=expected_status, **kwargs)

    def post(self, path: str, *, expected_status: int | Iterable[int] = (200,), **kwargs: Any) -> Any:
        return self.json("POST", path, expected_status=expected_status, **kwargs)

    def put(self, path: str, *, expected_status: int | Iterable[int] = (200,), **kwargs: Any) -> Any:
        return self.json("PUT", path, expected_status=expected_status, **kwargs)

    def delete(self, path: str, *, expected_status: int | Iterable[int] = (200,), **kwargs: Any) -> Any:
        response = self.request("DELETE", path, expected_status=expected_status, **kwargs)
        if response.content:
            return response.json()
        return None


class BackendAuthenticator:
    """Handles token acquisition for API users."""

    def __init__(self, settings: CephTestSettings) -> None:
        self.settings = settings
        self.base_url = settings.backend_base_url.rstrip("/")
        self.verify: bool | str = settings.backend_ca_bundle or settings.verify_tls
        self.timeout = settings.request_timeout
        self.login_retries = max(1, settings.login_max_retries)
        self.retry_delay = max(0.5, settings.login_retry_delay)
        self.request_origin = settings.request_origin
        self.csrf_cookie_name = settings.csrf_cookie_name
        self.access_cookie_name = settings.access_cookie_name
        self.refresh_cookie_name = settings.refresh_cookie_name
        self.bootstrap_access_cookie = settings.bootstrap_access_cookie
        self.bootstrap_refresh_cookie = settings.bootstrap_refresh_cookie
        self.bootstrap_csrf_token = settings.bootstrap_csrf_token

    def _bootstrap_super_admin_session(self, email: str) -> BackendSession | None:
        if email.strip().lower() != self.settings.super_admin_email.strip().lower():
            return None
        if not self.bootstrap_access_cookie or not self.bootstrap_csrf_token:
            return None
        session = requests.Session()
        session.cookies.set(self.access_cookie_name, self.bootstrap_access_cookie, path="/api")
        if self.bootstrap_refresh_cookie:
            session.cookies.set(self.refresh_cookie_name, self.bootstrap_refresh_cookie, path="/api/auth")
        session.cookies.set(self.csrf_cookie_name, self.bootstrap_csrf_token, path="/")
        return BackendSession(
            base_url=self.base_url,
            verify=self.verify,
            timeout=self.timeout,
            request_origin=self.request_origin,
            csrf_cookie_name=self.csrf_cookie_name,
            session=session,
        )

    def login(self, email: str, password: str) -> BackendSession:
        bootstrap_session = self._bootstrap_super_admin_session(email)
        if bootstrap_session is not None:
            return bootstrap_session
        attempt = 0
        last_error: Exception | None = None
        while attempt < self.login_retries:
            attempt += 1
            login_session = requests.Session()
            try:
                login_response = login_session.post(
                    f"{self.base_url}/auth/login",
                    data={"username": email, "password": password},
                    headers={
                        "Accept": "application/json",
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Origin": self.request_origin,
                    },
                    timeout=self.timeout,
                    verify=self.verify,
                )
            except requests.RequestException as exc:
                last_error = exc
                logger.warning("Login attempt %s for %s failed: %s", attempt, email, exc)
            else:
                if login_response.status_code != 200:
                    raise BackendAPIError(
                        f"Unable to login user {email}",
                        status_code=login_response.status_code,
                        payload=login_response.text,
                    )
                payload = login_response.json()
                if payload.get("status") != "authenticated":
                    raise BackendAPIError("Login did not create an authenticated session", payload=payload)
                if not login_session.cookies.get(self.csrf_cookie_name):
                    raise BackendAPIError("Login response did not include the CSRF cookie")
                return BackendSession(
                    base_url=self.base_url,
                    verify=self.verify,
                    timeout=self.timeout,
                    request_origin=self.request_origin,
                    csrf_cookie_name=self.csrf_cookie_name,
                    session=login_session,
                )
            time.sleep(self.retry_delay * attempt)
        raise BackendAPIError(f"Unable to login user {email}: {last_error}")


class CephVerifier:
    """Optional helper hitting RGW Admin APIs to validate Ceph state."""

    def __init__(self, settings: CephTestSettings) -> None:
        if not (
            settings.rgw_admin_endpoint
            and settings.rgw_admin_access_key
            and settings.rgw_admin_secret_key
        ):
            raise RuntimeError("RGW admin credentials are not configured")
        self.client = RGWAdminClient(
            access_key=settings.rgw_admin_access_key,
            secret_key=settings.rgw_admin_secret_key,
            endpoint=settings.rgw_admin_endpoint,
            region=settings.rgw_admin_region,
        )
        if settings.rgw_ca_bundle:
            self.client.session.verify = settings.rgw_ca_bundle
        else:
            self.client.session.verify = settings.rgw_verify_tls

    def bucket_exists(self, tenant: str, bucket_name: str) -> bool:
        try:
            account_id, resolved_tenant = resolve_account_scope(tenant)
            scope_kwargs: dict = {}
            if account_id:
                scope_kwargs["account_id"] = account_id
            elif resolved_tenant:
                scope_kwargs["tenant"] = resolved_tenant
            info = self.client.get_bucket_info(bucket_name, allow_not_found=True, **scope_kwargs)
        except RGWAdminError as exc:
            raise BackendAPIError(f"RGW bucket lookup failed: {exc}")
        return bool(info)

    def account_stats(self, tenant: str) -> dict[str, Any]:
        try:
            stats = self.client.get_account_stats(tenant)
        except RGWAdminError as exc:
            message = str(exc).lower()
            logger.warning("Skipping RGW account stats for %s: %s", tenant, exc)
            if "requires --account-id" in message:
                return {}
            raise BackendAPIError(f"RGW account stats failed: {exc}")
        return stats


__all__ = [
    "BackendAPIError",
    "BackendAuthenticator",
    "BackendSession",
    "CephVerifier",
]
