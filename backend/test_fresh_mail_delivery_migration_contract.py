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
    assert "'provider_id'" in modern_sql
    assert "'provider_config_id'" in modern_sql
    assert "mail_delivery_queue_v007" in modern_sql
    assert "mail_delivery_attempts_v007" in modern_sql
    assert "mail_delivery_events_v007" in modern_sql
    assert "RENAME CONSTRAINT mail_delivery_queue_pkey" in modern_sql
    assert "RENAME CONSTRAINT mail_delivery_attempts_pkey" in modern_sql


def test_modern_queue_migration_rejects_partial_or_mixed_catalog_states() -> None:
    modern_sql = (MIGRATIONS / "025_mail_delivery_queue.sql").read_text(encoding="utf-8")

    for marker in (
        "MAIL_DELIVERY_025_UNSUPPORTED_CATALOG_STATE",
        "mail_delivery_queue_v007",
        "mail_delivery_attempts_v007",
        "mail_delivery_events_v007",
        "mail_delivery_worker_heartbeats",
        "mail_delivery_queue_company_id_fkey",
        "mail_delivery_queue_provider_id_fkey",
        "mail_delivery_queue_mail_id_fkey",
        "mail_delivery_attempts_queue_id_fkey",
        "mail_delivery_events_queue_id_fkey",
    ):
        assert marker in modern_sql

    assert "legacy_queue_columns CONSTANT TEXT[] := ARRAY[" in modern_sql
    assert "modern_queue_columns CONSTANT TEXT[] := ARRAY[" in modern_sql
    assert "legacy_attempt_columns CONSTANT TEXT[] := ARRAY[" in modern_sql
    assert "modern_attempt_columns CONSTANT TEXT[] := ARRAY[" in modern_sql
    assert "legacy_event_columns CONSTANT TEXT[] := ARRAY[" in modern_sql
    assert "fresh_state" in modern_sql
    assert "legacy_state" in modern_sql
    assert "modern_state" in modern_sql


def test_modern_queue_migration_validates_constraint_semantics() -> None:
    modern_sql = (MIGRATIONS / "025_mail_delivery_queue.sql").read_text(encoding="utf-8")

    for catalog_field in (
        "pg_constraint",
        "conkey",
        "confrelid",
        "confkey",
        "confdeltype",
    ):
        assert catalog_field in modern_sql
