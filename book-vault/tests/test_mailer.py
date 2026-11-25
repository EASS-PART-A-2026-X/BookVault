"""The mail backends and their settings (no real email is sent)."""

import json
import logging
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from app.mailer import (
    ConsoleMailer,
    Email,
    FileMailer,
    MailConfigError,
    SmtpMailer,
    base_url_from_env,
    mailer_from_env,
    send_quietly,
)

MESSAGE = Email(to="gal@example.com", subject="Hi", body="Line one\nhttp://x/reset")


def test_default_is_console(caplog: pytest.LogCaptureFixture) -> None:
    mailer = mailer_from_env({})
    assert isinstance(mailer, ConsoleMailer)
    with caplog.at_level(logging.WARNING, logger="bookvault.mail"):
        mailer.send(MESSAGE)
    assert "gal@example.com" in caplog.text and "http://x/reset" in caplog.text


def test_file_backend_writes_json(tmp_path: Path) -> None:
    mailer = mailer_from_env({"EMAIL_BACKEND": "file", "EMAIL_OUTBOX_DIR": str(tmp_path / "out")})
    assert isinstance(mailer, FileMailer)
    mailer.send(MESSAGE)
    [path] = (tmp_path / "out").iterdir()
    assert json.loads(path.read_text()) == {
        "to": "gal@example.com",
        "subject": "Hi",
        "body": MESSAGE.body,
    }


def test_smtp_backend_settings() -> None:
    mailer = mailer_from_env(
        {
            "EMAIL_BACKEND": " SMTP ",
            "SMTP_HOST": "smtp.example.com",
            "SMTP_PORT": "2525",
            "SMTP_FROM": "Book Vault <no-reply@example.com>",
            "SMTP_USERNAME": "user",
            "SMTP_PASSWORD": "secret",
            "SMTP_STARTTLS": "false",
        }
    )
    assert mailer == SmtpMailer(
        host="smtp.example.com",
        port=2525,
        sender="Book Vault <no-reply@example.com>",
        username="user",
        password="secret",
        starttls=False,
    )
    assert "secret" not in repr(mailer)


def test_smtp_send_uses_starttls_and_login() -> None:
    mailer = SmtpMailer(host="h", port=587, sender="a@b.c", username="u", password="p")
    with patch("app.mailer.smtplib.SMTP") as smtp_class:
        smtp = MagicMock()
        smtp_class.return_value.__enter__.return_value = smtp
        mailer.send(MESSAGE)
    smtp_class.assert_called_once_with("h", 587, timeout=10)
    smtp.starttls.assert_called_once()
    smtp.login.assert_called_once_with("u", "p")
    sent = smtp.send_message.call_args.args[0]
    assert sent["To"] == "gal@example.com" and sent["From"] == "a@b.c"
    assert "http://x/reset" in sent.get_content()


def test_smtp_send_without_tls_or_login() -> None:
    mailer = SmtpMailer(host="h", port=25, sender="a@b.c", starttls=False)
    with patch("app.mailer.smtplib.SMTP") as smtp_class:
        smtp = MagicMock()
        smtp_class.return_value.__enter__.return_value = smtp
        mailer.send(MESSAGE)
    smtp.starttls.assert_not_called()
    smtp.login.assert_not_called()
    smtp.send_message.assert_called_once()


@pytest.mark.parametrize(
    ("env", "message"),
    [
        ({"EMAIL_BACKEND": "pigeon"}, "EMAIL_BACKEND must be console, file or smtp"),
        ({"EMAIL_BACKEND": "file"}, "EMAIL_OUTBOX_DIR"),
        ({"EMAIL_BACKEND": "smtp", "SMTP_FROM": "a@b.c"}, "SMTP_HOST and SMTP_FROM"),
        ({"EMAIL_BACKEND": "smtp", "SMTP_HOST": "h"}, "SMTP_HOST and SMTP_FROM"),
        (
            {"EMAIL_BACKEND": "smtp", "SMTP_HOST": "h", "SMTP_FROM": "a@b.c", "SMTP_PORT": "x"},
            "SMTP_PORT must be a port number",
        ),
        (
            {"EMAIL_BACKEND": "smtp", "SMTP_HOST": "h", "SMTP_FROM": "a@b.c", "SMTP_PORT": "0"},
            "SMTP_PORT must be a port number",
        ),
        (
            {"EMAIL_BACKEND": "smtp", "SMTP_HOST": "h", "SMTP_FROM": "a@b", "SMTP_STARTTLS": "?"},
            "SMTP_STARTTLS must be true or false",
        ),
    ],
)
def test_invalid_settings_name_the_variable(env: dict[str, str], message: str) -> None:
    with pytest.raises(MailConfigError, match=message):
        mailer_from_env(env)


def test_starttls_accepts_true() -> None:
    env = {"EMAIL_BACKEND": "smtp", "SMTP_HOST": "h", "SMTP_FROM": "a@b.c", "SMTP_STARTTLS": "yes"}
    mailer = mailer_from_env(env)
    assert isinstance(mailer, SmtpMailer) and mailer.starttls and mailer.port == 587


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (None, "http://localhost:8080"),
        ("https://demo.example.com/", "https://demo.example.com"),
        ("http://localhost:5173", "http://localhost:5173"),
    ],
)
def test_base_url(raw: str | None, expected: str) -> None:
    env = {} if raw is None else {"APP_BASE_URL": raw}
    assert base_url_from_env(env) == expected


@pytest.mark.parametrize("raw", ["demo.example.com", "ftp://x", "https://"])
def test_bad_base_url(raw: str) -> None:
    with pytest.raises(MailConfigError, match="APP_BASE_URL"):
        base_url_from_env({"APP_BASE_URL": raw})


def test_send_quietly_logs_failures_without_details(caplog: pytest.LogCaptureFixture) -> None:
    broken = MagicMock()
    broken.send.side_effect = OSError("password=hunter2 rejected")
    send_quietly(broken, MESSAGE)
    assert "could not send email to gal@example.com: OSError" in caplog.text
    assert "hunter2" not in caplog.text


def test_the_app_uses_the_configured_mailer() -> None:
    from app.auth import MAILER, get_mailer

    assert get_mailer() is MAILER


def test_starttls_accepts_false_words() -> None:
    env = {"EMAIL_BACKEND": "smtp", "SMTP_HOST": "h", "SMTP_FROM": "a@b.c", "SMTP_STARTTLS": "off"}
    mailer = mailer_from_env(env)
    assert isinstance(mailer, SmtpMailer) and not mailer.starttls


def test_starttls_is_on_by_default() -> None:
    mailer = mailer_from_env({"EMAIL_BACKEND": "smtp", "SMTP_HOST": "h", "SMTP_FROM": "a@b.c"})
    assert isinstance(mailer, SmtpMailer) and mailer.starttls
