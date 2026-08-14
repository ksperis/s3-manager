# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from email.message import EmailMessage
from email.utils import formatdate, make_msgid
import smtplib
from typing import Optional


class SMTPMailer:
    """Send standards-compliant plain-text messages through SMTP."""

    def __init__(
        self,
        *,
        host: str,
        port: int,
        username: Optional[str],
        password: Optional[str],
        from_email: str,
        from_name: Optional[str],
        starttls: bool,
        timeout_seconds: int,
    ) -> None:
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.from_email = from_email
        self.from_name = from_name
        self.starttls = starttls
        self.timeout_seconds = timeout_seconds

    def send(
        self,
        *,
        recipients: list[str],
        subject: str,
        body: str,
    ) -> None:
        if not recipients:
            return
        message = EmailMessage()
        message["To"] = ", ".join(recipients)
        message["From"] = (
            f"{self.from_name} <{self.from_email}>"
            if self.from_name
            else self.from_email
        )
        message["Subject"] = subject
        message["Message-ID"] = make_msgid(
            domain=self._message_id_domain()
        )
        message["Date"] = formatdate(localtime=True)
        message.set_content(body)

        with smtplib.SMTP(
            self.host,
            self.port,
            timeout=self.timeout_seconds,
        ) as smtp:
            smtp.ehlo()
            if self.starttls:
                smtp.starttls()
                smtp.ehlo()
            if self.username or self.password:
                smtp.login(self.username or "", self.password or "")
            smtp.send_message(message)

    def _message_id_domain(self) -> str:
        sender = (self.from_email or "").strip()
        if "@" not in sender:
            return "localhost"
        domain = sender.rsplit("@", 1)[1].strip()
        return domain or "localhost"
