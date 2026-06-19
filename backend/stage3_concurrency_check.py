from __future__ import annotations

import os
import shutil
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from app.schemas.directory import (
    ApprovalActionReason,
    ApprovalDocumentCreateRequest,
    ApprovalLineActionRequest,
    UserCreateRequest,
)


def _run_concurrent_actions(description: str, actions: list) -> list[tuple]:
    results: list[tuple] = []
    lock = threading.Lock()

    def worker(action) -> None:
        try:
            action()
            outcome = (True, None)
        except Exception as exc:  # noqa: BLE001
            outcome = (False, str(exc))
        with lock:
            results.append(outcome)

    with ThreadPoolExecutor(max_workers=len(actions)) as executor:
        for action in actions:
            executor.submit(worker, action)
    return results


def run_checks() -> bool:
    base_root = Path(__file__).resolve().parent
    data_root = base_root / "data" / "runtime"
    temp_root = Path(tempfile.mkdtemp(prefix="moaworks-phase3-"))
    temp_state = temp_root / "directory-state.json"
    temp_setup = temp_root / "setup-state.json"

    shutil.copy2(data_root / "directory-state.json", temp_state)
    shutil.copy2(data_root / "setup-state.json", temp_setup)

    os.environ["SETUP_STATE_PATH"] = str(temp_setup)
    os.environ["DIRECTORY_STATE_PATH"] = str(temp_state)

    import importlib
    import app.core.config

    importlib.reload(app.core.config)

    from app.services.directory_store import DirectoryStore

    store = DirectoryStore(temp_state)
    base_state = store.load()
    dept_id = base_state.departments[0].id

    # 상태별 승인/직권 처리 전이를 위한 권한 역할 준비
    approver_role = store.create_role(
        "phase3_approver",
        [
            "approval:read",
            "approval:act",
            "approval:submit",
            "approval:create",
            "approval:withdraw",
            "approval:rework",
        ],
    )
    writer_role = store.create_role(
        "phase3_writer",
        [
            "approval:read",
            "approval:submit",
            "approval:create",
            "approval:withdraw",
            "approval:rework",
        ],
    )
    force_role = store.create_role(
        "phase3_admin_force",
        [
            "admin:*",
            "approval:force",
            "approval:read",
            "approval:create",
            "approval:submit",
            "approval:act",
            "approval:withdraw",
            "approval:rework",
        ],
    )

    writer = store.create_user(
        UserCreateRequest(
            name="phase3_writer",
            email="writer@moaworks.local",
            password="password1234",
            departmentId=dept_id,
            roleId=writer_role.id,
            status="active",
            userType="user",
        )
    )
    approver = store.create_user(
        UserCreateRequest(
            name="phase3_approver",
            email="approver@moaworks.local",
            password="password1234",
            departmentId=dept_id,
            roleId=approver_role.id,
            status="active",
            userType="user",
        )
    )
    force_user = store.create_user(
        UserCreateRequest(
            name="phase3_force",
            email="force@moaworks.local",
            password="password1234",
            departmentId=dept_id,
            roleId=force_role.id,
            status="active",
            userType="admin",
        )
    )

    def submit_document() -> str:
        doc = store.create_approval_document(
            writer.userId,
            ApprovalDocumentCreateRequest(
                title="동시성 테스트 문서",
                content="동시성 충돌 제어 검증",
                approverUserIds=[approver.userId],
            ),
        )
        store.submit_approval_document(writer.userId, doc.documentId)
        return doc.documentId

    # 충돌 1: 회수/승인 경쟁
    doc_id = submit_document()
    actions = [
        lambda: store.withdraw_approval_document(writer.userId, doc_id),
        lambda: store.approve_approval_document(approver.userId, doc_id, ApprovalLineActionRequest(reason="동의")),
    ]
    outcomes = _run_concurrent_actions("withdraw vs approve", actions)
    success_count = sum(1 for success, _ in outcomes if success)
    if success_count != 1:
        print("결재 충돌 1 실패: withdraw/approve 중 하나만 성공해야 함")
        return False

    # 충돌 2: 동시 승인 경쟁(1개만 성공해야 함)
    doc_id = submit_document()
    actions = [
        lambda: store.approve_approval_document(approver.userId, doc_id, ApprovalLineActionRequest(reason="1차 승인")),
        lambda: store.approve_approval_document(approver.userId, doc_id, ApprovalLineActionRequest(reason="2차 승인")),
    ]
    outcomes = _run_concurrent_actions("approve vs approve", actions)
    success_count = sum(1 for success, _ in outcomes if success)
    if success_count != 1:
        print("결재 충돌 2 실패: 동시 승인 1개만 성공해야 함")
        return False

    # 충돌 3: 직권 처리 유효 상태 검증
    doc_id = store.create_approval_document(
        writer.userId,
        ApprovalDocumentCreateRequest(
            title="직권 처리 상태 검사",
            content="제출 전에는 직권 처리 불가",
            approverUserIds=[approver.userId],
        ),
    ).documentId

    try:
        store.admin_force_approve(force_user.userId, doc_id, ApprovalActionReason(reason="강제 승인 테스트"))
    except Exception:
        pass
    else:
        print("직권 처리 제한 규칙 실패: submitted 전에도 승인 처리됨")
        return False

    # 충돌 4: 승인 완료 상태에서 변조 시도 차단
    doc_id = submit_document()
    now = ApprovalLineActionRequest(reason="최종 승인")
    approved_doc = store.approve_approval_document(approver.userId, doc_id, now)
    if approved_doc.status != "approved":
        print("승인 완료 문서 상태 검증 실패: approved 상태로 수렴하지 않음")
        return False

    try:
        store.withdraw_approval_document(writer.userId, doc_id)
        print("불변성 규칙 실패: 승인 문서가 회수됨")
        return False
    except Exception:
        pass

    try:
        store.admin_force_reject(force_user.userId, doc_id, ApprovalActionReason(reason="강제 반려 재시도"))
        print("불변성 규칙 실패: 승인 문서에 직권 반려 가능")
        return False
    except Exception:
        pass

    try:
        store.approve_approval_document(approver.userId, doc_id, ApprovalLineActionRequest(reason="재승인 시도"))
        print("불변성 규칙 실패: 승인 완료 문서 재승인 허용")
        return False
    except Exception:
        pass

    logs = store.get_audit_logs(force_user.userId, target_id=doc_id)
    if not any(log.event == "approval.approved" for log in logs.logs):
        print("감사 로그 누락: approval.approved 이벤트가 기록되지 않음")
        return False

    print("phase3_concurrency_check: PASS")
    return True


if __name__ == "__main__":
    if not run_checks():
        raise SystemExit(1)
