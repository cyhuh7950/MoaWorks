from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

from app.schemas.observability import EventEnvelope, MonitoringCategory, SeverityLevel, Visibility
from app.services.observability_service import ObservabilityService
from app.services.operational_metrics_service import ApiRequestMetrics


class Stage04OperationalMonitoringTest(unittest.TestCase):
    def test_api_error_rate_uses_bounded_recent_window(self) -> None:
        metrics = ApiRequestMetrics(window_seconds=300)
        metrics.record(500, now=-1000.0)
        for status_code in (200, 200, 200, 500):
            metrics.record(status_code, now=100.0)

        self.assertEqual(metrics.error_rate_percent(now=101.0), 25.0)

    def test_default_rules_cover_required_operational_metrics(self) -> None:
        metrics = {item["metric"] for item in ObservabilityService._default_rules()}
        self.assertTrue({
            "mail_inbound_queue_depth",
            "mail_outbound_queue_depth",
            "oci_delivery_failure_count",
            "disk_usage_percent",
            "database_unavailable",
            "api_error_rate_percent",
            "approval_stale_count_72h",
            "security_anomaly_count",
            "backup_age_hours",
        }.issubset(metrics))
        disk_thresholds = sorted(
            item["threshold"] for item in ObservabilityService._default_rules()
            if item["metric"] == "disk_usage_percent" and item["ruleId"] != "rule_disk_usage_percent"
        )
        self.assertEqual(disk_thresholds, [80, 90])

    def test_metric_event_creates_acknowledges_and_resolves_alert(self) -> None:
        with tempfile.TemporaryDirectory(prefix="moaworks-f14-monitor-") as temp:
            service = ObservabilityService(state_file=Path(temp) / "state.json")
            event = EventEnvelope(
                eventId="evt_queue_depth",
                eventType="mail.queue.metrics",
                category=MonitoringCategory.MAIL,
                severity=SeverityLevel.WARN,
                resourceType="mail_queue",
                resourceId="inbound",
                requestId="req_queue_depth",
                dedupKey="mail.queue.metrics:inbound",
                title="수신 큐 증가",
                message="수신 큐 임계치를 초과했습니다.",
                companyId="cmp_default",
                targets=["admin"],
                visibility=Visibility.ADMIN,
                payload={"metrics": {"mail_inbound_queue_depth": 101}},
            )

            service.emit_event(event)
            alerts = service.list_alerts().alerts
            alert = next(item for item in alerts if item.metric == "mail_inbound_queue_depth")
            self.assertEqual(alert.status.value, "OPEN")
            self.assertEqual(alert.currentValue, 101)

            acknowledged = service.ack_alert(alert.alertId)
            self.assertEqual(acknowledged.status.value, "ACKNOWLEDGED")
            resolved = service.resolve_alert(alert.alertId)
            self.assertEqual(resolved.status.value, "RESOLVED")
            self.assertIsNotNone(resolved.resolvedAt)

    def test_existing_state_receives_new_default_rules_without_overwriting_custom_threshold(self) -> None:
        with tempfile.TemporaryDirectory(prefix="moaworks-f14-monitor-") as temp:
            state_path = Path(temp) / "state.json"
            service = ObservabilityService(state_file=state_path)
            service.update_rule(
                "rule_disk_usage_percent",
                payload=type("Update", (), {"model_dump": lambda self, **_: {"threshold": 77}})(),
            )
            reloaded = ObservabilityService(state_file=state_path)

            rules = {item.ruleId: item for item in reloaded.list_rules()}

            self.assertEqual(rules["rule_disk_usage_percent"].threshold, 77)
            self.assertIn("rule_database_unavailable", rules)


if __name__ == "__main__":
    unittest.main()
