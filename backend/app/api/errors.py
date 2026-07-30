import logging
import re

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.services.setup_service import SetupPersistenceError


logger = logging.getLogger(__name__)


def _public_error(code: str, user_message: str) -> dict[str, str]:
    return {
        "code": code,
        "userMessage": user_message,
        "adminMessage": user_message,
    }


def _log_rejection(request: Request, status_code: int, code: str) -> None:
    safe_code = code if re.fullmatch(r"[A-Z0-9_]{1,64}", code) else f"HTTP_{status_code}"
    route = request.scope.get("route")
    route_path = getattr(route, "path", None)
    if not isinstance(route_path, str) or not route_path.startswith("/"):
        route_path = "<unmatched>"
    logger.warning(
        "API request rejected status=%s code=%s route=%s",
        status_code,
        safe_code,
        route_path,
    )


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(HTTPException)
    async def handle_http_exception(request: Request, exc: HTTPException) -> JSONResponse:
        detail = exc.detail
        if isinstance(detail, dict):
            code = detail.get("code", f"HTTP_{exc.status_code}")
            user_message = detail.get("userMessage", "요청 처리에 실패했습니다.")
        else:
            code = f"HTTP_{exc.status_code}"
            user_message = "요청 처리에 실패했습니다."
        _log_rejection(request, exc.status_code, code)
        return JSONResponse(status_code=exc.status_code, content=_public_error(code, user_message))

    @app.exception_handler(ValueError)
    async def handle_value_error(request: Request, exc: ValueError) -> JSONResponse:
        _log_rejection(request, 422, "VALIDATION_ERROR")
        return JSONResponse(
            status_code=422,
            content=_public_error("VALIDATION_ERROR", "입력값 검증에 실패했습니다."),
        )

    @app.exception_handler(PermissionError)
    async def handle_permission_error(request: Request, exc: PermissionError) -> JSONResponse:
        _log_rejection(request, 403, "FORBIDDEN")
        return JSONResponse(
            status_code=403,
            content=_public_error("FORBIDDEN", "요청한 기능을 수행할 권한이 없습니다."),
        )

    @app.exception_handler(SetupPersistenceError)
    async def handle_setup_persistence_error(request: Request, exc: SetupPersistenceError) -> JSONResponse:
        _log_rejection(request, 500, "SETUP_PERSISTENCE_VERIFY_FAILED")
        return JSONResponse(
            status_code=500,
            content=_public_error(
                "SETUP_PERSISTENCE_VERIFY_FAILED",
                "초기 설정 저장 결과를 DB에서 확인하지 못했습니다.",
            ),
        )

    @app.exception_handler(RequestValidationError)
    async def handle_request_validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        if request.url.path.startswith("/api/v1/approvals/settings/delegations"):
            period_invalid = any(
                "종료일은 시작일보다 빠를 수 없습니다" in str(item.get("msg", ""))
                for item in exc.errors()
            )
            if period_invalid:
                _log_rejection(request, 400, "APPROVAL_DELEGATION_PERIOD_INVALID")
                return JSONResponse(
                    status_code=400,
                    content=_public_error(
                        "APPROVAL_DELEGATION_PERIOD_INVALID",
                        "종료일은 시작일보다 빠를 수 없습니다.",
                    ),
                )
        _log_rejection(request, 422, "REQUEST_VALIDATION_ERROR")
        return JSONResponse(
            status_code=422,
            content=_public_error("REQUEST_VALIDATION_ERROR", "요청 형식이 올바르지 않습니다."),
        )
