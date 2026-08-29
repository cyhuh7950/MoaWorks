from __future__ import annotations

import base64
import json
import os
import stat
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.services.admin_mfa_break_glass_service import (
    BreakGlassApprovalInvalid,
    BreakGlassApprovalRequired,
    BreakGlassApprover,
    BreakGlassRequestUnavailable,
    AdminMfaBreakGlassService,
)
from app.services.postgres_service import PostgresService
from app.cli.admin_mfa_break_glass import main as break_glass_cli


POSTGRES_OPT_IN = "MOAWORKS_UI041_POSTGRES_INTEGRATION"


def _private_seed(value: int) -> bytes:
    return bytes([value]) * 32


def _approver(identifier: str, value: int, **changes: object) -> tuple[BreakGlassApprover, bytes]:
    seed = _private_seed(value)
    public_key = Ed25519PrivateKey.from_private_bytes(seed).public_key().public_bytes_raw()
    values = {
        "approver_id": identifier,
        "key_version": 1,
        "public_key": public_key,
        "active": True,
        "bound_user_id": None,
    }
    values.update(changes)
    return BreakGlassApprover(**values), seed


def test_offline_sign_creates_detached_signature_without_database() -> None:
    approver, seed = _approver("custodian-a", 1)
    request = {
        "version": "v1",
        "requestId": "request-1",
        "targetUserId": "admin-1",
        "reasonDigest": "a" * 64,
        "correlationId": "ticket-1",
        "expiresAt": "2026-08-29T12:00:00+00:00",
        "nonce": base64.b64encode(b"n" * 16).decode("ascii"),
    }

    approval = AdminMfaBreakGlassService.sign_request(
        request,
        approver_id=approver.approver_id,
        key_version=approver.key_version,
        private_key=seed,
    )

    assert approval["requestId"] == request["requestId"]
    assert approval["approverId"] == approver.approver_id
    assert approval["payloadDigest"]
    assert approval["detachedSignature"]
    AdminMfaBreakGlassService(db=None, approvers={approver.approver_id: approver}).validate_approval(
        request, approval
    )


def test_sign_cli_uses_only_local_artifacts_and_never_overwrites() -> None:
    request = {
        "version": "v1", "requestId": "request-cli", "targetUserId": "admin-cli",
        "reasonDigest": "c" * 64, "correlationId": "ticket-cli",
        "expiresAt": "2026-08-29T12:00:00+00:00",
        "nonce": base64.b64encode(b"q" * 16).decode("ascii"),
    }
    with tempfile.TemporaryDirectory(prefix="moaworks-task10-cli-") as temp_dir:
        root = Path(temp_dir)
        request_path = root / "request.json"
        key_path = root / "private.key"
        output_path = root / "approval.json"
        request_path.write_text(json.dumps(request), encoding="utf-8")
        key_path.write_bytes(_private_seed(8))
        assert break_glass_cli([
            "sign", "--request", str(request_path), "--approver-id", "custodian-cli",
            "--key-version", "1", "--private-key-file", str(key_path), "--out", str(output_path),
        ]) == 0
        approval = json.loads(output_path.read_text(encoding="utf-8"))
        assert approval["detachedSignature"]
        assert base64.b64encode(_private_seed(8)).decode("ascii") not in output_path.read_text(encoding="utf-8")
        with pytest.raises(FileExistsError):
            break_glass_cli([
                "sign", "--request", str(request_path), "--approver-id", "custodian-cli",
                "--key-version", "1", "--private-key-file", str(key_path), "--out", str(output_path),
            ])


