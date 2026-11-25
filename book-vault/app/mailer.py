"""Sending email (only password reset links today). Standard library only.

EMAIL_BACKEND picks how mail goes out:
- "console" (default): the message is written to the server log. For local use only:
  anyone who can read the log can use the link.
- "file": each message is saved as a JSON file in EMAIL_OUTBOX_DIR. Used by the e2e tests
  and the Compose smoke test to "receive" the email.
- "smtp": real email through an SMTP server (your provider's settings):
  SMTP_HOST, SMTP_PORT (587), SMTP_USERNAME, SMTP_PASSWORD, SMTP_STARTTLS (true), SMTP_FROM.

APP_BASE_URL is the public address the links point to (default http://localhost:8080).
Invalid settings stop the app at startup with a message naming the variable.
"""

import json
import logging
import os
import smtplib
import ssl
import time
from collections.abc import Mapping
from dataclasses import dataclass, field
from email.message import EmailMessage
from pathlib import Path
from typing import Protocol
from urllib.parse import urlsplit

logger = logging.getLogger("bookvault.mail")


@dataclass(frozen=True)
class Email:
    to: str
    subject: str
    body: str


class Mailer(Protocol):
    def send(self, message: Email) -> None: ...


class ConsoleMailer:
    def send(self, message: Email) -> None:
        logger.warning(
            "EMAIL_BACKEND=console (local use only), email to %s:\nSubject: %s\n\n%s",
            message.to,
            message.subject,
            message.body,
        )


@dataclass
class FileMailer:
    outbox: Path

    def send(self, message: Email) -> None:
        self.outbox.mkdir(parents=True, exist_ok=True)
        name = f"{time.time_ns()}.json"
        data = {"to": message.to, "subject": message.subject, "body": message.body}
        (self.outbox / name).write_text(json.dumps(data), encoding="utf-8")


@dataclass
class SmtpMailer:
    host: str
    port: int
    sender: str
    username: str = ""
    password: str = field(default="", repr=False)
    starttls: bool = True
    timeout: float = 10

    def send(self, message: Email) -> None:
        mail = EmailMessage()
        mail["From"] = self.sender
        mail["To"] = message.to
        mail["Subject"] = message.subject
        mail.set_content(message.body)
        with smtplib.SMTP(self.host, self.port, timeout=self.timeout) as smtp:
            if self.starttls:
                smtp.starttls(context=ssl.create_default_context())
            if self.username:
                smtp.login(self.username, self.password)
            smtp.send_message(mail)


@dataclass
class MemoryMailer:
    """Keeps messages in a list. For tests."""

    sent: list[Email] = field(default_factory=list)

    def send(self, message: Email) -> None:
        self.sent.append(message)


class MailConfigError(RuntimeError):
    pass


def _flag(env: Mapping[str, str], name: str, default: bool) -> bool:
    raw = env.get(name, "").strip().lower()
    if not raw:
        return default
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    raise MailConfigError(f"{name} must be true or false, got {raw!r}")


def mailer_from_env(env: Mapping[str, str] = os.environ) -> Mailer:
    backend = env.get("EMAIL_BACKEND", "console").strip().lower() or "console"
    if backend == "console":
        return ConsoleMailer()
    if backend == "file":
        outbox = env.get("EMAIL_OUTBOX_DIR", "").strip()
        if not outbox:
            raise MailConfigError("EMAIL_BACKEND=file needs EMAIL_OUTBOX_DIR")
        return FileMailer(Path(outbox))
    if backend == "smtp":
        host = env.get("SMTP_HOST", "").strip()
        sender = env.get("SMTP_FROM", "").strip()
        if not host or not sender:
            raise MailConfigError("EMAIL_BACKEND=smtp needs SMTP_HOST and SMTP_FROM")
        raw_port = env.get("SMTP_PORT", "").strip() or "587"
        if not raw_port.isdigit() or not 0 < int(raw_port) < 65536:
            raise MailConfigError(f"SMTP_PORT must be a port number, got {raw_port!r}")
        return SmtpMailer(
            host=host,
            port=int(raw_port),
            sender=sender,
            username=env.get("SMTP_USERNAME", "").strip(),
            password=env.get("SMTP_PASSWORD", ""),
            starttls=_flag(env, "SMTP_STARTTLS", True),
        )
    raise MailConfigError(f"EMAIL_BACKEND must be console, file or smtp, got {backend!r}")


def base_url_from_env(env: Mapping[str, str] = os.environ) -> str:
    raw = env.get("APP_BASE_URL", "").strip() or "http://localhost:8080"
    parts = urlsplit(raw)
    if parts.scheme not in {"http", "https"} or not parts.netloc:
        raise MailConfigError(f"APP_BASE_URL must be an http(s) address, got {raw!r}")
    return raw.rstrip("/")


def send_quietly(mailer: Mailer, message: Email) -> None:
    """Send, and log a failure instead of raising: it runs after the response was sent,
    and the reader is told the same thing whether or not an email goes out."""
    try:
        mailer.send(message)
    except Exception as exc:  # noqa: BLE001 - any delivery failure is only logged
        logger.error("could not send email to %s: %s", message.to, type(exc).__name__)
