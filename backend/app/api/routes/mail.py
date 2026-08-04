from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import FileResponse


from app.api.dependencies import permission_required
from app.core.config import settings
from app.schemas.directory import AuthUserSummary
from app.schemas.mail_messenger import (
    MailBulkRequest,
    MailBulkResponse,
    MailCategoryRequest,
    MailAttachmentUploadResponse,
    MailBackupCreateRequest,
    MailBackupJobListResponse,
    MailBackupJobView,
    MailBasicPreferencesResponse,
    MailBasicPreferencesUpdateRequest,
    MailRecentRecipientListResponse,
    MailRecentRecipientBulkDeleteRequest,
    MailRecentRecipientDeleteResponse,
    MailRecentRecipientSettingsResponse,
    MailSignatureBulkDeleteRequest,
    MailSignatureCreateRequest,
    MailSignaturePreferencesResponse,
    MailSignaturePreferencesUpdateRequest,
    MailSignatureUpdateRequest,
    MailSignatureView,
    MailDetailResponse,
    MailDraftRequest,
    MailFolderCreateRequest,
    MailFolderListResponse,
    MailFolderUpdateRequest,
    MailFolderView,
    MailListQuery,
    MailListResponse,
    MailMailboxEmptyRequest,
    MailMailboxEmptyResponse,
    MailMailboxPolicyUpdateRequest,
    MailMailboxSettingsResponse,
    MailSendRequest,
    MailSendResponse,
    MailUserDeliveryStatusResponse,
    MailStorageResponse,
    MailStatusResponse,
    MailSpamPolicyUpdateRequest,
    MailSpamRuleCreateRequest,
    MailSpamRuleUpdateRequest,
    MailSpamRuleView,
    MailSpamSettingsResponse,
    MailAutoClassificationPolicyUpdateRequest,
    MailAutoClassificationRuleCreateRequest,
    MailAutoClassificationRuleUpdateRequest,
    MailAutoClassificationRuleView,
    MailAutoClassificationRulesDeleteRequest,
    MailAutoClassificationRulesOrderRequest,
    MailAutoClassificationSettingsResponse,
    MailAutoForwardExceptionCreateRequest, MailAutoForwardExceptionUpdateRequest,
    MailAutoForwardExceptionView, MailAutoForwardExceptionsDeleteRequest,
    MailAutoForwardPolicyUpdateRequest, MailAutoForwardSettingsResponse,
    MailAutoForwardTargetView, MailAutoForwardTargetsCreateRequest,
    MailAutoForwardTargetsDeleteRequest,
    MailOutOfOfficePolicyUpdateRequest, MailOutOfOfficeSettingsResponse,
    MailExternalAccountCreateRequest, MailExternalAccountUpdateRequest,
    MailExternalAccountView, MailExternalAccountListResponse,
    MailExternalCollectResponse, MailExternalBulkDeleteRequest,
    MailTagCreateRequest,
    MailTagListResponse,
    MailTagUpdateRequest,
    MailTagView,
    MailboxSettingsRow,
)
from app.services.mail_messenger_service import (
    MailFolderConflictError,
    MailMessengerService,
    MailPreferenceConflictError,
    MailSignatureConflictError,
)
from app.services.mailbox_backup_service import MailboxBackupService
from app.services.mailbox_scope import MailboxScope
from app.services.mailbox_settings_service import (
    MailboxCountConflictError,
    MailboxSettingsConflictError,
    MailboxSettingsService,
)
from app.services.spam_settings_service import SpamRuleConflictError, SpamSettingsConflictError, SpamSettingsService
from app.services.mail_auto_classification_service import (
    AutoClassificationConflictError,
    AutoClassificationLimitError,
    AutoClassificationPolicyConflictError,
    AutoClassificationTargetForbiddenError,
    AutoClassificationTargetInUseError,
    MailAutoClassificationService,
)
from app.services.mail_auto_forwarding_service import (
    AutoForwardConflictError, AutoForwardInvalidInternalTargetError,
    AutoForwardLimitError, AutoForwardPolicyConflictError,
    AutoForwardSelfTargetError, AutoForwardTargetForbiddenError,
    MailAutoForwardingService,
)
from app.services.mail_out_of_office_service import (
    MailOutOfOfficePolicyConflictError, MailOutOfOfficeService,
    OutOfOfficeInvalidPeriodError, OutOfOfficeRequiredContentError,
    OutOfOfficeTargetForbiddenError,
)
from app.services.mail_external_service import (
    MailExternalService, ExternalMailError, ExternalMailInvalidEndpointError, ExternalMailSecretRequiredError,
    ExternalMailRateLimitedError, ExternalMailConflictError, ExternalMailLimitError,
    ExternalMailTestRequiredError, ExternalMailCollectionBusyError,
    ExternalMailNotFoundError, ExternalMailForbiddenError,
)
from app.services.mail_delivery_operations import MailDeliveryOperations


