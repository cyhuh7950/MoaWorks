from fastapi import APIRouter

from app.schemas.health import HealthResponse
from app.services.health_service import HealthService


router = APIRouter()


@router.get("/health", response_model=HealthResponse)
def get_health() -> HealthResponse:
    return HealthService().build()
