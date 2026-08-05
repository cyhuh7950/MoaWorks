from __future__ import annotations

from collections import deque
import logging
import shutil
import threading
import time

from app.core.config import settings
from app.services.observability_service import ObservabilityService
from app.services.postgres_service import PostgresService


logger = logging.getLogger(__name__)


class ApiRequestMetrics:
    def __init__(self, window_seconds: int = 300) -> None:
        self.window_seconds = window_seconds
        self._items: deque[tuple[float, int]] = deque()
        self._lock = threading.Lock()

    def record(self, status_code: int, now: float | None = None) -> None:
        current = time.monotonic() if now is None else now
        with self._lock:
            self._items.append((current, status_code))
            self._trim(current)

    def error_rate_percent(self, now: float | None = None) -> float:
        current = time.monotonic() if now is None else now
        with self._lock:
            self._trim(current)
            if not self._items:
                return 0.0
            errors = sum(1 for _, status in self._items if status >= 500)
            return round(errors / len(self._items) * 100, 2)

    def _trim(self, now: float) -> None:
        cutoff = now - self.window_seconds
        while self._items and self._items[0][0] < cutoff:
            self._items.popleft()


api_request_metrics = ApiRequestMetrics()


class OperationalMetricsService:
    def __init__(self, db=None, observability=None) -> None:
        self.db = db or PostgresService()
        self.observability = observability or ObservabilityService()

    def collect_once(self) -> None:
        try:
            self.db.ensure_migrations_applied()
            with self.db.connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT id FROM companies WHERE status<>'deleted'")
                    company_ids = [row["id"] for row in cursor.fetchall()]
                    for company_id in company_ids:
                        metrics = self._company_metrics(cursor, company_id)
                        self.observability.record_metrics(company_id=company_id, metrics=metrics)
        except Exception:
            logger.exception("운영 지표 수집 중 DB를 사용할 수 없습니다.")
            ObservabilityService(state_file=settings.observability_state_file).record_metrics(
                company_id="cmp_default",
                metrics={"database_unavailable": 1, "api_error_rate_percent": api_request_metrics.error_rate_percent()},
            )

    def _company_metrics(self, cursor, company_id: str) -> dict[str, float]:
        cursor.execute(
            "SELECT COUNT(*) AS count FROM mail_inbound_messages WHERE company_id=%s AND processing_status='spooled'",
            (company_id,),
        )
        inbound = int(cursor.fetchone()["count"])
        cursor.execute(
            "SELECT COUNT(*) AS count FROM mail_delivery_queue WHERE company_id=%s AND status IN ('queued','processing','retry_pending')",
            (company_id,),
        )
        outbound = int(cursor.fetchone()["count"])
        cursor.execute(
            """SELECT COUNT(*) AS count FROM mail_delivery_queue q
            JOIN mail_provider_configs p ON p.id=q.provider_config_id
            WHERE q.company_id=%s AND p.provider_type IN ('oci_email_delivery','oci_smtp')
            AND q.status='failed' AND q.updated_at>=NOW()-INTERVAL '1 hour'""",
            (company_id,),
        )
        oci_failures = int(cursor.fetchone()["count"])
        cursor.execute(
            "SELECT COUNT(*) AS count FROM approval_documents WHERE company_id=%s AND status='submitted' AND updated_at<=NOW()-INTERVAL '72 hours'",
            (company_id,),
        )
        approval_stale = int(cursor.fetchone()["count"])
        cursor.execute("SELECT enabled FROM operational_backup_policies WHERE company_id=%s", (company_id,))
        backup_policy = cursor.fetchone()
        backup_age = 0.0
        if backup_policy and backup_policy["enabled"]:
            cursor.execute(
                """SELECT EXTRACT(EPOCH FROM (NOW()-MAX(snapshot_at)))/3600.0 AS age_hours
                FROM operational_backup_jobs WHERE company_id=%s AND status='completed'""",
                (company_id,),
            )
            age_row = cursor.fetchone()
            backup_age = float(age_row["age_hours"]) if age_row and age_row["age_hours"] is not None else 999999.0
        cursor.execute(
            """SELECT COUNT(*) AS count FROM monitoring_events WHERE company_id=%s
            AND event_type LIKE 'security.%%' AND severity IN ('ERROR','CRITICAL')
            AND occurred_at>=NOW()-INTERVAL '5 minutes'""",
            (company_id,),
        )
        security_anomalies = int(cursor.fetchone()["count"])
        disk = shutil.disk_usage(settings.storage_path)
        return {
            "mail_inbound_queue_depth": float(inbound),
            "mail_outbound_queue_depth": float(outbound),
            "oci_delivery_failure_count": float(oci_failures),
            "approval_stale_count_72h": float(approval_stale),
            "backup_age_hours": backup_age,
            "security_anomaly_count": float(security_anomalies),
            "database_unavailable": 0.0,
            "api_error_rate_percent": api_request_metrics.error_rate_percent(),
            "disk_usage_percent": round(disk.used / disk.total * 100, 2) if disk.total else 0.0,
        }
