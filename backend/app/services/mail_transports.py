from __future__ import annotations

from dataclasses import dataclass
from email.message import EmailMessage
import smtplib
import ssl
from typing import Callable, Protocol, Sequence


class SmtpClient(Protocol):
    def __enter__(self): ...

    def __exit__(self, exc_type, exc, traceback) -> None: ...

    def ehlo(self, name: str | None = None) -> object: ...

    def has_extn(self, name: str) -> bool: ...

    def starttls(self, context=None) -> object: ...

    def login(self, username: str, password: str) -> object: ...

    def send_message(self, message, *, from_addr: str, to_addrs: list[str]) -> dict: ...


SmtpFactory = Callable[..., SmtpClient]
MxResolver = Callable[[str], Sequence[str]]


@dataclass(frozen=True, slots=True)
class OutboundMessage:
    sender_email: str
    recipient_email: str
    subject: str
    body_text: str
    body_html: str | None
    message_id: str


@dataclass(frozen=True, slots=True)
class RelaySmtpConfig:
    host: str
    port: int
    username: str
    password: str
    timeout_sec: int = 20


@dataclass(frozen=True, slots=True)
class DeliveryReceipt:
    provider_key: str
    endpoint: str
    remote_smtp_accepted: bool


class SelfHostedSmtpTransport:
    def __init__(self, *, mx_resolver: MxResolver, smtp_factory: SmtpFactory = smtplib.SMTP) -> None:
        self.mx_resolver = mx_resolver
        self.smtp_factory = smtp_factory

    def send(self, message: OutboundMessage, *, helo_name: str, timeout_sec: int) -> DeliveryReceipt:
        prepared = _build_message(message)
        recipient_domain = message.recipient_email.rsplit("@", 1)[1].lower()
        candidates = [host.strip().rstrip(".").lower() for host in self.mx_resolver(recipient_domain) if host.strip()]
        if not candidates:
            raise ValueError("외부 SMTP 대상 MX를 찾지 못했습니다.")

        last_error: Exception | None = None
        for host in candidates:
            try:
                with self.smtp_factory(host=host, port=25, timeout=max(3, min(timeout_sec, 60))) as smtp:
                    smtp.ehlo(helo_name)
                    if smtp.has_extn("starttls"):
                        smtp.starttls(context=ssl.create_default_context())
                        smtp.ehlo(helo_name)
                    refused = smtp.send_message(
                        prepared,
                        from_addr=message.sender_email,
                        to_addrs=[message.recipient_email],
                    )
                    if refused:
                        raise ValueError("상대 SMTP 서버가 수신자를 거부했습니다.")
                return DeliveryReceipt(
                    provider_key="self_hosted",
                    endpoint=f"smtp://{host}:25",
                    remote_smtp_accepted=True,
                )
            except Exception as exc:  # pragma: no cover - multi-host network path
                last_error = exc
        raise ValueError(f"자체 SMTP 발송 실패: {last_error}") from last_error


class OciEmailDeliveryTransport:
    def __init__(
        self,
        *,
        smtp_factory: SmtpFactory = smtplib.SMTP,
        smtp_ssl_factory: SmtpFactory = smtplib.SMTP_SSL,
    ) -> None:
        self.smtp_factory = smtp_factory
        self.smtp_ssl_factory = smtp_ssl_factory

    def send(self, message: OutboundMessage, *, config: RelaySmtpConfig) -> DeliveryReceipt:
        if config.port not in {465, 587}:
            raise ValueError("OCI SMTP 포트는 465 또는 587이어야 합니다.")
        prepared = _build_message(message)
        factory = self.smtp_ssl_factory if config.port == 465 else self.smtp_factory
        try:
            with factory(
                host=config.host,
                port=config.port,
                timeout=max(3, min(config.timeout_sec, 60)),
            ) as smtp:
                smtp.ehlo()
                if config.port == 587:
                    if not smtp.has_extn("starttls"):
                        raise ValueError("OCI SMTP 서버가 STARTTLS를 제공하지 않습니다.")
                    smtp.starttls(context=ssl.create_default_context())
                    smtp.ehlo()
                smtp.login(config.username, config.password)
                refused = smtp.send_message(
                    prepared,
                    from_addr=message.sender_email,
                    to_addrs=[message.recipient_email],
                )
                if refused:
                    raise ValueError("OCI SMTP 서버가 수신자를 거부했습니다.")
        except smtplib.SMTPAuthenticationError as exc:
            raise ValueError("OCI SMTP 인증 실패") from exc
        except ValueError:
            raise
        except Exception as exc:  # pragma: no cover - network dependent
            raise ValueError("OCI SMTP 발송 실패") from exc
        return DeliveryReceipt(
            provider_key="oci_email_delivery",
            endpoint=f"smtps://{config.host}:{config.port}",
            remote_smtp_accepted=True,
        )


def _build_message(source: OutboundMessage) -> EmailMessage:
    for header_value in (
        source.sender_email,
        source.recipient_email,
        source.subject,
        source.message_id,
    ):
        if "\r" in header_value or "\n" in header_value:
            raise ValueError("메일 헤더에 허용되지 않는 줄바꿈이 있습니다.")
    if "@" not in source.sender_email or "@" not in source.recipient_email:
        raise ValueError("발신자와 수신자 이메일 형식이 올바르지 않습니다.")

    message = EmailMessage()
    message["From"] = source.sender_email
    message["To"] = source.recipient_email
    message["Subject"] = source.subject
    message["Reply-To"] = source.sender_email
    message["Message-ID"] = source.message_id
    message.set_content(source.body_text or "")
    if source.body_html:
        message.add_alternative(source.body_html, subtype="html")
    return message
