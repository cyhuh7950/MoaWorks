from __future__ import annotations

from dataclasses import dataclass
from email.message import EmailMessage
from email.policy import SMTP
from email.utils import make_msgid
import re
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


class LegacyRelayAdapter(Protocol):
    def send(self, envelope: dict, provider: dict) -> str: ...


SmtpFactory = Callable[..., SmtpClient]
MxResolver = Callable[[str], Sequence[str]]


class MailTransportFailure(ValueError):
    def __init__(self, message: str, *, transient: bool) -> None:
        super().__init__(message)
        self.transient = transient


@dataclass(frozen=True, slots=True)
class DkimSigningConfig:
    domain: str
    selector: str
    private_key: bytes


class DkimSigner(Protocol):
    def sign(self, message: EmailMessage, config: DkimSigningConfig) -> None: ...


class DkimPySigner:
    def sign(self, message: EmailMessage, config: DkimSigningConfig) -> None:
        import dkim

        signature = dkim.sign(
            message.as_bytes(policy=SMTP),
            selector=config.selector.encode("ascii"),
            domain=config.domain.encode("idna"),
            privkey=config.private_key,
            canonicalize=(b"relaxed", b"relaxed"),
            include_headers=[b"from", b"to", b"subject", b"date", b"message-id", b"reply-to"],
        ).decode("ascii")
        _, value = signature.split(":", 1)
        message["DKIM-Signature"] = re.sub(r"\r?\n[ \t]+", " ", value).strip()


@dataclass(frozen=True, slots=True)
class OutboundMessage:
    sender_email: str
    recipient_email: str
    subject: str
    body_text: str
    body_html: str | None
    message_id: str
    envelope_from: str | None = None


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


def resolve_mx_hosts(domain: str) -> list[str]:
    import dns.exception
    import dns.resolver

    normalized = domain.strip().lower().rstrip(".")
    if not normalized:
        raise ValueError("수신자 도메인이 비어 있습니다.")
    try:
        answers = dns.resolver.resolve(normalized, "MX", lifetime=10)
    except dns.resolver.NoAnswer:
        return [normalized]
    except dns.resolver.NXDOMAIN:
        return []
    except (dns.exception.Timeout, dns.resolver.NoNameservers) as exc:
        raise ValueError("외부 SMTP 대상 MX 조회에 실패했습니다.") from exc

    records = sorted(
        ((int(answer.preference), str(answer.exchange).strip().rstrip(".").lower()) for answer in answers),
        key=lambda item: item[0],
    )
    return [host for _, host in records if host]


class SelfHostedSmtpTransport:
    def __init__(self, *, mx_resolver: MxResolver, smtp_factory: SmtpFactory = smtplib.SMTP, dkim_signer: DkimSigner | None = None) -> None:
        self.mx_resolver = mx_resolver
        self.smtp_factory = smtp_factory
        self.dkim_signer = dkim_signer or DkimPySigner()

    def send(self, message: OutboundMessage, *, helo_name: str, timeout_sec: int, dkim_config: DkimSigningConfig | None = None) -> DeliveryReceipt:
        prepared = _build_message(message)
        if dkim_config is not None:
            self.dkim_signer.sign(prepared, dkim_config)
        recipient_domain = message.recipient_email.rsplit("@", 1)[1].lower()
        candidates = [host.strip().rstrip(".").lower() for host in self.mx_resolver(recipient_domain) if host.strip()]
        if not candidates:
            raise MailTransportFailure("외부 SMTP 대상 MX를 찾지 못했습니다.", transient=False)

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
                        from_addr=message.envelope_from or message.sender_email,
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
        transient = isinstance(
            last_error,
            (TimeoutError, OSError, smtplib.SMTPServerDisconnected, smtplib.SMTPConnectError),
        )
        if isinstance(last_error, smtplib.SMTPResponseException):
            transient = 400 <= int(last_error.smtp_code) < 500
        raise MailTransportFailure(f"자체 SMTP 발송 실패: {last_error}", transient=transient) from last_error


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
            raise MailTransportFailure("OCI SMTP 포트는 465 또는 587이어야 합니다.", transient=False)
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
                    from_addr=message.envelope_from or message.sender_email,
                    to_addrs=[message.recipient_email],
                )
                if refused:
                    raise ValueError("OCI SMTP 서버가 수신자를 거부했습니다.")
        except smtplib.SMTPAuthenticationError as exc:
            raise MailTransportFailure("OCI SMTP 인증 실패", transient=False) from exc
        except MailTransportFailure:
            raise
        except ValueError as exc:
            raise MailTransportFailure(str(exc), transient=False) from exc
        except (TimeoutError, OSError, smtplib.SMTPServerDisconnected, smtplib.SMTPConnectError) as exc:
            raise MailTransportFailure("OCI SMTP 연결 실패", transient=True) from exc
        except smtplib.SMTPResponseException as exc:
            raise MailTransportFailure(
                "OCI SMTP 응답 실패", transient=400 <= int(exc.smtp_code) < 500
            ) from exc
        except Exception as exc:  # pragma: no cover - network dependent
            raise MailTransportFailure("OCI SMTP 발송 실패", transient=False) from exc
        return DeliveryReceipt(
            provider_key="oci_email_delivery",
            endpoint=f"smtps://{config.host}:{config.port}",
            remote_smtp_accepted=True,
        )


