from datetime import UTC, datetime, timedelta
from email.message import EmailMessage

import pytest

from app.services.mail_daily_send_quota import (
    MailDailyQuotaUnavailable,
    MailDailySendLimitExceeded,
    MailQuotaReservation,
)
from app.services.mail_delivery_service import MailDeliveryWorker
from app.services.mail_delivery_operations import MailDeliveryOperations
from app.services.mail_transports import MailTransportFailure, SelfHostedSmtpTransport


def job(**overrides) -> dict:
    value = {
        "attempt_count": 0,
        "delivery_kind": "direct",
        "sender_email": "admin@moaworks.sinsan.kr",
        "recipient_email": "person@example.net",
        "subject": "제목",
        "body_text": "본문",
        "body_html": None,
        "attachments": [],
        "recipient_suppressed": False,
    }
    value.update(overrides)
    return value


def provider(**overrides) -> dict:
    value = {
        "provider_type": "oci_email_delivery",
        "delivery_enabled": True,
        "last_test_status": "success",
        "max_retry_count": 3,
        "retry_interval_sec": 60,
    }
    value.update(overrides)
    return value


class RecordingQuota:
    def __init__(self, outcomes=None) -> None:
        self.calls = 0
        self.outcomes = list(outcomes or [])

    def reserve_attempt(self) -> MailQuotaReservation:
        self.calls += 1
        if self.outcomes:
            outcome = self.outcomes.pop(0)
            if isinstance(outcome, Exception):
                raise outcome
        return MailQuotaReservation(
            usage_date=datetime(2026, 8, 29, tzinfo=UTC).date(),
            used=self.calls,
            limit=10,
            reset_at=datetime(2026, 8, 29, 15, 0, tzinfo=UTC),
        )


class PreparedAdapter:
    def __init__(
        self,
        quota: RecordingQuota,
        *,
        preparation_error: Exception | None = None,
        send_outcomes=None,
    ) -> None:
        self.quota = quota
        self.preparation_error = preparation_error
        self.send_outcomes = list(send_outcomes or [])
        self.prepare_calls = 0
        self.network_calls = 0

    def prepare(self, envelope: dict, selected_provider: dict):
        self.prepare_calls += 1
        if self.preparation_error is not None:
            raise self.preparation_error
        return {"envelope": envelope, "provider": selected_provider}

    def send_prepared(self, prepared, selected_provider: dict) -> str:
        assert self.quota.calls == self.network_calls + 1
        self.network_calls += 1
        if self.send_outcomes:
            outcome = self.send_outcomes.pop(0)
            if isinstance(outcome, Exception):
                raise outcome
        return "provider=fake;remote_smtp_accepted=true"


def worker(adapter: PreparedAdapter, quota: RecordingQuota) -> MailDeliveryWorker:
    return MailDeliveryWorker("worker-1", adapter, quota=quota)


def test_validation_failure_does_not_reserve_quota_or_call_provider() -> None:
    quota = RecordingQuota()
    adapter = PreparedAdapter(
        quota,
        preparation_error=MailTransportFailure("invalid recipient", transient=False),
    )

    result = worker(adapter, quota).deliver_claimed(job(recipient_email="invalid"), provider())

    assert result.status == "failed"
    assert quota.calls == 0
    assert adapter.network_calls == 0


def test_suppressed_recipient_does_not_prepare_reserve_or_call_provider() -> None:
    quota = RecordingQuota()
    adapter = PreparedAdapter(quota)

    result = worker(adapter, quota).deliver_claimed(
        job(recipient_suppressed=True),
        provider(),
    )

    assert result.status == "blocked"
    assert adapter.prepare_calls == 0
    assert quota.calls == 0
    assert adapter.network_calls == 0


def test_reservation_happens_once_after_prepare_and_immediately_before_send() -> None:
    quota = RecordingQuota()
    adapter = PreparedAdapter(quota)

    result = worker(adapter, quota).deliver_claimed(job(), provider())

    assert result.status == "sent"
    assert adapter.prepare_calls == 1
    assert quota.calls == 1
    assert adapter.network_calls == 1


def test_each_delivery_attempt_reserves_again_before_provider_call() -> None:
    quota = RecordingQuota()
    adapter = PreparedAdapter(
        quota,
        send_outcomes=[MailTransportFailure("temporary", transient=True), None],
    )

    first = worker(adapter, quota).deliver_claimed(job(attempt_count=0), provider())
    second = worker(adapter, quota).deliver_claimed(job(attempt_count=1), provider())

    assert first.status == "retry_pending"
    assert second.status == "sent"
    assert adapter.prepare_calls == 2
    assert quota.calls == 2
    assert adapter.network_calls == 2


def test_n_plus_one_quota_rejection_makes_zero_additional_provider_calls() -> None:
    reset_at = datetime(2026, 8, 29, 15, 0, tzinfo=UTC)
    quota = RecordingQuota(
        [
            None,
            None,
            MailDailySendLimitExceeded(limit=2, reset_at=reset_at),
        ]
    )
    adapter = PreparedAdapter(quota)

    results = [worker(adapter, quota).deliver_claimed(job(), provider()) for _ in range(3)]

    assert [result.status for result in results] == ["sent", "sent", "quota_deferred"]
    assert results[-1].next_attempt_at == reset_at
    assert quota.calls == 3
    assert adapter.network_calls == 2


