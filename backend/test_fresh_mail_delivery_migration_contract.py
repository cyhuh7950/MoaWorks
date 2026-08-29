from pathlib import Path


MIGRATIONS = Path(__file__).resolve().parent / "migrations"


def test_legacy_smtp_migration_does_not_precreate_modern_queue_tables() -> None:
    legacy_sql = (MIGRATIONS / "007_self_hosted_smtp_delivery.sql").read_text(encoding="utf-8")
    modern_sql = (MIGRATIONS / "025_mail_delivery_queue.sql").read_text(encoding="utf-8")

    assert "CREATE TABLE IF NOT EXISTS mail_delivery_providers" in legacy_sql
    assert "CREATE TABLE IF NOT EXISTS mail_delivery_queue" not in legacy_sql
    assert "CREATE TABLE IF NOT EXISTS mail_delivery_attempts" not in legacy_sql
    assert "CREATE TABLE IF NOT EXISTS mail_delivery_queue" in modern_sql
    assert "CREATE TABLE IF NOT EXISTS mail_delivery_attempts" in modern_sql


def test_modern_queue_migration_preserves_preexisting_v007_tables() -> None:
    modern_sql = (MIGRATIONS / "025_mail_delivery_queue.sql").read_text(encoding="utf-8")

    assert "information_schema.columns" in modern_sql
    assert "column_name = 'provider_id'" in modern_sql
    assert "column_name = 'provider_config_id'" in modern_sql
    assert "mail_delivery_queue_v007" in modern_sql
    assert "mail_delivery_attempts_v007" in modern_sql
    assert "mail_delivery_events_v007" in modern_sql
    assert "RENAME CONSTRAINT mail_delivery_queue_pkey" in modern_sql
    assert "RENAME CONSTRAINT mail_delivery_attempts_pkey" in modern_sql
