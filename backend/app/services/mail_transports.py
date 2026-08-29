from __future__ import annotations

from dataclasses import dataclass
from email.message import EmailMessage
from email.policy import SMTP
from email.utils import make_msgid
from hashlib import sha256
from pathlib import Path
import re
from secrets import compare_digest
import smtplib
import ssl
from typing import Callable, Protocol, Sequence

from app.services.mail_mime_builder import (
    OutboundAttachment,
    OutboundMessage,
    build_mail_message,
)


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


@dataclass(frozen=True, slots=True)
class PreparedMailDelivery:
    provider_type: str
    message: EmailMessage
    envelope_from: str
    recipient_email: str
    legacy_envelope: dict | None = None
    outbound_message: OutboundMessage | None = None


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

    def send(
        self,
        message: OutboundMessage,
        *,
        helo_name: str,
        timeout_sec: int,
        dkim_config: DkimSigningConfig | None = None,
        relay_host: str = "",
        relay_port: int = 25,
        tls_mode: str = "opportunistic",
        username: str = "",
        password: str = "",
    ) -> DeliveryReceipt:
        try:
            prepared = build_mail_message(message)
        except ValueError as exc:
            raise MailTransportFailure(str(exc), transient=False) from exc
        if dkim_config is not None:
            self.dkim_signer.sign(prepared, dkim_config)
        return self.send_prepared(
            prepared,
            envelope_from=message.envelope_from or message.sender_email,
            recipient_email=message.recipient_email,
            helo_name=helo_name,
            timeout_sec=timeout_sec,
            relay_host=relay_host,
            relay_port=relay_port,
            tls_mode=tls_mode,
            username=username,
            password=password,
        )

    def send_prepared(
        self,
        prepared: EmailMessage,
        *,
        envelope_from: str,
        recipient_email: str,
        helo_name: str,
        timeout_sec: int,
        relay_host: str = "",
        relay_port: int = 25,
        tls_mode: str = "opportunistic",
        username: str = "",
        password: str = "",
    ) -> DeliveryReceipt:
        normalized_relay_host = relay_host.strip().rstrip(".").lower()
        normalized_username = username.strip()
        if normalized_relay_host and bool(normalized_username) != bool(password):
            raise MailTransportFailure("자체 SMTP 릴레이 자격증명이 완전하지 않습니다.", transient=False)
        if normalized_relay_host:
            candidates = [(normalized_relay_host, relay_port)]
        else:
            recipient_domain = recipient_email.rsplit("@", 1)[1].lower()
            candidates = [
                (host.strip().rstrip(".").lower(), 25)
                for host in self.mx_resolver(recipient_domain)
                if host.strip()
            ]
        if not candidates:
            raise MailTransportFailure("외부 SMTP 대상 MX를 찾지 못했습니다.", transient=False)

        last_error: Exception | None = None
        for host, port in candidates:
            try:
                with self.smtp_factory(host=host, port=port, timeout=max(3, min(timeout_sec, 60))) as smtp:
                    smtp.ehlo(helo_name)
                    starttls_required = normalized_relay_host and tls_mode == "starttls"
                    if starttls_required and not smtp.has_extn("starttls"):
                        raise ValueError("자체 SMTP 릴레이가 STARTTLS를 제공하지 않습니다.")
                    if starttls_required or (not normalized_relay_host and smtp.has_extn("starttls")):
                        smtp.starttls(context=ssl.create_default_context())
                        smtp.ehlo(helo_name)
                    if normalized_relay_host and normalized_username:
                        smtp.login(normalized_username, password)
                    refused = smtp.send_message(
                        prepared,
                        from_addr=envelope_from,
                        to_addrs=[recipient_email],
                    )
                    if refused:
                        raise ValueError("상대 SMTP 서버가 수신자를 거부했습니다.")
                return DeliveryReceipt(
                    provider_key="self_hosted",
                    endpoint=f"smtp://{host}:{port}",
                    remote_smtp_accepted=True,
                )
            except Exception as exc:  # pragma: no cover - multi-host network path
                last_error = exc
        transient = isinstance(
            last_error,
            (TimeoutError, OSError, smtplib.SMTPServerDisconnected, smtplib.SMTPConnectError),
        )
        if isinstance(last_error, smtplib.SMTPAuthenticationError):
            raise MailTransportFailure("자체 SMTP 릴레이 인증 실패", transient=False) from last_error
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
        try:
            prepared = build_mail_message(message)
        except ValueError as exc:
            raise MailTransportFailure(str(exc), transient=False) from exc
        return self.send_prepared(
            prepared,
            envelope_from=message.envelope_from or message.sender_email,
            recipient_email=message.recipient_email,
            config=config,
        )

    def send_prepared(
        self,
        prepared: EmailMessage,
        *,
        envelope_from: str,
        recipient_email: str,
        config: RelaySmtpConfig,
    ) -> DeliveryReceipt:
        if config.port not in {465, 587}:
            raise MailTransportFailure("OCI SMTP 포트는 465 또는 587이어야 합니다.", transient=False)
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
                    from_addr=envelope_from,
                    to_addrs=[recipient_email],
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

    def prepare(self, envelope: dict, provider: dict) -> PreparedMailDelivery:
        raw_provider_type = str(provider.get("provider_type") or "").strip().lower()
        provider_type = "self_hosted" if raw_provider_type == "self_hosted_smtp" else raw_provider_type
        delivery_kind = str(envelope.get("delivery_kind") or "direct")
        automatic = delivery_kind in {"auto_forward", "out_of_office"}
        sender_email = str(
            envelope.get("sender_email")
            if automatic
            else provider.get("from_address") or envelope.get("sender_email") or ""
        ).strip().lower()
        recipient_email = str(envelope.get("recipient_email") or "").strip().lower()
        sender_domain = sender_email.rsplit("@", 1)[-1] if "@" in sender_email else "localhost"
        queue_id = str(envelope.get("queue_id") or "").strip()
        bounce_domain = str(provider.get("dkim_domain") or sender_domain).strip().lower()
        envelope_from = sender_email
        if provider_type != "oci_email_delivery" and queue_id:
            envelope_from = f"bounce+{queue_id}@{bounce_domain}"
        attachments: list[OutboundAttachment] = []
        for item in envelope.get("attachments") or []:
            path = Path(str(item.get("path") or ""))
            if not path.is_file():
                raise MailTransportFailure("첨부 파일을 찾을 수 없습니다.", transient=False)
            content = path.read_bytes()
            expected_size = item.get("size_bytes")
            if expected_size is not None and len(content) != int(expected_size):
                raise MailTransportFailure("첨부 파일 저장 상태가 올바르지 않습니다.", transient=False)
            expected_sha256 = item.get("sha256")
            if expected_sha256 is not None and (
                not isinstance(expected_sha256, str)
                or not compare_digest(expected_sha256, sha256(content).hexdigest())
            ):
                raise MailTransportFailure("첨부 파일 저장 상태가 올바르지 않습니다.", transient=False)
            attachments.append(
                OutboundAttachment(
                    file_name=Path(str(item.get("file_name") or "attachment.bin").replace("\\", "/")).name[:255],
                    content_type=str(item.get("content_type") or "application/octet-stream"),
                    content=content,
                    content_disposition=str(item.get("content_disposition") or "attachment"),
                    content_id=item.get("content_id"),
                )
            )
        message_id = str(envelope.get("message_id") or "").strip()
        if not message_id:
            stable_id = str(envelope.get("mail_id") or queue_id).strip()
            message_id = f"<{stable_id}@{sender_domain}>" if stable_id else make_msgid(domain=sender_domain)
        message = OutboundMessage(
            sender_email=sender_email,
            recipient_email=recipient_email,
            subject=str(envelope.get("subject") or ""),
            body_text=str(envelope.get("body_text") or ""),
            body_html=envelope.get("body_html"),
            message_id=message_id,
            sender_display_name=str(envelope.get("sender_display_name") or ""),
            reply_to_email=envelope.get("reply_to_email"),
            message_encoding=str(envelope.get("message_encoding") or "utf-8"),
            envelope_from=envelope_from,
            attachments=tuple(attachments),
        )

        try:
            prepared_message = build_mail_message(message)
        except ValueError as exc:
            raise MailTransportFailure(str(exc), transient=False) from exc

        if provider_type == "self_hosted":
            private_key = provider.get("dkim_private_key")
            if private_key:
                self.self_hosted_transport.dkim_signer.sign(
                    prepared_message,
                    DkimSigningConfig(
                        domain=str(provider.get("dkim_domain") or sender_domain),
                        selector=str(provider.get("dkim_selector") or "selector1"),
                        private_key=str(private_key).encode("utf-8"),
                    ),
                )
            normalized_relay_host = str(provider.get("relay_host") or "").strip()
            normalized_username = str(provider.get("username") or "").strip()
            password = str(provider.get("password") or "")
            if (
                hasattr(self.self_hosted_transport, "send_prepared")
                and normalized_relay_host
                and bool(normalized_username) != bool(password)
            ):
                raise MailTransportFailure("자체 SMTP 릴레이 자격증명이 완전하지 않습니다.", transient=False)
        elif provider_type == "oci_email_delivery":
            port = int(provider.get("relay_port") or 587)
            if port not in {465, 587}:
                raise MailTransportFailure("OCI SMTP 포트는 465 또는 587이어야 합니다.", transient=False)
            if not str(provider.get("password") or ""):
                raise MailTransportFailure("OCI SMTP 자격증명이 설정되지 않았습니다.", transient=False)
        elif provider_type not in {"smtp", "aws_ses"} or self.legacy_relay_adapter is None:
            raise MailTransportFailure(
                f"지원하지 않는 발신 Provider입니다: {raw_provider_type}", transient=False
            )

        return PreparedMailDelivery(
            provider_type=provider_type,
            message=prepared_message,
            envelope_from=envelope_from,
            recipient_email=recipient_email,
            legacy_envelope=dict(envelope),
            outbound_message=message,
        )

    def send_prepared(self, prepared: PreparedMailDelivery, provider: dict) -> str:
        if prepared.provider_type == "self_hosted":
            sender_domain = (
                prepared.envelope_from.rsplit("@", 1)[-1]
                if "@" in prepared.envelope_from
                else "localhost"
            )
            transport_options = {
                "helo_name": str(provider.get("helo_name") or f"mail.{sender_domain}"),
                "timeout_sec": int(provider.get("timeout_sec") or (60 if provider.get("relay_host") else 20)),
                "relay_host": str(provider.get("relay_host") or ""),
                "relay_port": int(provider.get("relay_port") or 25),
                "tls_mode": str(provider.get("tls_mode") or "opportunistic"),
                "username": str(provider.get("username") or ""),
                "password": str(provider.get("password") or ""),
            }
            if hasattr(self.self_hosted_transport, "send_prepared"):
                receipt = self.self_hosted_transport.send_prepared(
                    prepared.message,
                    envelope_from=prepared.envelope_from,
                    recipient_email=prepared.recipient_email,
                    **transport_options,
                )
            else:  # compatibility for existing non-network test doubles
                receipt = self.self_hosted_transport.send(
                    prepared.outbound_message,
                    **transport_options,
                )
        elif prepared.provider_type == "oci_email_delivery":
            password = str(provider.get("password") or "")
            config = RelaySmtpConfig(
                    host=str(provider.get("relay_host") or ""),
                    port=int(provider.get("relay_port") or 587),
                    username=str(provider.get("username") or ""),
                    password=password,
                    timeout_sec=int(provider.get("timeout_sec") or 20),
                )
            if hasattr(self.oci_transport, "send_prepared"):
                receipt = self.oci_transport.send_prepared(
                    prepared.message,
                    envelope_from=prepared.envelope_from,
                    recipient_email=prepared.recipient_email,
                    config=config,
                )
            else:  # compatibility for existing non-network test doubles
                receipt = self.oci_transport.send(prepared.outbound_message, config=config)
        elif prepared.provider_type in {"smtp", "aws_ses"} and self.legacy_relay_adapter is not None:
            return self.legacy_relay_adapter.send(prepared.legacy_envelope or {}, provider)
        else:
            raise MailTransportFailure(
                f"지원하지 않는 발신 Provider입니다: {prepared.provider_type}", transient=False
            )

        return (
            f"provider={receipt.provider_key};endpoint={receipt.endpoint};"
            f"remote_smtp_accepted={str(receipt.remote_smtp_accepted).lower()}"
        )

    def send(self, envelope: dict, provider: dict) -> str:
        return self.send_prepared(self.prepare(envelope, provider), provider)


_build_message = build_mail_message