@pytest.mark.parametrize(
    ("quota_error", "expected_code"),
    [
        (
            MailDailySendLimitExceeded(
                limit=1,
                reset_at=datetime(2026, 8, 29, 15, 0, tzinfo=UTC),
            ),
            "MAIL_DAILY_SEND_LIMIT_EXCEEDED",
        ),
        (
            MailDailyQuotaUnavailable("quota database unavailable"),
            "MAIL_DAILY_QUOTA_UNAVAILABLE",
        ),
    ],
)
def test_quota_rejection_is_distinct_and_never_calls_provider(
    quota_error: Exception,
    expected_code: str,
) -> None:
    quota = RecordingQuota([quota_error])
    adapter = PreparedAdapter(quota)

    result = worker(adapter, quota).deliver_claimed(job(), provider())

    assert result.status == "quota_deferred"
    assert result.error_message == expected_code
    assert adapter.prepare_calls == 1
    assert quota.calls == 1
    assert adapter.network_calls == 0


def test_self_hosted_mx_failover_reserves_before_each_network_attempt() -> None:
    reset_at = datetime(2026, 8, 29, 15, 0, tzinfo=UTC)
    quota = RecordingQuota(
        [None, MailDailySendLimitExceeded(limit=1, reset_at=reset_at)]
    )
    smtp_hosts: list[str] = []

    class FailingSmtp:
        def ehlo(self, *args):
            raise OSError("first MX unavailable")

        def __exit__(self, *_args) -> None:
            return None

    def smtp_factory(*, host: str, port: int, timeout: int):
        assert quota.calls == len(smtp_hosts) + 1
        smtp_hosts.append(host)
        return FailingSmtp()

    transport = SelfHostedSmtpTransport(
        mx_resolver=lambda _domain: ["mx1.example.net", "mx2.example.net"],
        smtp_factory=smtp_factory,
    )

    with pytest.raises(MailDailySendLimitExceeded):
        transport.send_prepared(
            EmailMessage(),
            envelope_from="sender@moaworks.sinsan.kr",
            recipient_email="person@example.net",
            helo_name="mail.moaworks.sinsan.kr",
            timeout_sec=20,
            before_network_attempt=quota.reserve_attempt,
        )

    assert quota.calls == 2
    assert smtp_hosts == ["mx1.example.net"]


class QueueDeferCursor:
    def __init__(self) -> None:
        self.statements: list[tuple[str, tuple | None]] = []
        self.queue = {
            "id": "queue-quota-1",
            "status": "processing",
            "attempt_count": 4,
            "worker_id": "worker-1",
            "company_id": "company-1",
            "claim_token": "token-1",
            "lease_expires_at": datetime(2026, 8, 29, 14, 0, tzinfo=UTC),
        }
        self.attempt_rows = 0
        self.audit_events: list[str] = []
        self._one = None

    def __enter__(self):
        return self

    def __exit__(self, *_args) -> None:
        return None

    def execute(self, query: str, params: tuple | None = None) -> None:
        normalized = " ".join(query.split())
        self.statements.append((normalized, params))
        if normalized.startswith("UPDATE mail_delivery_queue"):
            next_attempt_at, code, _updated_at, queue_id, worker_id, company_id, token = params
            if (
                self.queue["id"] == queue_id
                and self.queue["worker_id"] == worker_id
                and self.queue["status"] == "processing"
                and self.queue['company_id']==company_id and self.queue['claim_token']==token
            ):
                self.queue.update(
                    status="retry_pending",
                    next_attempt_at=next_attempt_at,
                    lease_expires_at=None,
                    worker_id=None,
                    last_error=code,
                )
                self._one = {"id": queue_id}
        elif normalized.startswith("INSERT INTO mail_delivery_attempts"):
            self.attempt_rows += 1
        elif normalized.startswith("INSERT INTO audit_logs"):
            self.audit_events.append(str(params[6]))

    def fetchone(self):
        value, self._one = self._one, None
        return value


class QueueDeferConnection:
    def __init__(self, cursor: QueueDeferCursor) -> None:
        self._cursor = cursor
        self.commits = 0

    def __enter__(self):
        return self

    def __exit__(self, *_args) -> None:
        return None

    def cursor(self) -> QueueDeferCursor:
        return self._cursor

    def commit(self) -> None:
        self.commits += 1


class QueueDeferDb:
    def __init__(self, cursor: QueueDeferCursor) -> None:
        self.connection = QueueDeferConnection(cursor)

    def connect(self) -> QueueDeferConnection:
        return self.connection


def test_quota_defer_releases_lease_without_attempt_or_retry_increment() -> None:
    cursor = QueueDeferCursor()
    operations = MailDeliveryOperations(db=QueueDeferDb(cursor), quota=RecordingQuota())
    reset_at = datetime(2026, 8, 29, 15, 0, tzinfo=UTC)

    deferred = operations.defer_claim_for_quota(
        "worker-1",
        {"queue_id": "queue-quota-1", "company_id": "company-1", "attempt_count": 4, "claim_token":"token-1"},
        "MAIL_DAILY_SEND_LIMIT_EXCEEDED",
        reset_at,
    )

    assert deferred is True
    assert cursor.queue["status"] == "retry_pending"
    assert cursor.queue["attempt_count"] == 4
    assert cursor.queue["lease_expires_at"] is None
    assert cursor.queue["worker_id"] is None
    assert cursor.queue["next_attempt_at"] == reset_at + timedelta(seconds=228)
    assert cursor.attempt_rows == 0
    assert cursor.audit_events == ["mail.delivery.daily_limit_deferred"]
    assert operations.db.connection.commits == 1