router = APIRouter()
_external_read_permission = permission_required("mail:read")
_external_send_permission = permission_required("mail:send")


def _service() -> MailMessengerService:
    return MailMessengerService()


def _mailbox_settings_service() -> MailboxSettingsService:
    return MailboxSettingsService()


def _mailbox_backup_service() -> MailboxBackupService:
    return MailboxBackupService()


def _spam_settings_service() -> SpamSettingsService:
    return SpamSettingsService()


def _auto_classification_service() -> MailAutoClassificationService:
    return MailAutoClassificationService()


def _auto_forwarding_service() -> MailAutoForwardingService:
    return MailAutoForwardingService()


def _out_of_office_service() -> MailOutOfOfficeService:
    return MailOutOfOfficeService()

def _external_mail_service() -> MailExternalService:
    return MailExternalService()

def _mail_delivery_operations() -> MailDeliveryOperations:
    return MailDeliveryOperations()


def _parse_mailbox_scope(mailbox_key: str) -> MailboxScope:
    try:
        return MailboxScope.parse(mailbox_key)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "MAILBOX_NOT_FOUND",
                "userMessage": "메일함을 찾을 수 없습니다.",
                "adminMessage": "메일함 식별자가 올바르지 않습니다.",
            },
        ) from exc


def _handle_error(exc: Exception) -> None:
    if isinstance(exc, MailFolderConflictError):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "MAIL_FOLDER_NAME_CONFLICT",
                "userMessage": str(exc),
                "adminMessage": str(exc),
            },
        ) from exc
    if isinstance(exc, ExternalMailRateLimitedError):
        raise HTTPException(status_code=429, detail={"code":"MAIL_EXTERNAL_TEST_RATE_LIMITED","userMessage":str(exc)}) from exc
    if isinstance(exc, (ExternalMailConflictError, ExternalMailLimitError, ExternalMailTestRequiredError, ExternalMailCollectionBusyError)):
        code = "MAIL_EXTERNAL_ACCOUNT_CONFLICT" if isinstance(exc, ExternalMailConflictError) else "MAIL_EXTERNAL_ACCOUNT_LIMIT" if isinstance(exc, ExternalMailLimitError) else "MAIL_EXTERNAL_TEST_REQUIRED" if isinstance(exc, ExternalMailTestRequiredError) else "MAIL_EXTERNAL_COLLECTION_BUSY"
        raise HTTPException(status_code=409, detail={"code":code,"userMessage":str(exc)}) from exc
    if isinstance(exc, ExternalMailNotFoundError):
        raise HTTPException(status_code=404, detail={"code":"MAIL_EXTERNAL_NOT_FOUND","userMessage":str(exc)}) from exc
    if isinstance(exc, ExternalMailForbiddenError):
        raise HTTPException(status_code=403, detail={"code":"MAIL_EXTERNAL_FORBIDDEN","userMessage":str(exc)}) from exc
    if isinstance(exc, (ExternalMailInvalidEndpointError, ExternalMailSecretRequiredError)):
        code = "MAIL_EXTERNAL_INVALID_ENDPOINT" if isinstance(exc, ExternalMailInvalidEndpointError) else "MAIL_EXTERNAL_SECRET_REQUIRED"
        raise HTTPException(status_code=400, detail={"code":code,"userMessage":str(exc)}) from exc
    if isinstance(exc, ExternalMailError):
        raise HTTPException(status_code=400, detail={"code":"MAIL_EXTERNAL_CONNECTION_FAILED","userMessage":"외부메일 연결 테스트에 실패했습니다."}) from exc
    if isinstance(
        exc,
        (
            MailPreferenceConflictError,
            MailSignatureConflictError,
            MailboxSettingsConflictError,
            MailboxCountConflictError,
            SpamRuleConflictError,
            SpamSettingsConflictError,
            AutoClassificationConflictError,
            AutoForwardConflictError,
            MailOutOfOfficePolicyConflictError,
        ),
    ):
        if isinstance(exc, MailOutOfOfficePolicyConflictError):
            code = "MAIL_OUT_OF_OFFICE_POLICY_CONFLICT"
        elif isinstance(exc, AutoForwardLimitError):
            code = "MAIL_AUTO_FORWARD_LIMIT_EXCEEDED"
        elif isinstance(exc, AutoForwardPolicyConflictError):
            code = "MAIL_AUTO_FORWARD_POLICY_CONFLICT"
        elif isinstance(exc, AutoForwardConflictError):
            code = "MAIL_AUTO_FORWARD_EXCEPTION_CONFLICT"
        elif isinstance(exc, AutoClassificationTargetInUseError):
            code = "MAIL_AUTO_CLASSIFICATION_TARGET_IN_USE"
        elif isinstance(exc, AutoClassificationLimitError):
            code = "MAIL_AUTO_CLASSIFICATION_LIMIT_EXCEEDED"
        elif isinstance(exc, AutoClassificationPolicyConflictError):
            code = "MAIL_AUTO_CLASSIFICATION_POLICY_CONFLICT"
        elif isinstance(exc, AutoClassificationConflictError):
            code = "MAIL_AUTO_CLASSIFICATION_RULE_CONFLICT"
        elif isinstance(exc, SpamRuleConflictError):
            code = "MAIL_SPAM_RULE_CONFLICT"
        elif isinstance(exc, SpamSettingsConflictError):
            code = "MAIL_SPAM_SETTINGS_CONFLICT"
        elif isinstance(exc, MailSignatureConflictError):
            code = "MAIL_SIGNATURE_CONFLICT"
        elif isinstance(exc, MailPreferenceConflictError):
            code = "MAIL_PREFERENCE_CONFLICT"
        elif isinstance(exc, MailboxCountConflictError):
            code = "MAILBOX_COUNT_CONFLICT"
        else:
            code = "MAILBOX_SETTINGS_CONFLICT"
        detail = {
            "code": code,
            "userMessage": str(exc),
            "adminMessage": str(exc),
        }
        if isinstance(exc, MailboxCountConflictError):
            detail["currentCount"] = exc.current_count
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=detail,
        ) from exc
    if isinstance(exc, FileNotFoundError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "MAIL_BACKUP_NOT_FOUND",
                "userMessage": "백업 파일을 찾을 수 없습니다.",
                "adminMessage": "백업 artifact를 찾을 수 없습니다.",
            },
        ) from exc
    if isinstance(exc, PermissionError):
        forbidden_code = "MAIL_OUT_OF_OFFICE_FORBIDDEN" if isinstance(exc, OutOfOfficeTargetForbiddenError) else ("MAIL_AUTO_FORWARD_TARGET_FORBIDDEN" if isinstance(exc, AutoForwardTargetForbiddenError) else ("MAIL_AUTO_CLASSIFICATION_TARGET_FORBIDDEN" if isinstance(exc, AutoClassificationTargetForbiddenError) else "MAIL_FORBIDDEN"))
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": forbidden_code,
                "userMessage": str(exc),
                "adminMessage": str(exc),
            },
        ) from exc
    if isinstance(exc, ValueError):
        invalid_code = "MAIL_OUT_OF_OFFICE_INVALID_PERIOD" if isinstance(exc, OutOfOfficeInvalidPeriodError) else ("MAIL_OUT_OF_OFFICE_REQUIRED_CONTENT" if isinstance(exc, OutOfOfficeRequiredContentError) else ("MAIL_AUTO_FORWARD_SELF_TARGET" if isinstance(exc, AutoForwardSelfTargetError) else ("MAIL_AUTO_FORWARD_INVALID_INTERNAL_TARGET" if isinstance(exc, AutoForwardInvalidInternalTargetError) else "MAIL_REQUEST_INVALID")))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": invalid_code,
                "userMessage": str(exc),
                "adminMessage": str(exc),
            },
        ) from exc
    raise exc


