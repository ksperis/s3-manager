# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.db import User, UserRole
from app.main import app
from app.routers import dependencies
from app.services.quota_monitoring_service import QuotaMonitoringService
from fastapi.testclient import TestClient


def _admin_user() -> User:
    return User(
        id=3101,
        email="admin@example.com",
        full_name="Admin",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_ADMIN.value,
    )


def _superadmin_user() -> User:
    return User(
        id=3102,
        email="superadmin@example.com",
        full_name="Super Admin",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_SUPERADMIN.value,
    )


def _smtp_payload() -> dict:
    return {
        "threshold_percent": 85,
        "include_subject_contact_email": False,
        "smtp_host": "smtp.example.test",
        "smtp_port": 587,
        "smtp_username": "smtp-user",
        "smtp_from_email": "alerts@example.test",
        "smtp_from_name": "S3 Manager",
        "smtp_starttls": True,
        "smtp_timeout_seconds": 15,
    }


def test_superadmin_can_send_quota_notification_test_email(client: TestClient, monkeypatch):
    app.dependency_overrides[dependencies.get_current_user] = _superadmin_user
    app.dependency_overrides.pop(dependencies.get_current_ui_superadmin, None)

    def _fake_send_test_email(self, *, notification_settings, recipient_email):
        assert recipient_email == "superadmin@example.com"
        assert notification_settings.smtp_host == "smtp.example.test"
        return {
            "status": "sent",
            "recipient": recipient_email,
            "sent_at": "2026-01-01T00:00:00",
        }

    monkeypatch.setattr(QuotaMonitoringService, "send_test_email", _fake_send_test_email)

    response = client.post("/api/admin/settings/quota-notifications/test-email", json=_smtp_payload())
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "sent"
    assert payload["recipient"] == "superadmin@example.com"


def test_admin_cannot_send_quota_notification_test_email(client: TestClient):
    app.dependency_overrides[dependencies.get_current_user] = _admin_user
    app.dependency_overrides.pop(dependencies.get_current_ui_superadmin, None)

    response = client.post("/api/admin/settings/quota-notifications/test-email", json=_smtp_payload())
    assert response.status_code == 403, response.text
