from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(HTTPException)
    async def handle_http_exception(_: Request, exc: HTTPException) -> JSONResponse:
        detail = exc.detail
        if isinstance(detail, dict):
            content = {
                "code": detail.get("code", f"HTTP_{exc.status_code}"),
                "userMessage": detail.get("userMessage", "요청 처리에 실패했습니다."),
                "adminMessage": detail.get("adminMessage", str(detail)),
            }
        else:
            content = {
                "code": f"HTTP_{exc.status_code}",
                "userMessage": str(detail),
                "adminMessage": str(detail),
            }
        return JSONResponse(status_code=exc.status_code, content=content)

    @app.exception_handler(ValueError)
    async def handle_value_error(_: Request, exc: ValueError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "code": "VALIDATION_ERROR",
                "userMessage": "입력값 검증에 실패했습니다.",
                "adminMessage": str(exc),
            },
        )

    @app.exception_handler(RequestValidationError)
    async def handle_request_validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "code": "REQUEST_VALIDATION_ERROR",
                "userMessage": "요청 형식이 올바르지 않습니다.",
                "adminMessage": str(exc),
            },
        )
