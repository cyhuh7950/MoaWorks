from __future__ import annotations
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
import re
import smtplib
import ssl
from typing import Protocol

@dataclass(frozen=True)
class RecipientClassification:
    internal: list[tuple[str, str, str]]
    external: list[tuple[str, str]]

class MailDeliveryPolicy:
    def classify(self, company_domain: str, active_users: dict[str, str], recipients: list[tuple[str, str]]) -> RecipientClassification:
        domain = company_domain.strip().lower()
        users = {email.lower(): user_id for email, user_id in active_users.items()}
        internal, external = [], []
        for kind, raw_email in recipients:
            email = raw_email.strip().lower()
            user_id = users.get(email)
            if user_id:
                internal.append((kind, email, user_id))
            elif email.rsplit("@", 1)[-1] == domain:
                raise ValueError("등록되지 않은 사내 주소로는 메일을 보낼 수 없습니다.")
            else:
                external.append((kind, email))
        return RecipientClassification(internal, external)

@dataclass(frozen=True)
class DeliveryResult:
    status: str
    relay_response: str | None = None
    error_message: str | None = None
    next_attempt_at: datetime | None = None

class RelayDeliveryError(RuntimeError):
    def __init__(self, message: str, transient: bool = False):
        super().__init__(message)
        self.transient = transient

class RelayAdapter(Protocol):
    def send(self, envelope: dict, provider: dict) -> str: ...

_SECRET_RE = re.compile(r"(?i)(password|token|authorization|secret)\s*[:=]\s*(?:bearer\s+)?[^\s,;]+")
_EMAIL_RE = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.I)
def mask_delivery_error(message: str) -> str:
    masked = _SECRET_RE.sub(lambda match: f"{match.group(1)}=[REDACTED]", str(message))
    masked = _EMAIL_RE.sub("[EMAIL]", masked)
    return masked[:500]

def _job_value(job, name: str, default=None):
    return job.get(name, default) if isinstance(job, dict) else getattr(job, name, default)

class MailDeliveryWorker:
    def __init__(self, worker_id: str, adapter: RelayAdapter):
        self.worker_id, self.adapter = worker_id, adapter
    def deliver_claimed(self, job, provider: dict) -> DeliveryResult:
        if not provider.get("delivery_enabled") or provider.get("last_test_status") != "success":
            return DeliveryResult("blocked", error_message="외부 발송 잠금 또는 연결 검증이 필요합니다.")
        attempt = int(_job_value(job, "attempt_count", 0)) + 1
        envelope = {key: _job_value(job, key) for key in ("sender_email","recipient_email","subject","body_text","body_html","attachments")}
        try:
            response = self.adapter.send(envelope, provider)
            return DeliveryResult("sent", relay_response=mask_delivery_error(response))
        except RelayDeliveryError as exc:
            maximum = int(provider.get("max_retry_count", 3))
            error = mask_delivery_error(str(exc))
            if exc.transient and attempt < maximum:
                delay = int(provider.get("retry_interval_sec", 60)) * (2 ** (attempt - 1))
                return DeliveryResult("retry_pending", error_message=error, next_attempt_at=datetime.now(UTC)+timedelta(seconds=delay))
            return DeliveryResult("failed", error_message=error)

class SmtpRelayAdapter:
    def send(self, envelope: dict, provider: dict) -> str:
        message = EmailMessage()
        message["From"] = provider.get("from_address") or envelope["sender_email"]
        message["To"] = envelope["recipient_email"]
        message["Subject"] = envelope["subject"]
        message.set_content(envelope["body_text"])
        if envelope.get("body_html"):
            message.add_alternative(envelope["body_html"], subtype="html")
        host, port = provider["relay_host"], int(provider["relay_port"])
        tls_mode = provider.get("tls_mode", "starttls")
        client_cls = smtplib.SMTP_SSL if tls_mode == "tls" else smtplib.SMTP
        try:
            with client_cls(host, port, timeout=10, context=ssl.create_default_context()) if tls_mode == "tls" else client_cls(host, port, timeout=10) as client:
                client.ehlo()
                if tls_mode == "starttls":
                    client.starttls(context=ssl.create_default_context()); client.ehlo()
                if provider.get("username"):
                    client.login(provider["username"], provider["password"])
                refused = client.send_message(message)
                if refused:
                    raise RelayDeliveryError("relay recipient refused", transient=False)
                return "relay accepted"
        except (TimeoutError, OSError, smtplib.SMTPServerDisconnected, smtplib.SMTPConnectError) as exc:
            raise RelayDeliveryError(str(exc), transient=True) from exc
        except smtplib.SMTPException as exc:
            raise RelayDeliveryError(str(exc), transient=False) from exc