@pytest.mark.parametrize(
    ("changes", "mutate"),
    [
        ({"active": False}, None),
        ({"bound_user_id": "admin-1"}, None),
        ({}, lambda approval: approval.update({"payloadDigest": "00" * 32})),
    ],
)
def test_approval_rejects_inactive_self_bound_and_payload_mismatch(changes, mutate) -> None:
    approver, seed = _approver("custodian-a", 2, **changes)
    request = {
        "version": "v1",
        "requestId": "request-2",
        "targetUserId": "admin-1",
        "reasonDigest": "b" * 64,
        "correlationId": "ticket-2",
        "expiresAt": "2026-08-29T12:00:00+00:00",
        "nonce": base64.b64encode(b"m" * 16).decode("ascii"),
    }
    approval = AdminMfaBreakGlassService.sign_request(
        request,
        approver_id=approver.approver_id,
        key_version=1,
        private_key=seed,
    )
    if mutate:
        mutate(approval)

    with pytest.raises(BreakGlassApprovalInvalid):
        AdminMfaBreakGlassService(db=None, approvers={approver.approver_id: approver}).validate_approval(
            request, approval
        )


@dataclass(frozen=True)
class BreakGlassDbFixture:
    service: AdminMfaBreakGlassService
    target_user_id: str
    prefix: str
    seeds: dict[str, bytes]


@pytest.fixture()
def break_glass_db() -> BreakGlassDbFixture:
    if os.getenv(POSTGRES_OPT_IN) != "1":
        pytest.skip(f"set {POSTGRES_OPT_IN}=1 to use the existing PostgreSQL runtime")
    db = PostgresService()
    db.ensure_migrations_applied()
    prefix = f"task10_{uuid4().hex}"
    company_id = f"{prefix}_company"
    department_id = f"{prefix}_department"
    role_id = f"{prefix}_role"
    user_id = f"{prefix}_user"
    profile_id = f"{prefix}_profile"
    approvers: dict[str, BreakGlassApprover] = {}
    seeds: dict[str, bytes] = {}
    for index, identifier in enumerate(("custodian-a", "custodian-b", "custodian-c"), start=3):
        approver, seed = _approver(identifier, index)
        approvers[identifier] = approver
        seeds[identifier] = seed
    service = AdminMfaBreakGlassService(db=db, approvers=approvers)
    with db.connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            "INSERT INTO companies (id,name,domain,status,created_at) VALUES (%s,%s,%s,'active',statement_timestamp())",
            (company_id, "Task 10 fixture", f"{prefix}.invalid"),
        )
        cursor.execute(
            "INSERT INTO departments (id,company_id,name,status,sort_order,created_at) VALUES (%s,%s,%s,'active',100,statement_timestamp())",
            (department_id, company_id, "Task 10 fixture"),
        )
        cursor.execute(
            "INSERT INTO roles (id,company_id,name,permissions,status,created_at) VALUES (%s,%s,%s,'[]'::jsonb,'active',statement_timestamp())",
            (role_id, company_id, "Task 10 fixture"),
        )
        cursor.execute(
            """
            INSERT INTO users (
                id,company_id,email,name,password_hash,department_id,role_id,
                status,user_type,auth_session_version,created_at,updated_at
            ) VALUES (%s,%s,%s,%s,'fixture-hash',%s,%s,'pending_mfa','admin',4,
                      statement_timestamp(),statement_timestamp())
            """,
            (user_id, company_id, f"{user_id}@{prefix}.invalid", "Task 10 target", department_id, role_id),
        )
        cursor.execute(
            "INSERT INTO admin_mfa_profiles (id,user_id,profile_version,status) VALUES (%s,%s,2,'pending')",
            (profile_id, user_id),
        )
        connection.commit()
    try:
        yield BreakGlassDbFixture(service=service, target_user_id=user_id, prefix=prefix, seeds=seeds)
    finally:
        with db.connect() as connection, connection.cursor() as cursor:
            cursor.execute("DELETE FROM audit_logs WHERE target_id LIKE %s", (f"{prefix}%",))
            cursor.execute(
                "DELETE FROM admin_mfa_break_glass_approvals WHERE request_id IN (SELECT request_id FROM admin_mfa_break_glass_requests WHERE target_user_id=%s)",
                (user_id,),
            )
            cursor.execute("DELETE FROM admin_mfa_break_glass_requests WHERE target_user_id=%s", (user_id,))
            cursor.execute("DELETE FROM admin_mfa_challenges WHERE user_id=%s", (user_id,))
            cursor.execute("DELETE FROM users WHERE id=%s", (user_id,))
            cursor.execute("DELETE FROM roles WHERE id=%s", (role_id,))
            cursor.execute("DELETE FROM departments WHERE id=%s", (department_id,))
            cursor.execute("DELETE FROM companies WHERE id=%s", (company_id,))
            connection.commit()
        with db.connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT count(*) AS count FROM users WHERE id LIKE %s", (f"{prefix}%",))
            assert cursor.fetchone()["count"] == 0


