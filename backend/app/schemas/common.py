from pydantic import BaseModel


class ApiErrorResponse(BaseModel):
    code: str
    userMessage: str
    adminMessage: str