class MailProviderRoutingAdapter:
    def __init__(
        self,
        *,
        self_hosted_transport: SelfHostedSmtpTransport,
        oci_transport: OciEmailDeliveryTransport,
        legacy_relay_adapter: LegacyRelayAdapter | None = None,
    ) -> None:
        self.self_hosted_transport = self_hosted_transport
        self.oci_transport = oci_transport
        self.legacy_relay_adapter = legacy_relay_adapter

    def send(self, envelope: dict, provider: dict) -> str:
        raw_provider_type = str(provider.get("provider_type") or "").strip().lower()
        provider_type = "self_hosted" if raw_provider_type == "self_hosted_smtp" else raw_provider_type
        sender_email = str(provider.get("from_address") or envelope.get("sender_email") or "").strip().lower()
        recipient_email = str(envelope.get("recipient_email") or "").strip().lower()
        sender_domain = sender_email.rsplit("@", 1)[-1] if "@" in sender_email else "localhost"
        queue_id = str(envelope.get("queue_id") or "").strip()
        bounce_domain = str(provider.get("dkim_domain") or sender_domain).strip().lower()
        envelope_from = f"bounce+{queue_id}@{bounce_domain}" if queue_id else sender_email
        message = OutboundMessage(
            sender_email=sender_email,
            recipient_email=recipient_email,
            subject=str(envelope.get("subject") or ""),
            body_text=str(envelope.get("body_text") or ""),
            body_html=envelope.get("body_html"),
            message_id=str(envelope.get("message_id") or make_msgid(domain=sender_domain)),
            envelope_from=envelope_from,
        )

        if provider_type == "self_hosted":
            private_key = provider.get("dkim_private_key")
            dkim_config = None
            if private_key:
                dkim_config = DkimSigningConfig(
                    domain=str(provider.get("dkim_domain") or sender_domain),
                    selector=str(provider.get("dkim_selector") or "selector1"),
                    private_key=str(private_key).encode("utf-8"),
                )
            receipt = self.self_hosted_transport.send(
                message,
                helo_name=str(provider.get("helo_name") or f"mail.{sender_domain}"),
                timeout_sec=int(provider.get("timeout_sec") or 20),
                dkim_config=dkim_config,
            )
        elif provider_type == "oci_email_delivery":
            password = str(provider.get("password") or "")
            if not password:
                raise MailTransportFailure("OCI SMTP 자격증명이 설정되지 않았습니다.", transient=False)
            receipt = self.oci_transport.send(
                message,
                config=RelaySmtpConfig(
                    host=str(provider.get("relay_host") or ""),
                    port=int(provider.get("relay_port") or 587),
                    username=str(provider.get("username") or ""),
                    password=password,
                    timeout_sec=int(provider.get("timeout_sec") or 20),
                ),
            )
        elif provider_type in {"smtp", "aws_ses"} and self.legacy_relay_adapter is not None:
            return self.legacy_relay_adapter.send(envelope, provider)
        else:
            raise MailTransportFailure(
                f"지원하지 않는 발신 Provider입니다: {raw_provider_type}", transient=False
            )

        return (
            f"provider={receipt.provider_key};endpoint={receipt.endpoint};"
            f"remote_smtp_accepted={str(receipt.remote_smtp_accepted).lower()}"
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
