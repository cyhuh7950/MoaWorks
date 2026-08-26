from __future__ import annotations

from dataclasses import replace
from email.message import EmailMessage
from hashlib import sha256
import importlib
import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest


def _mime_builder():
    module_name = "app.services.mail_mime_builder"
    assert importlib.util.find_spec(module_name) is not None, "공통 MIME builder가 아직 없습니다."
    return importlib.import_module(module_name)


def _source(**changes):
    builder = _mime_builder()
    values = {
        "sender_email": "sender@moaworks.sinsan.kr",
        "sender_display_name": "홍길동",
        "reply_to_email": "reply@moaworks.sinsan.kr",
        "recipient_email": "person@example.net",
        "subject": "테스트 제목",
        "body_text": "일반 본문",
        "body_html": None,
        "message_id": "<mail-1@moaworks.sinsan.kr>",
        "message_encoding": "utf-8",
        "envelope_from": "bounce+queue-1@moaworks.sinsan.kr",
        "attachments": (),
    }
    values.update(changes)
    return builder.OutboundMessage(**values)


class _CaptureTransport:
    def __init__(self, provider_key: str) -> None:
        self.provider_key = provider_key
        self.calls = []

    def send(self, message, **kwargs):
        from app.services.mail_transports import DeliveryReceipt

        self.calls.append((message, kwargs))
        return DeliveryReceipt(self.provider_key, "smtp://example.test:25", True)


class _CaptureSmtp:
    def __init__(self) -> None:
        self.message: EmailMessage | None = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        return None

    def ehlo(self, _name=None) -> None:
        return None

    def has_extn(self, _name) -> bool:
        return False

    def send_message(self, message, *, from_addr, to_addrs):
        self.message = message
        return {}


class _InspectingSigner:
    def __init__(self) -> None:
        self.saw_final_tree = False

    def sign(self, message, _config) -> None:
        self.saw_final_tree = (
            message.get_content_type() == "multipart/mixed"
            and any(part.get_content_type() == "multipart/related" for part in message.walk())
            and any(part.get("Content-ID") == "<mw-1@moaworks.invalid>" for part in message.walk())
            and any(part.get_content_disposition() == "attachment" for part in message.walk())
            and message["Message-ID"] == "<mail-1@moaworks.sinsan.kr>"
        )


