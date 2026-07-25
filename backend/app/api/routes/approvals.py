from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from app.api.dependencies import get_current_user, permission_required
from app.schemas.directory import (
    ApprovalActionReason,
    ApprovalApproverListResponse,
    ApprovalBasicPreferenceResponse,
    ApprovalAttachmentUploadResponse,
    ApprovalCreateResponse,
    ApprovalDocumentCreateRequest,
    ApprovalDocumentDetailResponse,
    ApprovalDocumentResponse,
    ApprovalDocumentUpdateRequest,
    ApprovalLineActionRequest,
    ApprovalListResponse,
    AuthUserSummary,
    AuditLogListResponse,
)
from app.services.directory_store import ApprovalPreferenceConflictError, DirectoryStore
from app.services.approval_attachment_storage import APPROVAL_ATTACHMENT_MAX_FILE_BYTES
from app.services.approval_signature_storage import APPROVAL_SIGNATURE_MAX_FILE_BYTES


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


@router.post("/attachments", response_model=ApprovalAttachmentUploadResponse)
async def upload_approval_attachment(
    file: UploadFile = File(...),
    user: AuthUserSummary = Depends(permission_required("approval:create")),
) -> ApprovalAttachmentUploadResponse:
    content = await file.read(APPROVAL_ATTACHMENT_MAX_FILE_BYTES + 1)
    return DirectoryStore().stage_approval_attachment(
        user.userId,
        file.filename or "attachment.bin",
        file.content_type or "application/octet-stream",
        content,
    )


@router.get("/settings/basic", response_model=ApprovalBasicPreferenceResponse)
def get_approval_basic_preferences(
    user: AuthUserSummary = Depends(permission_required("approval:read")),
) -> ApprovalBasicPreferenceResponse:
    return DirectoryStore().get_approval_basic_preferences(user.userId)


@router.put("/settings/basic", response_model=ApprovalBasicPreferenceResponse)
async def update_approval_basic_preferences(
    writing_method: str = Form(..., alias="writingMethod"),
    attachment_image_display: str = Form(..., alias="attachmentImageDisplay"),
    expected_version: int = Form(..., alias="expectedVersion"),
    remove_signature: bool = Form(False, alias="removeSignature"),
    signature: UploadFile | None = File(default=None),
    user: AuthUserSummary = Depends(permission_required("approval:create")),
) -> ApprovalBasicPreferenceResponse:
    upload = None
    if signature is not None:
        upload = (
            signature.filename or "signature.png",
            signature.content_type or "application/octet-stream",
            await signature.read(APPROVAL_SIGNATURE_MAX_FILE_BYTES + 1),
        )
    try:
        return DirectoryStore().update_approval_basic_preferences(
            user.userId,
            writing_method,
            attachment_image_display,
            expected_version,
            remove_signature,
            upload,
        )
    except ApprovalPreferenceConflictError as exc:
        raise HTTPException(
            status_code=409,
            detail={"code": "APPROVAL_SETTINGS_STALE", "userMessage": str(exc), "adminMessage": str(exc)},
        ) from exc


@router.get("/settings/signature")
def get_approval_signature(
    user: AuthUserSummary = Depends(permission_required("approval:read")),
) -> FileResponse:
    item = DirectoryStore().get_approval_signature(user.userId)
    return FileResponse(
        path=item["path"], media_type=item["contentType"], filename=item["fileName"],
        content_disposition_type="inline", headers={"X-Content-Type-Options": "nosniff"},
    )


@router.get("/{document_id}/lines/{line_id}/signature")
def get_approval_line_signature(
    document_id: str,
    line_id: str,
    user: AuthUserSummary = Depends(permission_required("approval:read")),
) -> FileResponse:
    item = DirectoryStore().get_approval_line_signature(user.userId, document_id, line_id)
    return FileResponse(
        path=item["path"], media_type=item["contentType"], filename=item["fileName"],
        content_disposition_type="inline", headers={"X-Content-Type-Options": "nosniff"},
    )


@router.get("/{document_id}/attachments/{attachment_id}/preview")
def preview_approval_attachment(
    document_id: str,
    attachment_id: str,
    user: AuthUserSummary = Depends(permission_required("approval:read")),
) -> FileResponse:
    item = DirectoryStore().get_approval_attachment_preview(user.userId, document_id, attachment_id)
    return FileResponse(
        path=item["path"], media_type=item["contentType"], filename=item["fileName"],
        content_disposition_type="inline", headers={"X-Content-Type-Options": "nosniff"},
    )


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


@router.patch("/{document_id}", response_model=ApprovalDocumentDetailResponse)
def update_approval(
    document_id: str,
    payload: ApprovalDocumentUpdateRequest,
    user: AuthUserSummary = Depends(permission_required("approval:create")),
) -> ApprovalDocumentDetailResponse:
    return DirectoryStore().update_approval_document(user.userId, document_id, payload)


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
