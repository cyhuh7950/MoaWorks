from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse

from app.api.dependencies import get_current_user, permission_required
from app.schemas.directory import (
    ApprovalActionReason,
    ApprovalApproverListResponse,
    ApprovalCreateResponse,
    ApprovalDocumentCreateRequest,
    ApprovalDocumentDetailResponse,
    ApprovalDocumentResponse,
    ApprovalLineActionRequest,
    ApprovalListResponse,
    AuthUserSummary,
    AuditLogListResponse,
)
from app.services.directory_store import DirectoryStore


router = APIRouter()
admin_router = APIRouter()


@router.get("", response_model=ApprovalListResponse)
def list_approvals(user: AuthUserSummary = Depends(get_current_user)) -> ApprovalListResponse:
    return DirectoryStore().list_approval_documents(user.userId)


@router.get("/audit-logs", response_model=AuditLogListResponse)
def list_approval_audit_logs(
    documentId: str | None = Query(default=None, alias="documentId"),
    user: AuthUserSummary = Depends(get_current_user),
) -> AuditLogListResponse:
    return DirectoryStore().get_audit_logs(user.userId, target_id=documentId)


@router.get("/approvers", response_model=ApprovalApproverListResponse)
def list_approval_approvers(
    user: AuthUserSummary = Depends(permission_required("approval:create")),
) -> ApprovalApproverListResponse:
    return DirectoryStore().list_active_approval_approvers(user.userId)


@router.get("/{document_id}/attachments/{attachment_id}")
def download_approval_attachment(
    document_id: str,
    attachment_id: str,
    user: AuthUserSummary = Depends(permission_required("approval:read")),
) -> FileResponse:
    item = DirectoryStore().get_approval_attachment(user.userId, document_id, attachment_id)
    return FileResponse(path=item["path"], media_type=item["contentType"], filename=item["fileName"])


@router.get("/{document_id}", response_model=ApprovalDocumentDetailResponse)
def get_approval(
    document_id: str,
    user: AuthUserSummary = Depends(permission_required("approval:read")),
) -> ApprovalDocumentDetailResponse:
    return DirectoryStore().get_approval_document(user.userId, document_id)


@router.post("", response_model=ApprovalCreateResponse)
def create_approval(
    payload: ApprovalDocumentCreateRequest,
    user: AuthUserSummary = Depends(permission_required("approval:create")),
) -> ApprovalCreateResponse:
    return DirectoryStore().create_approval_document(user.userId, payload)


@router.post("/{document_id}/submit", response_model=ApprovalDocumentResponse)
def submit_approval(
    document_id: str,
    user: AuthUserSummary = Depends(permission_required("approval:submit")),
) -> ApprovalDocumentResponse:
    return DirectoryStore().submit_approval_document(user.userId, document_id)


@router.post("/{document_id}/approve", response_model=ApprovalDocumentResponse)
def approve_approval(
    document_id: str,
    payload: ApprovalLineActionRequest,
    user: AuthUserSummary = Depends(permission_required("approval:act")),
) -> ApprovalDocumentResponse:
    return DirectoryStore().approve_approval_document(user.userId, document_id, payload)


@router.post("/{document_id}/reject", response_model=ApprovalDocumentResponse)
def reject_approval(
    document_id: str,
    payload: ApprovalLineActionRequest,
    user: AuthUserSummary = Depends(permission_required("approval:act")),
) -> ApprovalDocumentResponse:
    return DirectoryStore().reject_approval_document(user.userId, document_id, payload)


@router.post("/{document_id}/withdraw", response_model=ApprovalDocumentResponse)
def withdraw_approval(
    document_id: str,
    user: AuthUserSummary = Depends(permission_required("approval:withdraw")),
) -> ApprovalDocumentResponse:
    return DirectoryStore().withdraw_approval_document(user.userId, document_id)


@router.post("/{document_id}/redraft", response_model=ApprovalDocumentResponse)
def redraft_approval(
    document_id: str,
    user: AuthUserSummary = Depends(permission_required("approval:rework")),
) -> ApprovalDocumentResponse:
    return DirectoryStore().rework_approval_document(user.userId, document_id)


@admin_router.post("/{document_id}/force-approve", response_model=ApprovalDocumentResponse)
def force_approve(
    document_id: str,
    payload: ApprovalActionReason,
    user: AuthUserSummary = Depends(permission_required("approval:force")),
) -> ApprovalDocumentResponse:
    return DirectoryStore().admin_force_approve(user.userId, document_id, payload)


@admin_router.post("/{document_id}/force-reject", response_model=ApprovalDocumentResponse)
def force_reject(
    document_id: str,
    payload: ApprovalActionReason,
    user: AuthUserSummary = Depends(permission_required("approval:force")),
) -> ApprovalDocumentResponse:
    return DirectoryStore().admin_force_reject(user.userId, document_id, payload)


@admin_router.get("/{document_id}/audit-logs", response_model=AuditLogListResponse)
def list_audit_logs_for_document(document_id: str, user: AuthUserSummary = Depends(permission_required("approval:force"))) -> AuditLogListResponse:
    return DirectoryStore().get_audit_logs(user.userId, target_id=document_id)