def _signed(fixture: BreakGlassDbFixture, request: dict, approver_id: str) -> dict:
    return AdminMfaBreakGlassService.sign_request(
        request,
        approver_id=approver_id,
        key_version=1,
        private_key=fixture.seeds[approver_id],
    )


def test_request_approve_execute_is_two_person_atomic_and_owner_only(break_glass_db) -> None:
    fixture = break_glass_db
    request = fixture.service.create_request(
        target_user_id=fixture.target_user_id,
        reason="Lost all second factors",
        correlation_id=f"{fixture.prefix}-ticket",
    )
    fixture.service.approve(request["requestId"], _signed(fixture, request, "custodian-a"))
    with tempfile.TemporaryDirectory(prefix="moaworks-task10-") as temp_dir:
        output = Path(temp_dir) / "challenge.json"
        with pytest.raises(BreakGlassApprovalRequired):
            fixture.service.execute(request["requestId"], challenge_output=output)
        fixture.service.approve(request["requestId"], _signed(fixture, request, "custodian-b"))
        result = fixture.service.execute(request["requestId"], challenge_output=output)
        assert result.purpose == "mfa_reenroll"
        assert result.expires_in_seconds <= 600
        assert output.exists()
        if os.name == "nt":
            assert output.stat().st_size > 0
        else:
            assert stat.S_IMODE(output.stat().st_mode) & 0o077 == 0
        body = json.loads(output.read_text(encoding="utf-8"))
        assert body["challengeId"]
        assert "accessToken" not in body
        with pytest.raises(BreakGlassRequestUnavailable):
            fixture.service.execute(request["requestId"], challenge_output=Path(temp_dir) / "again.json")
    with fixture.service.db.connect() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT status FROM admin_mfa_break_glass_requests WHERE request_id=%s", (request["requestId"],))
        assert cursor.fetchone()["status"] == "consumed"
        cursor.execute("SELECT auth_session_version FROM users WHERE id=%s", (fixture.target_user_id,))
        assert cursor.fetchone()["auth_session_version"] == 5
        cursor.execute("SELECT profile_version FROM admin_mfa_profiles WHERE user_id=%s", (fixture.target_user_id,))
        assert cursor.fetchone()["profile_version"] == 3
        cursor.execute("SELECT count(*) AS count FROM admin_mfa_challenges WHERE user_id=%s AND purpose='mfa_reenroll'", (fixture.target_user_id,))
        assert cursor.fetchone()["count"] == 1
        cursor.execute("SELECT reason FROM audit_logs WHERE target_id=%s AND event='admin.mfa.break_glass.executed'", (request["requestId"],))
        audit_reason = cursor.fetchone()["reason"]
        assert body["challengeId"] not in audit_reason


def test_cancel_prevents_later_approval_or_execute(break_glass_db) -> None:
    fixture = break_glass_db
    request = fixture.service.create_request(
        target_user_id=fixture.target_user_id,
        reason="Cancelled request",
        correlation_id=f"{fixture.prefix}-cancel",
    )
    fixture.service.cancel(request["requestId"], reason="No longer needed")
    with pytest.raises(BreakGlassRequestUnavailable):
        fixture.service.approve(request["requestId"], _signed(fixture, request, "custodian-a"))


