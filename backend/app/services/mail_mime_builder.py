from __future__ import annotations

from dataclasses import dataclass
from email.headerregistry import Address
from email.message import EmailMessage
import re
from typing import Literal


_CID_REFERENCE_RE = re.compile(r"\bcid:([^\s\"'<>]+)", re.IGNORECASE)
_CONTENT_ID_LOCAL_RE = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9_+-]*(?:\.[A-Za-z0-9_+-]+)*$"
)
_CONTENT_ID_DOMAIN_LABEL_RE = re.compile(
    r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$"
)


@dataclass(frozen=True, slots=True)
class OutboundAttachment:
    file_name: str
    content_type: str
    content: bytes
    content_disposition: Literal["attachment", "inline"] = "attachment"
    content_id: str | None = None


@dataclass(frozen=True, slots=True)
class OutboundMessage:
    sender_email: str
    recipient_email: str
    subject: str
    body_text: str
    body_html: str | None
    message_id: str
    sender_display_name: str = ""
    reply_to_email: str | None = None
    message_encoding: str = "utf-8"
    envelope_from: str | None = None
    attachments: tuple[OutboundAttachment, ...] = ()


def build_mail_message(source: OutboundMessage) -> EmailMessage:
    """Build the complete outbound MIME tree before transport signing."""
    _validate_source(source)
    inline_attachments, ordinary_attachments = _partition_attachments(source)

    message = EmailMessage()
    display_name = source.sender_display_name.strip()
    message["From"] = (
        Address(display_name=display_name, addr_spec=source.sender_email)
        if display_name
        else source.sender_email
    )
    message["To"] = source.recipient_email
    message["Subject"] = source.subject
    if source.reply_to_email:
        message["Reply-To"] = source.reply_to_email
    message["Message-ID"] = source.message_id
    message.set_content(source.body_text or "", charset=source.message_encoding)

    if source.body_html:
        message.add_alternative(
            source.body_html,
            subtype="html",
            charset=source.message_encoding,
        )
        html_part = message.get_payload()[-1]
        for attachment in inline_attachments:
            maintype, subtype = _content_type_parts(attachment.content_type)
            html_part.add_related(
                attachment.content,
                maintype=maintype,
                subtype=subtype,
                cid=f"<{attachment.content_id}>",
                disposition="inline",
                filename=attachment.file_name,
            )

    for attachment in ordinary_attachments:
        maintype, subtype = _content_type_parts(attachment.content_type)
        message.add_attachment(
            attachment.content,
            maintype=maintype,
            subtype=subtype,
            filename=attachment.file_name,
        )
    return message


def _validate_source(source: OutboundMessage) -> None:
    header_values = (
        source.sender_email,
        source.sender_display_name,
        source.reply_to_email or "",
        source.recipient_email,
        source.subject,
        source.message_id,
    )
    if any("\r" in value or "\n" in value for value in header_values):
        raise ValueError("메일 헤더에 허용되지 않는 줄바꿈이 있습니다.")
    if "@" not in source.sender_email or "@" not in source.recipient_email:
        raise ValueError("발신자와 수신자 이메일 형식이 올바르지 않습니다.")
    if source.reply_to_email and "@" not in source.reply_to_email:
        raise ValueError("회신 이메일 형식이 올바르지 않습니다.")
    if not source.message_id.startswith("<") or not source.message_id.endswith(">"):
        raise ValueError("Message-ID 형식이 올바르지 않습니다.")
    if "\r" in source.message_encoding or "\n" in source.message_encoding:
        raise ValueError("메일 문자 인코딩이 올바르지 않습니다.")


def _partition_attachments(
    source: OutboundMessage,
) -> tuple[list[OutboundAttachment], list[OutboundAttachment]]:
    inline: list[OutboundAttachment] = []
    ordinary: list[OutboundAttachment] = []
    content_ids: list[str] = []
    for attachment in source.attachments:
        if "\r" in attachment.file_name or "\n" in attachment.file_name:
            raise ValueError("첨부 파일명에 허용되지 않는 줄바꿈이 있습니다.")
        if attachment.content_disposition == "inline":
            if not attachment.content_id or not _is_valid_content_id(attachment.content_id):
                raise ValueError("인라인 첨부 Content-ID 형식이 올바르지 않습니다.")
            content_ids.append(attachment.content_id)
            inline.append(attachment)
        elif attachment.content_disposition == "attachment":
            if attachment.content_id is not None:
                raise ValueError("일반 첨부에는 Content-ID를 지정할 수 없습니다.")
            ordinary.append(attachment)
        else:
            raise ValueError("첨부 disposition이 올바르지 않습니다.")

    if len(content_ids) != len(set(content_ids)):
        raise ValueError("인라인 첨부 Content-ID가 중복되었습니다.")
    referenced_ids = set(_CID_REFERENCE_RE.findall(source.body_html or ""))
    if referenced_ids != set(content_ids):
        raise ValueError("HTML CID 참조와 인라인 첨부가 일치하지 않습니다.")
    return inline, ordinary


def _is_valid_content_id(content_id: str) -> bool:
    if len(content_id) > 254 or content_id.count("@") != 1:
        return False
    local_part, domain = content_id.split("@")
    if len(local_part) > 64 or not _CONTENT_ID_LOCAL_RE.fullmatch(local_part):
        return False
    domain_labels = domain.split(".")
    return bool(domain) and all(
        _CONTENT_ID_DOMAIN_LABEL_RE.fullmatch(label) for label in domain_labels
    )


def _content_type_parts(content_type: str) -> tuple[str, str]:
    maintype, separator, subtype = content_type.partition("/")
    if not separator or not maintype or not subtype:
        return "application", "octet-stream"
    return maintype, subtype
