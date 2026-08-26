from pathlib import Path


ROOT = Path(__file__).resolve().parent


def test_scheduled_mail_contract_is_exposed():
    routes = (ROOT / "app/api/routes/mail.py").read_text(encoding="utf-8")
    service = (ROOT / "app/services/mail_messenger_service.py").read_text(encoding="utf-8")
    schema = (ROOT / "app/schemas/mail_messenger.py").read_text(encoding="utf-8")

    for path in ('@router.get("/scheduled"', '"/{mail_id}/scheduled"', '"/{mail_id}/scheduled/send-now"', '"/{mail_id}/scheduled/retry"'):
        assert path in routes
    assert "def list_scheduled" in service
    assert 'mailbox == "scheduled" else "m.status = \'sent\'"' in service
    assert 'view_status = " AND m.status = \'scheduled\'"' in service
    assert "def update_scheduled_mail" in service
    assert "def cancel_scheduled_mail" in service
    assert "def send_scheduled_mail_now" in service
    assert "class MailScheduledUpdateRequest" in schema


def test_translation_defaults_are_persisted_with_mail_preferences():
    schema = (ROOT / "app/schemas/mail_messenger.py").read_text(encoding="utf-8")
    service = (ROOT / "app/services/mail_messenger_service.py").read_text(encoding="utf-8")
    migration = (ROOT.parent / "backend/migrations/059_mail_translation_context.sql").read_text(encoding="utf-8")

    assert "translationTargetLocale" in schema
    assert "translationComposeMode" in schema
    assert "translation_target_locale" in service
    assert "translation_compose_mode" in migration



def test_scheduled_update_requires_an_aware_future_datetime():
    from datetime import UTC, datetime, timedelta
    from pydantic import ValidationError
    from app.schemas.mail_messenger import MailScheduledUpdateRequest

    base = dict(to=["user@example.test"], subject="예약", bodyText="본문", confirmed=True)
    try:
        MailScheduledUpdateRequest(**base)
    except ValidationError:
        pass
    else:
        raise AssertionError("scheduledAt must be required")
    request = MailScheduledUpdateRequest(**base, scheduledAt=datetime.now(UTC) + timedelta(minutes=5))
    assert request.scheduledAt.tzinfo is not None


def test_scheduled_update_accepts_new_inline_attachment_for_mixed_reopen():
    """Capping scheduled-update attachments at zero must fail this Task 5 contract."""
    from datetime import UTC, datetime, timedelta

    from app.schemas.mail_messenger import MailAttachmentMeta, MailScheduledUpdateRequest

    content_id = "mw-scheduled-new@moaworks.invalid"
    inline = MailAttachmentMeta(
        uploadId="a" * 32,
        fileName="inline.png",
        contentType="image/png",
        sizeBytes=128,
        disposition="inline",
        contentId=content_id,
    )

    request = MailScheduledUpdateRequest(
        to=["user@example.test"],
        subject="예약 수정",
        bodyText="본문 이미지",
        bodyHtml=f'<p>본문</p><img src="cid:{content_id}" alt="본문 이미지">',
        scheduledAt=datetime.now(UTC) + timedelta(minutes=5),
        confirmed=True,
        attachments=[inline],
    )

    assert request.attachments == [inline]
