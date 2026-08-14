# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.services import smtp_mailer
from app.services.smtp_mailer import SMTPMailer


def test_smtp_mailer_adds_message_id_and_date_headers(monkeypatch):
    captured: dict[str, object] = {}

    class _FakeSMTP:
        def __init__(self, host: str, port: int, timeout: int):
            captured["host"] = host
            captured["port"] = port
            captured["timeout"] = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def ehlo(self):
            return None

        def starttls(self):
            return None

        def login(self, username: str, password: str):
            captured["username"] = username
            captured["password"] = password
            return None

        def send_message(self, message):
            captured["message"] = message
            return None

    monkeypatch.setattr(smtp_mailer.smtplib, "SMTP", _FakeSMTP)

    mailer = SMTPMailer(
        host="smtp.example.test",
        port=587,
        username="smtp-user",
        password="smtp-password",
        from_email="alerts@example.test",
        from_name="Quota Alerts",
        starttls=True,
        timeout_seconds=15,
    )
    mailer.send(
        recipients=["recipient@example.test"],
        subject="SMTP header test",
        body="hello",
    )

    message = captured.get("message")
    assert message is not None
    assert message["Message-ID"] is not None
    assert str(message["Message-ID"]).endswith("@example.test>")
    assert message["Date"] is not None