def test_duplicate_and_expired_approvals_are_rejected_and_audited(break_glass_db) -> None:
    fixture = break_glass_db
    request = fixture.service.create_request(
        target_user_id=fixture.target_user_id, reason="Duplicate approval",
        correlation_id=f"{fixture.prefix}-duplicate",
    )
    approval = _signed(fixture, request, "custodian-a")
    fixture.service.approve(request["requestId"], approval)
    with pytest.raises(BreakGlassApprovalInvalid):
        fixture.service.approve(request["requestId"], approval)
    with fixture.service.db.connect() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT count(*) AS count FROM audit_logs WHERE target_id=%s AND event='admin.mfa.break_glass.approval_rejected'", (request["requestId"],))
        assert cursor.fetchone()["count"] == 1

    expired = fixture.service.create_request(
        target_user_id=fixture.target_user_id, reason="Expired approval",
        correlation_id=f"{fixture.prefix}-expired",
    )
    with fixture.service.db.connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE admin_mfa_break_glass_requests
            SET created_at=statement_timestamp()-interval '2 minutes',
                expires_at=statement_timestamp()-interval '1 minute'
            WHERE request_id=%s
            """,
            (expired["requestId"],),
        )
        connection.commit()
    with pytest.raises(BreakGlassRequestUnavailable):
        fixture.service.approve(expired["requestId"], _signed(fixture, expired, "custodian-a"))
    with fixture.service.db.connect() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT status FROM admin_mfa_break_glass_requests WHERE request_id=%s", (expired["requestId"],))
        assert cursor.fetchone()["status"] == "expired"
        cursor.execute("SELECT count(*) AS count FROM audit_logs WHERE target_id=%s AND event='admin.mfa.break_glass.expired'", (expired["requestId"],))
        assert cursor.fetchone()["count"] == 1


def test_two_execute_race_consumes_request_exactly_once(break_glass_db) -> None:
    fixture = break_glass_db
    request = fixture.service.create_request(
        target_user_id=fixture.target_user_id,
        reason="Concurrent recovery",
        correlation_id=f"{fixture.prefix}-race",
    )
    for approver_id in ("custodian-a", "custodian-b"):
        fixture.service.approve(request["requestId"], _signed(fixture, request, approver_id))
    barrier = threading.Barrier(2)
    outcomes: list[str] = []
    with tempfile.TemporaryDirectory(prefix="moaworks-task10-race-") as temp_dir:
        shared_output = Path(temp_dir) / "challenge.json"
        def run(index: int) -> None:
            barrier.wait()
            try:
                fixture.service.execute(
                    request["requestId"], challenge_output=shared_output
                )
                outcomes.append("success")
            except (BreakGlassRequestUnavailable, FileExistsError):
                outcomes.append("rejected")

        threads = [threading.Thread(target=run, args=(index,)) for index in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
        assert not any(thread.is_alive() for thread in threads)
        assert sorted(outcomes) == ["rejected", "success"]
        assert shared_output.exists()
        assert json.loads(shared_output.read_text(encoding="utf-8"))["challengeId"]


def test_task10_fixture_residue_is_zero() -> None:
    if os.getenv(POSTGRES_OPT_IN) != "1":
        pytest.skip(f"set {POSTGRES_OPT_IN}=1 to use the existing PostgreSQL runtime")
    db = PostgresService()
    with db.connect() as connection, connection.cursor() as cursor:
        checks = (
            "SELECT count(*) AS count FROM users WHERE id LIKE 'task10_%'",
            "SELECT count(*) AS count FROM admin_mfa_challenges WHERE user_id LIKE 'task10_%'",
            "SELECT count(*) AS count FROM admin_mfa_break_glass_requests WHERE target_user_id LIKE 'task10_%'",
            "SELECT count(*) AS count FROM audit_logs WHERE target_id LIKE 'task10_%'",
        )
        for query in checks:
            cursor.execute(query)
            assert cursor.fetchone()["count"] == 0