@router.get("/preferences/basic", response_model=MailBasicPreferencesResponse)
def get_basic_preferences(user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailBasicPreferencesResponse:
    try:
        return _service().get_basic_preferences(user)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.put("/preferences/basic", response_model=MailBasicPreferencesResponse)
def update_basic_preferences(payload: MailBasicPreferencesUpdateRequest, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailBasicPreferencesResponse:
    try:
        return _service().update_basic_preferences(user, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.post("/preferences/basic/reset", response_model=MailBasicPreferencesResponse)
def reset_basic_preferences(user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailBasicPreferencesResponse:
    try:
        return _service().reset_basic_preferences(user)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/signatures", response_model=MailSignaturePreferencesResponse)
def get_signatures(user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailSignaturePreferencesResponse:
    try:
        return _service().get_signatures(user)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.post("/signatures", response_model=MailSignatureView, status_code=status.HTTP_201_CREATED)
def create_signature(payload: MailSignatureCreateRequest, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailSignatureView:
    try:
        return _service().create_signature(user, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.post("/signatures/bulk-delete", response_model=MailSignaturePreferencesResponse)
def bulk_delete_signatures(payload: MailSignatureBulkDeleteRequest, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailSignaturePreferencesResponse:
    try:
        return _service().bulk_delete_signatures(user, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.put("/signatures/preferences", response_model=MailSignaturePreferencesResponse)
def update_signature_preferences(payload: MailSignaturePreferencesUpdateRequest, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailSignaturePreferencesResponse:
    try:
        return _service().update_signature_preferences(user, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.put("/signatures/{signature_id}", response_model=MailSignatureView)
def update_signature(signature_id: str, payload: MailSignatureUpdateRequest, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailSignatureView:
    try:
        return _service().update_signature(user, signature_id, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.delete("/signatures/{signature_id}", response_model=MailSignaturePreferencesResponse)
def delete_signature(
    signature_id: str,
    expectedVersion: int = Query(ge=1),
    user: AuthUserSummary = Depends(permission_required("mail:read")),
) -> MailSignaturePreferencesResponse:
    try:
        return _service().delete_signature(user, signature_id, expectedVersion)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/inbox", response_model=MailListResponse)
def list_inbox(query: MailListQuery = Depends(), user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailListResponse:
    try:
        return _service().list_inbox(user, query)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/sent", response_model=MailListResponse)
def list_sent(query: MailListQuery = Depends(), user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailListResponse:
    try:
        return _service().list_sent(user, query)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/drafts", response_model=MailListResponse)
def list_drafts(query: MailListQuery = Depends(), user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailListResponse:
    try:
        return _service().list_drafts(user, query)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/folders", response_model=MailFolderListResponse)
def list_mail_folders(user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailFolderListResponse:
    try:
        return _service().list_mail_folders(user)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.post("/folders", response_model=MailFolderView, status_code=status.HTTP_201_CREATED)
def create_mail_folder(payload: MailFolderCreateRequest, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailFolderView:
    try:
        return _service().create_mail_folder(user, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.patch("/folders/{folder_id}", response_model=MailFolderView)
def update_mail_folder(folder_id: str, payload: MailFolderUpdateRequest, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailFolderView:
    try:
        return _service().update_mail_folder(user, folder_id, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.delete("/folders/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_mail_folder(folder_id: str, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> Response:
    try:
        _service().delete_mail_folder(user, folder_id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/folders/{folder_id}/messages", response_model=MailListResponse)
def list_folder_messages(folder_id: str, query: MailListQuery = Depends(), user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailListResponse:
    try:
        return _service().list_folder_messages(user, folder_id, query)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/tags", response_model=MailTagListResponse)
def list_mail_tags(user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailTagListResponse:
    try:
        return _service().list_mail_tags(user)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.post("/tags", response_model=MailTagView, status_code=status.HTTP_201_CREATED)
def create_mail_tag(payload: MailTagCreateRequest, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailTagView:
    try:
        return _service().create_mail_tag(user, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.patch("/tags/{tag_id}", response_model=MailTagView)
def update_mail_tag(tag_id: str, payload: MailTagUpdateRequest, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailTagView:
    try:
        return _service().update_mail_tag(user, tag_id, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.delete("/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_mail_tag(tag_id: str, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> Response:
    try:
        _service().delete_mail_tag(user, tag_id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/tags/{tag_id}/messages", response_model=MailListResponse)
def list_tag_messages(tag_id: str, query: MailListQuery = Depends(), user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailListResponse:
    try:
        return _service().list_tag_messages(user, tag_id, query)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/spam", response_model=MailListResponse)
def list_spam(query: MailListQuery = Depends(), user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailListResponse:
    try:
        return _service().list_spam(user, query)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/trash", response_model=MailListResponse)
def list_trash(query: MailListQuery = Depends(), user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailListResponse:
    try:
        return _service().list_trash(user, query)
    except Exception as exc:
        _handle_error(exc)
        raise

@router.post("/bulk", response_model=MailBulkResponse)
def bulk_mail(payload: MailBulkRequest, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailBulkResponse:
    try:
        return _service().bulk_mail(user, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/mailbox-settings", response_model=MailMailboxSettingsResponse)
def get_mailbox_settings(
    user: AuthUserSummary = Depends(permission_required("mail:read")),
) -> MailMailboxSettingsResponse:
    try:
        return _mailbox_settings_service().get_settings(user)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.patch("/mailbox-settings/{mailbox_key}", response_model=MailboxSettingsRow)
def update_mailbox_policy(
    mailbox_key: str,
    payload: MailMailboxPolicyUpdateRequest,
    user: AuthUserSummary = Depends(permission_required("mail:read")),
) -> MailboxSettingsRow:
    try:
        return _mailbox_settings_service().update_policy(
            user,
            _parse_mailbox_scope(mailbox_key),
            payload,
        )
    except Exception as exc:
        _handle_error(exc)
        raise


@router.post("/mailbox-settings/{mailbox_key}/empty", response_model=MailMailboxEmptyResponse)
def empty_mailbox(
    mailbox_key: str,
    payload: MailMailboxEmptyRequest,
    user: AuthUserSummary = Depends(permission_required("mail:read")),
) -> MailMailboxEmptyResponse:
    try:
        return _mailbox_settings_service().empty_mailbox(
            user,
            _parse_mailbox_scope(mailbox_key),
            payload,
        )
    except Exception as exc:
        _handle_error(exc)
        raise


@router.post("/mailbox-backups", response_model=MailBackupJobView, status_code=status.HTTP_202_ACCEPTED)
def create_mailbox_backup(
    payload: MailBackupCreateRequest,
    user: AuthUserSummary = Depends(permission_required("mail:read")),
) -> MailBackupJobView:
    try:
        return _mailbox_backup_service().create_job(
            user,
            _parse_mailbox_scope(payload.mailboxKey),
        )
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/mailbox-backups", response_model=MailBackupJobListResponse)
def list_mailbox_backups(
    user: AuthUserSummary = Depends(permission_required("mail:read")),
) -> MailBackupJobListResponse:
    try:
        return _mailbox_backup_service().list_jobs(user)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.post("/mailbox-backups/{job_id}/retry", response_model=MailBackupJobView, status_code=status.HTTP_202_ACCEPTED)
def retry_mailbox_backup(
    job_id: str,
    user: AuthUserSummary = Depends(permission_required("mail:read")),
) -> MailBackupJobView:
    try:
        return _mailbox_backup_service().retry_job(user, job_id)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/mailbox-backups/{job_id}/download")
def download_mailbox_backup(
    job_id: str,
    user: AuthUserSummary = Depends(permission_required("mail:read")),
) -> FileResponse:
    try:
        artifact = _mailbox_backup_service().download_artifact(user, job_id)
        return FileResponse(
            artifact.path,
            media_type="application/zip",
            filename=artifact.download_name,
        )
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/spam-settings", response_model=MailSpamSettingsResponse)
def get_spam_settings(
    user: AuthUserSummary = Depends(permission_required("mail:read")),
) -> MailSpamSettingsResponse:
    try:
        return _spam_settings_service().get_settings(user)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.patch("/spam-settings", response_model=MailSpamSettingsResponse)
def update_spam_settings(
    payload: MailSpamPolicyUpdateRequest,
    user: AuthUserSummary = Depends(permission_required("mail:read")),
) -> MailSpamSettingsResponse:
    try:
        return _spam_settings_service().update_policy(user, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.post("/spam-settings/rules", response_model=MailSpamRuleView, status_code=status.HTTP_201_CREATED)
def create_spam_rule(
    payload: MailSpamRuleCreateRequest,
    user: AuthUserSummary = Depends(permission_required("mail:read")),
) -> MailSpamRuleView:
    try:
        return _spam_settings_service().create_rule(user, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.patch("/spam-settings/rules/{rule_id}", response_model=MailSpamRuleView)
def update_spam_rule(
    rule_id: str,
    payload: MailSpamRuleUpdateRequest,
    user: AuthUserSummary = Depends(permission_required("mail:read")),
) -> MailSpamRuleView:
    try:
        return _spam_settings_service().update_rule(user, rule_id, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.delete("/spam-settings/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_spam_rule(
    rule_id: str,
    user: AuthUserSummary = Depends(permission_required("mail:read")),
) -> Response:
    try:
        _spam_settings_service().delete_rule(user, rule_id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/settings/auto-classification", response_model=MailAutoClassificationSettingsResponse)
def get_auto_classification_settings(user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailAutoClassificationSettingsResponse:
    try:
        return _auto_classification_service().get_settings(user)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.patch("/settings/auto-classification", response_model=MailAutoClassificationSettingsResponse)
def update_auto_classification_settings(payload: MailAutoClassificationPolicyUpdateRequest, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailAutoClassificationSettingsResponse:
    try:
        return _auto_classification_service().update_policy(user, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.post("/settings/auto-classification/rules", response_model=MailAutoClassificationRuleView, status_code=status.HTTP_201_CREATED)
def create_auto_classification_rule(payload: MailAutoClassificationRuleCreateRequest, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailAutoClassificationRuleView:
    try:
        return _auto_classification_service().create_rule(user, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.patch("/settings/auto-classification/rules/order", response_model=MailAutoClassificationSettingsResponse)
def reorder_auto_classification_rules(payload: MailAutoClassificationRulesOrderRequest, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailAutoClassificationSettingsResponse:
    try:
        return _auto_classification_service().reorder_rules(user, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.post("/settings/auto-classification/rules/delete", status_code=status.HTTP_204_NO_CONTENT)
def delete_auto_classification_rules(payload: MailAutoClassificationRulesDeleteRequest, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> Response:
    try:
        _auto_classification_service().delete_rules(user, payload)
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.patch("/settings/auto-classification/rules/{rule_id}", response_model=MailAutoClassificationRuleView)
def update_auto_classification_rule(rule_id: str, payload: MailAutoClassificationRuleUpdateRequest, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailAutoClassificationRuleView:
    try:
        return _auto_classification_service().update_rule(user, rule_id, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.delete("/settings/auto-classification/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_auto_classification_rule(rule_id: str, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> Response:
    try:
        _auto_classification_service().delete_rule(user, rule_id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/settings/recent-recipients", response_model=MailRecentRecipientSettingsResponse)
def list_recent_recipient_settings(
    limit: int = Query(default=200, ge=1, le=200),
    user: AuthUserSummary = Depends(permission_required("mail:read")),
) -> MailRecentRecipientSettingsResponse:
    try:
        return _service().list_recent_recipient_settings(user, limit)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.post("/settings/recent-recipients/bulk-delete", response_model=MailRecentRecipientDeleteResponse)
def bulk_delete_recent_recipients(
    payload: MailRecentRecipientBulkDeleteRequest,
    user: AuthUserSummary = Depends(permission_required("mail:send")),
) -> MailRecentRecipientDeleteResponse:
    try:
        return _service().bulk_delete_recent_recipients(user, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.delete("/settings/recent-recipients/{recipient_id}", response_model=MailRecentRecipientDeleteResponse)
def delete_recent_recipient(
    recipient_id: str,
    user: AuthUserSummary = Depends(permission_required("mail:send")),
) -> MailRecentRecipientDeleteResponse:
    try:
        return _service().delete_recent_recipient(user, recipient_id)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/settings/out-of-office", response_model=MailOutOfOfficeSettingsResponse)
def get_out_of_office_settings(user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailOutOfOfficeSettingsResponse:
    try:
        return _out_of_office_service().get_settings(user)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.patch("/settings/out-of-office", response_model=MailOutOfOfficeSettingsResponse)
def update_out_of_office_settings(payload: MailOutOfOfficePolicyUpdateRequest, user: AuthUserSummary = Depends(permission_required("mail:send"))) -> MailOutOfOfficeSettingsResponse:
    try:
        return _out_of_office_service().update_policy(user, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/settings/external-accounts", response_model=MailExternalAccountListResponse)
def list_external_accounts(user: AuthUserSummary = Depends(_external_read_permission)):
    try: return _external_mail_service().list_accounts(user)
    except Exception as exc: _handle_error(exc); raise


@router.post("/settings/external-accounts", response_model=MailExternalAccountView, status_code=201)
def create_external_account(payload: MailExternalAccountCreateRequest, user: AuthUserSummary = Depends(_external_send_permission)):
    try: return _external_mail_service().create_account(user, payload)
    except Exception as exc: _handle_error(exc); raise

@router.post("/settings/external-accounts/bulk-delete", status_code=204)
def bulk_delete_external_accounts(payload: MailExternalBulkDeleteRequest, user: AuthUserSummary = Depends(_external_send_permission)):
    try:
        _external_mail_service().bulk_delete_accounts(user, payload.accountIds)
        return Response(status_code=204)
    except Exception as exc: _handle_error(exc); raise

@router.patch("/settings/external-accounts/{account_id}", response_model=MailExternalAccountView)
def update_external_account(account_id: str, payload: MailExternalAccountUpdateRequest, user: AuthUserSummary = Depends(_external_send_permission)):
    try: return _external_mail_service().update_account(user, account_id, payload)
    except Exception as exc: _handle_error(exc); raise

@router.delete("/settings/external-accounts/{account_id}", status_code=204)
def delete_external_account(account_id: str, user: AuthUserSummary = Depends(_external_send_permission)):
    try: _external_mail_service().delete_account(user, account_id); return Response(status_code=204)
    except Exception as exc: _handle_error(exc); raise

@router.post("/settings/external-accounts/{account_id}/test", response_model=MailExternalAccountView)
def test_external_account(account_id: str, user: AuthUserSummary = Depends(_external_send_permission)):
    try: return _external_mail_service().test_account(user, account_id)
    except Exception as exc: _handle_error(exc); raise

@router.post("/settings/external-accounts/{account_id}/collect", response_model=MailExternalCollectResponse, status_code=202)
def collect_external_account(account_id: str, user: AuthUserSummary = Depends(_external_send_permission)):
    try: return _external_mail_service().queue_collect(user, account_id)
    except Exception as exc: _handle_error(exc); raise

@router.get("/settings/auto-forwarding", response_model=MailAutoForwardSettingsResponse)
def get_auto_forwarding_settings(user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailAutoForwardSettingsResponse:
    try: return _auto_forwarding_service().get_settings(user)
    except Exception as exc: _handle_error(exc); raise

@router.patch("/settings/auto-forwarding", response_model=MailAutoForwardSettingsResponse)
def update_auto_forwarding_settings(payload: MailAutoForwardPolicyUpdateRequest, user: AuthUserSummary = Depends(permission_required("mail:send"))) -> MailAutoForwardSettingsResponse:
    try: return _auto_forwarding_service().update_policy(user, payload)
    except Exception as exc: _handle_error(exc); raise

@router.post("/settings/auto-forwarding/targets", response_model=list[MailAutoForwardTargetView], status_code=status.HTTP_201_CREATED)
def create_auto_forwarding_targets(payload: MailAutoForwardTargetsCreateRequest, user: AuthUserSummary = Depends(permission_required("mail:send"))) -> list[MailAutoForwardTargetView]:
    try: return _auto_forwarding_service().create_targets(user, payload)
    except Exception as exc: _handle_error(exc); raise

@router.post("/settings/auto-forwarding/targets/delete", status_code=status.HTTP_204_NO_CONTENT)
def delete_auto_forwarding_targets(payload: MailAutoForwardTargetsDeleteRequest, user: AuthUserSummary = Depends(permission_required("mail:send"))) -> Response:
    try: _auto_forwarding_service().delete_targets(user, payload); return Response(status_code=status.HTTP_204_NO_CONTENT)
    except Exception as exc: _handle_error(exc); raise

@router.post("/settings/auto-forwarding/exceptions", response_model=MailAutoForwardExceptionView, status_code=status.HTTP_201_CREATED)
def create_auto_forwarding_exception(payload: MailAutoForwardExceptionCreateRequest, user: AuthUserSummary = Depends(permission_required("mail:send"))) -> MailAutoForwardExceptionView:
    try: return _auto_forwarding_service().create_exception(user, payload)
    except Exception as exc: _handle_error(exc); raise

@router.post("/settings/auto-forwarding/exceptions/delete", status_code=status.HTTP_204_NO_CONTENT)
def delete_auto_forwarding_exceptions(payload: MailAutoForwardExceptionsDeleteRequest, user: AuthUserSummary = Depends(permission_required("mail:send"))) -> Response:
    try: _auto_forwarding_service().delete_exceptions(user, payload); return Response(status_code=status.HTTP_204_NO_CONTENT)
    except Exception as exc: _handle_error(exc); raise

@router.patch("/settings/auto-forwarding/exceptions/{exception_id}", response_model=MailAutoForwardExceptionView)
def update_auto_forwarding_exception(exception_id: str, payload: MailAutoForwardExceptionUpdateRequest, user: AuthUserSummary = Depends(permission_required("mail:send"))) -> MailAutoForwardExceptionView:
    try: return _auto_forwarding_service().update_exception(user, exception_id, payload)
    except Exception as exc: _handle_error(exc); raise

@router.delete("/settings/auto-forwarding/exceptions/{exception_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_auto_forwarding_exception(exception_id: str, user: AuthUserSummary = Depends(permission_required("mail:send"))) -> Response:
    try: _auto_forwarding_service().delete_exception(user, exception_id); return Response(status_code=status.HTTP_204_NO_CONTENT)
    except Exception as exc: _handle_error(exc); raise

@router.post("/{mail_id}/category", response_model=MailStatusResponse)
def set_category(mail_id: str, payload: MailCategoryRequest, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailStatusResponse:
    try:
        return _service().set_mail_category(user, mail_id, payload)
    except Exception as exc:
        _handle_error(exc)
        raise

@router.get("/storage", response_model=MailStorageResponse)
def get_mail_storage(user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailStorageResponse:
    try:
        return _service().get_mail_storage(user)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/delivery/status", response_model=MailUserDeliveryStatusResponse)
def get_mail_delivery_status(
    user: AuthUserSummary = Depends(permission_required("mail:send")),
) -> MailUserDeliveryStatusResponse:
    try:
        return _mail_delivery_operations().get_user_status(user)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.post("/attachments", response_model=MailAttachmentUploadResponse)
async def upload_attachment(
    file: UploadFile = File(...),
    user: AuthUserSummary = Depends(permission_required("mail:send")),
) -> MailAttachmentUploadResponse:
    try:
        content = await file.read(settings.mail_attachment_max_file_bytes + 1)
        return _service().stage_attachment(
            user,
            file.filename or "attachment.bin",
            file.content_type or "application/octet-stream",
            content,
        )
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/recent-recipients", response_model=MailRecentRecipientListResponse)
def recent_recipients(
    limit: int = Query(default=20, ge=1, le=50),
    user: AuthUserSummary = Depends(permission_required("mail:read")),
) -> MailRecentRecipientListResponse:
    try:
        return _service().list_recent_recipients(user, limit)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.get("/{mail_id}/attachments/{attachment_id}")
def download_attachment(
    mail_id: str,
    attachment_id: str,
    user: AuthUserSummary = Depends(permission_required("mail:read")),
) -> FileResponse:
    try:
        item = _service().download_attachment(user, mail_id, attachment_id)
        return FileResponse(
            path=item["path"],
            media_type=item["contentType"],
            filename=item["fileName"],
        )
    except Exception as exc:
        _handle_error(exc)
        raise



@router.get("/{mail_id}", response_model=MailDetailResponse)
def get_mail(mail_id: str, user: AuthUserSummary = Depends(permission_required("mail:read")), view: str = Query(default="inbox")) -> MailDetailResponse:
    try:
        return _service().get_mail(user, mail_id, view)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.post("/send", response_model=MailSendResponse)
def send_mail(payload: MailSendRequest, user: AuthUserSummary = Depends(permission_required("mail:send"))) -> MailSendResponse:
    try:
        return _service().send_mail(user, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.post("/draft", response_model=MailSendResponse)
def save_draft(payload: MailDraftRequest, user: AuthUserSummary = Depends(permission_required("mail:send"))) -> MailSendResponse:
    try:
        return _service().save_draft(user, payload)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.post("/{mail_id}/read", response_model=MailStatusResponse)
def mark_read(mail_id: str, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailStatusResponse:
    try:
        return _service().mark_mail_read(user, mail_id)
    except Exception as exc:
        _handle_error(exc)
        raise


@router.post("/{mail_id}/star", response_model=MailStatusResponse)
def toggle_star(mail_id: str, user: AuthUserSummary = Depends(permission_required("mail:read"))) -> MailStatusResponse:
    try:
        return _service().toggle_mail_star(user, mail_id)
    except Exception as exc:
        _handle_error(exc)
        raise
