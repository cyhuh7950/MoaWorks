from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime


class MailDailySendLimitExceeded(RuntimeError):
    def __init__(self, *, limit: int, reset_at: datetime) -> None:
        super().__init__("daily mail send limit exceeded")
        self.limit = limit
        self.reset_at = reset_at


class MailDailyQuotaUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class MailQuotaReservation:
    usage_date: date
    used: int
    limit: int
    reset_at: datetime

    @property
    def allowed(self) -> bool:
        return True


class MailDailySendQuota:
    _RESERVE_SQL = """
        WITH quota_clock AS (
            SELECT
                timezone('Asia/Seoul', statement_timestamp())::date AS usage_date,
                (
                    (
                        timezone('Asia/Seoul', statement_timestamp())::date + 1
                    )::timestamp AT TIME ZONE 'Asia/Seoul'
                ) AS reset_at
        ),
        reservation AS (
            INSERT INTO mail_engine_daily_send_usage AS daily_usage (
                usage_date,
                attempt_count,
                updated_at
            )
            SELECT usage_date, 1, statement_timestamp()
            FROM quota_clock
            ON CONFLICT (usage_date) DO UPDATE
            SET
                attempt_count = daily_usage.attempt_count + 1,
                updated_at = statement_timestamp()
            WHERE
                %(limit)s = 0
                OR daily_usage.attempt_count < %(limit)s
            RETURNING usage_date, attempt_count
        )
        SELECT
            reservation.usage_date,
            reservation.attempt_count,
            quota_clock.reset_at
        FROM quota_clock
        LEFT JOIN reservation
            ON reservation.usage_date = quota_clock.usage_date
    """

    def __init__(self, db, *, limit: int) -> None:
        if isinstance(limit, bool) or not isinstance(limit, int) or limit < 0:
            raise ValueError("limit must be a non-negative integer")
        self.db = db
        self.limit = limit

    def reserve_attempt(self) -> MailQuotaReservation:
        try:
            with self.db.connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(self._RESERVE_SQL, {"limit": self.limit})
                    row = cursor.fetchone()
        except Exception as exc:
            raise MailDailyQuotaUnavailable("daily mail quota unavailable") from exc

        if row is None:
            raise MailDailyQuotaUnavailable("daily mail quota unavailable")

        if row["usage_date"] is None:
            raise MailDailySendLimitExceeded(
                limit=self.limit,
                reset_at=row["reset_at"],
            )

        return MailQuotaReservation(
            usage_date=row["usage_date"],
            used=row["attempt_count"],
            limit=self.limit,
            reset_at=row["reset_at"],
        )
