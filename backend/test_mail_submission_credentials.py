from __future__ import annotations

import inspect
from pathlib import Path

import pytest

from app.schemas.mail_submission import (
    MailSubmissionCredentialIssueResponse,
    MailSubmissionCredentialView,
)


MIGRATION = Path(__file__).parent / "migrations" / "069_mail_submission_credentials.sql"


def test_submission_credential_migration_links_one_active_credential_to_each_user():
    sql = MIGRATION.read_text(encoding="utf-8")

    assert "CREATE TABLE IF NOT EXISTS mail_submission_credentials" in sql
    assert "user_id TEXT NOT NULL REFERENCES users(id)" in sql
    assert "company_id TEXT NOT NULL REFERENCES companies(id)" in sql
    assert "UNIQUE (company_id, user_id)" in sql
    assert "password_hash TEXT NOT NULL" in sql
    assert "CREATE INDEX IF NOT EXISTS mail_submission_credentials_active_username_idx" in sql


def test_credential_views_never_expose_password_hash():
    assert "password_hash" not in MailSubmissionCredentialView.model_fields
    assert set(MailSubmissionCredentialIssueResponse.model_fields) == {
        "username",
        "password",
        "smtpHost",
        "smtpPort",
        "secure",
    }


def test_issue_response_password_is_secret_string():
    field = MailSubmissionCredentialIssueResponse.model_fields["password"]
    assert "SecretStr" in str(field.annotation)
