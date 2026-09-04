from __future__ import annotations

import inspect
from pathlib import Path

import pytest

from app.schemas.mail_submission import (
    MailSubmissionCredentialIssueResponse,
    MailSubmissionCredentialView,
)
from app.services.mail_submission_credentials import (
    build_submission_username,
    generate_submission_password,
    hash_submission_password,
    verify_submission_password,
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


def test_issue_response_keeps_one_time_password_for_json_delivery():
    response = MailSubmissionCredentialIssueResponse(
        username="user@example.com",
        password="one-time-password",
        smtpHost="mx.dev.moaworks.sinsan.kr",
        smtpPort=587,
        secure=True,
    )

    assert response.model_dump(mode="json")["password"] == "one-time-password"


def test_submission_password_is_generated_and_only_hash_is_persistable():
    password = generate_submission_password()
    password_hash = hash_submission_password(password)

    assert password != password_hash
    assert password_hash.startswith("{SHA512-CRYPT}$6$")
    assert verify_submission_password(password, password_hash)
    assert not verify_submission_password("wrong-password", password_hash)


def test_submission_username_is_derived_from_existing_user_identity():
    assert build_submission_username("User.Name@Example.COM") == "User.Name@example.com"