class MailMimeBuilderTest(unittest.TestCase):
    def test_plain_message_preserves_snapshot_headers_charset_and_message_id(self) -> None:
        message = _mime_builder().build_mail_message(_source())

        self.assertEqual(message.get_content_type(), "text/plain")
        self.assertEqual(str(message["From"]), "홍길동 <sender@moaworks.sinsan.kr>")
        self.assertEqual(str(message["Reply-To"]), "reply@moaworks.sinsan.kr")
        self.assertEqual(message["Message-ID"], "<mail-1@moaworks.sinsan.kr>")
        self.assertEqual(message.get_content_charset(), "utf-8")

    def test_html_without_inline_is_multipart_alternative(self) -> None:
        message = _mime_builder().build_mail_message(_source(body_html="<p>서식 본문</p>"))

        self.assertEqual(message.get_content_type(), "multipart/alternative")
        self.assertEqual(message.get_body(preferencelist=("plain",)).get_content().strip(), "일반 본문")
        self.assertEqual(message.get_body(preferencelist=("html",)).get_content().strip(), "<p>서식 본문</p>")

    def test_inline_image_builds_related_inside_alternative(self) -> None:
        builder = _mime_builder()
        inline = builder.OutboundAttachment(
            file_name="image.png",
            content_type="image/png",
            content=b"png-body",
            content_disposition="inline",
            content_id="mw-1@moaworks.invalid",
        )

        message = builder.build_mail_message(
            _source(
                body_html='<p>본문<img src="cid:mw-1@moaworks.invalid" alt="사진"></p>',
                attachments=(inline,),
            )
        )

        self.assertEqual(message.get_content_type(), "multipart/alternative")
        self.assertTrue(any(part.get_content_type() == "multipart/related" for part in message.walk()))
        self.assertTrue(any(part.get("Content-ID") == "<mw-1@moaworks.invalid>" for part in message.walk()))

    def test_inline_and_file_builds_related_inside_mixed(self) -> None:
        builder = _mime_builder()
        inline = builder.OutboundAttachment(
            "image.png", "image/png", b"png-body", "inline", "mw-1@moaworks.invalid"
        )
        attached = builder.OutboundAttachment("report.txt", "text/plain", b"report")

        message = builder.build_mail_message(
            _source(
                body_html='<img src="cid:mw-1@moaworks.invalid" alt="사진">',
                attachments=(inline, attached),
            )
        )

        self.assertEqual(message.get_content_type(), "multipart/mixed")
        self.assertTrue(any(part.get_content_type() == "multipart/related" for part in message.walk()))
        self.assertTrue(any(part.get("Content-ID") == "<mw-1@moaworks.invalid>" for part in message.walk()))
        self.assertEqual([part.get_filename() for part in message.iter_attachments()], ["report.txt"])

    def test_rejects_unknown_unreferenced_duplicate_and_malformed_content_ids(self) -> None:
        builder = _mime_builder()
        cases = [
            (
                '<img src="cid:unknown@moaworks.invalid">',
                (builder.OutboundAttachment("x.png", "image/png", b"x", "inline", "mw-1@moaworks.invalid"),),
            ),
            (
                "<p>no image</p>",
                (builder.OutboundAttachment("x.png", "image/png", b"x", "inline", "mw-1@moaworks.invalid"),),
            ),
            (
                '<img src="cid:mw-1@moaworks.invalid">',
                (
                    builder.OutboundAttachment("x.png", "image/png", b"x", "inline", "mw-1@moaworks.invalid"),
                    builder.OutboundAttachment("y.png", "image/png", b"y", "inline", "mw-1@moaworks.invalid"),
                ),
            ),
            (
                '<img src="cid:bad id">',
                (builder.OutboundAttachment("x.png", "image/png", b"x", "inline", "bad id"),),
            ),
        ]

        for body_html, attachments in cases:
            with self.subTest(body_html=body_html, count=len(attachments)), self.assertRaises(ValueError):
                builder.build_mail_message(_source(body_html=body_html, attachments=attachments))

    def test_rejects_crlf_in_every_user_controlled_header_field(self) -> None:
        builder = _mime_builder()
        source = _source()
        for field_name in (
            "sender_email",
            "sender_display_name",
            "reply_to_email",
            "recipient_email",
            "subject",
            "message_id",
        ):
            with self.subTest(field_name=field_name), self.assertRaises(ValueError):
                builder.build_mail_message(replace(source, **{field_name: "safe\r\nBcc: hidden@example.net"}))

        unsafe_attachment = builder.OutboundAttachment(
            "safe.txt\r\nX-Injected: yes", "text/plain", b"body"
        )
        with self.assertRaises(ValueError):
            builder.build_mail_message(replace(source, attachments=(unsafe_attachment,)))

    def test_legacy_adapter_preserves_direct_and_automatic_sender_semantics(self) -> None:
        from app.services.mail_delivery_service import SmtpRelayAdapter

        base = {
            "sender_email": "owner@example.com",
            "sender_display_name": "Owner",
            "reply_to_email": "origin@example.org",
            "recipient_email": "target@example.net",
            "subject": "subject",
            "body_text": "body",
            "body_html": None,
            "message_encoding": "utf-8",
            "message_id": "<legacy-1@example.com>",
        }
        provider = {"from_address": "provider@example.net"}

        direct = SmtpRelayAdapter().build_message({**base, "delivery_kind": "direct"}, provider)
        forwarded = SmtpRelayAdapter().build_message({**base, "delivery_kind": "auto_forward"}, provider)
        out_of_office = SmtpRelayAdapter().build_message({**base, "delivery_kind": "out_of_office"}, provider)

        self.assertEqual(str(direct["From"]), "Owner <provider@example.net>")
        self.assertEqual(str(forwarded["From"]), "Owner <owner@example.com>")
        self.assertEqual(str(out_of_office["From"]), "Owner <owner@example.com>")
        self.assertEqual(str(forwarded["Reply-To"]), "origin@example.org")
        self.assertEqual(forwarded.get_content_charset(), "utf-8")
        self.assertEqual(forwarded["Message-ID"], "<legacy-1@example.com>")

    def test_provider_router_preserves_bounce_message_id_and_automatic_sender(self) -> None:
        from app.services.mail_transports import MailProviderRoutingAdapter

        self_hosted = _CaptureTransport("self_hosted")
        adapter = MailProviderRoutingAdapter(
            self_hosted_transport=self_hosted,
            oci_transport=_CaptureTransport("oci_email_delivery"),
        )
        envelope = {
            "queue_id": "queue-1",
            "delivery_kind": "auto_forward",
            "sender_email": "owner@example.com",
            "sender_display_name": "Owner",
            "reply_to_email": "origin@example.org",
            "message_encoding": "utf-8",
            "recipient_email": "target@example.net",
            "subject": "subject",
            "body_text": "body",
            "body_html": None,
            "attachments": [],
            "message_id": "<routed-1@example.com>",
        }
        provider = {
            "provider_type": "self_hosted",
            "from_address": "provider@example.net",
            "dkim_domain": "moaworks.sinsan.kr",
        }

        adapter.send(envelope, provider)

        message, _ = self_hosted.calls[0]
        self.assertEqual(message.sender_email, "owner@example.com")
        self.assertEqual(message.sender_display_name, "Owner")
        self.assertEqual(message.reply_to_email, "origin@example.org")
        self.assertEqual(message.message_encoding, "utf-8")
        self.assertEqual(message.envelope_from, "bounce+queue-1@moaworks.sinsan.kr")
        self.assertEqual(message.message_id, "<routed-1@example.com>")

    def test_provider_router_uses_stable_message_id_fallback_for_retries(self) -> None:
        from app.services.mail_transports import MailProviderRoutingAdapter

        self_hosted = _CaptureTransport("self_hosted")
        adapter = MailProviderRoutingAdapter(
            self_hosted_transport=self_hosted,
            oci_transport=_CaptureTransport("oci_email_delivery"),
        )
        envelope = {
            "mail_id": "mail-1",
            "queue_id": "queue-1",
            "delivery_kind": "direct",
            "sender_email": "sender@moaworks.sinsan.kr",
            "recipient_email": "target@example.net",
            "subject": "subject",
            "body_text": "body",
            "body_html": None,
            "attachments": [],
        }
        provider = {"provider_type": "self_hosted", "from_address": "sender@moaworks.sinsan.kr"}

        adapter.send(envelope, provider)
        adapter.send(envelope, provider)

        first = self_hosted.calls[0][0].message_id
        second = self_hosted.calls[1][0].message_id
        self.assertEqual(first, "<mail-1@moaworks.sinsan.kr>")
        self.assertEqual(second, first)

    def test_adapters_recheck_canonical_attachment_size_and_digest(self) -> None:
        from app.services.mail_delivery_service import RelayDeliveryError, SmtpRelayAdapter
        from app.services.mail_transports import MailProviderRoutingAdapter, MailTransportFailure

        with TemporaryDirectory() as directory:
            path = Path(directory) / "report.txt"
            content = b"canonical-body"
            path.write_bytes(content)
            base_attachment = {
                "file_name": "report.txt",
                "content_type": "text/plain",
                "path": str(path),
                "size_bytes": len(content),
                "sha256": sha256(content).hexdigest(),
                "content_disposition": "attachment",
                "content_id": None,
            }
            envelope = {
                "mail_id": "mail-1",
                "queue_id": "queue-1",
                "delivery_kind": "direct",
                "sender_email": "sender@moaworks.sinsan.kr",
                "recipient_email": "target@example.net",
                "subject": "subject",
                "body_text": "body",
                "body_html": None,
                "attachments": [{**base_attachment, "size_bytes": len(content) + 1}],
            }
            provider = {"provider_type": "self_hosted", "from_address": "sender@moaworks.sinsan.kr"}
            router = MailProviderRoutingAdapter(
                self_hosted_transport=_CaptureTransport("self_hosted"),
                oci_transport=_CaptureTransport("oci_email_delivery"),
            )

            with self.assertRaises(MailTransportFailure):
                router.send(envelope, provider)

            envelope["attachments"] = [{**base_attachment, "sha256": "0" * 64}]
            with self.assertRaises(RelayDeliveryError):
                SmtpRelayAdapter().build_message(envelope, provider)

    def test_dkim_signer_observes_final_related_and_mixed_tree(self) -> None:
        builder = _mime_builder()
        from app.services.mail_transports import DkimSigningConfig, SelfHostedSmtpTransport

        smtp = _CaptureSmtp()
        signer = _InspectingSigner()
        transport = SelfHostedSmtpTransport(
            mx_resolver=lambda _domain: ["mx.example.net"],
            smtp_factory=lambda **_: smtp,
            dkim_signer=signer,
        )
        source = _source(
            body_html='<img src="cid:mw-1@moaworks.invalid">',
            attachments=(
                builder.OutboundAttachment("x.png", "image/png", b"x", "inline", "mw-1@moaworks.invalid"),
                builder.OutboundAttachment("report.txt", "text/plain", b"report"),
            ),
        )

        transport.send(
            source,
            helo_name="mail.moaworks.sinsan.kr",
            timeout_sec=10,
            dkim_config=DkimSigningConfig("moaworks.sinsan.kr", "selector1", b"key"),
        )

        self.assertTrue(signer.saw_final_tree)
        self.assertIsNotNone(smtp.message)

    def test_transports_classify_builder_rejection_as_permanent_failure(self) -> None:
        from app.services.mail_transports import (
            MailTransportFailure,
            OciEmailDeliveryTransport,
            RelaySmtpConfig,
            SelfHostedSmtpTransport,
        )

        invalid = _source(subject="safe\r\nBcc: hidden@example.net")
        transports = (
            lambda: SelfHostedSmtpTransport(mx_resolver=lambda _domain: ["mx.example.net"]).send(
                invalid,
                helo_name="mail.moaworks.sinsan.kr",
                timeout_sec=10,
            ),
            lambda: OciEmailDeliveryTransport().send(
                invalid,
                config=RelaySmtpConfig("smtp.example.net", 587, "user", "password"),
            ),
        )

        for send in transports:
            with self.subTest(send=send), self.assertRaises(MailTransportFailure) as raised:
                send()
            self.assertFalse(raised.exception.transient)


if __name__ == "__main__":
    unittest.main()
