"""불완전한 개인 설정은 관리자 기본 LLM을 가리지 않는다."""
from copy import deepcopy
from unittest.mock import patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user
from app.api.routes import personal_ai
from app.schemas.personal_ai import PersonalAiChatRequest, PersonalAiConfigUpdate
from app.services.personal_ai_service import PersonalAiService
from test_f13_personal_ai import (
    FixturePersonalAiProviderClient,
    InMemoryCompanyLlmStore,
    InMemoryPersonalAiStore,
    personal_ai_actor,
)


def make_service(overrides=None, *, admin=True):
    config = dict(provider="cerebras", model="model-a", apiKeyConfigured=True,
                  apiKey="fixture-personal-value", connectionStatus="untested",
                  lastTestCode=None, lastTestedAt=None)
    config.update(overrides or {})
    store = InMemoryPersonalAiStore({("company-f13", "user-f13"): config})
    company = InMemoryCompanyLlmStore({
        "company-f13": dict(provider="upstage", enabled=True, model="solar-pro4",
                            apiKeyConfigured=True, apiKey="fixture-admin-value",
                            apiBaseUrl="https://api.upstage.ai/v1", timeoutSeconds=15)
    } if admin else {})
    client = FixturePersonalAiProviderClient()
    return PersonalAiService(store=store, company_llm_store=company, provider_client=client), store, client


@pytest.mark.parametrize("invalid", [
    {"apiKeyConfigured": False, "apiKey": ""},
    {"model": ""},
    {"model": "   "},
    {"model": "csk-" + "fixture-not-a-real-key"},
    {"provider": "unsupported"},
])
def test_incomplete_personal_uses_admin_for_view_and_chat_without_rewriting_data(invalid):
    service, store, client = make_service(invalid)
    before = deepcopy(store.configs)
    view = service.get_config(personal_ai_actor())
    assert (view.configSource, view.provider, view.model) == ("admin_default", "upstage", "solar-pro4")
    assert view.connectionStatus == "ready"
    result = service.chat(personal_ai_actor(), PersonalAiChatRequest(messages=[{"role": "user", "content": "질문"}]))
    assert result.provider == "upstage"
    assert client.chat_configs[-1]["apiKey"] == "fixture-admin-value"
    assert "fixture-admin-value" not in view.model_dump_json()
    assert store.configs == before


@pytest.mark.parametrize("state", ["untested", "ready", "error"])
def test_complete_personal_keeps_priority_and_existing_connection_gate(state):
    service, _, _ = make_service({
        "connectionStatus": state,
    })
    view = service.get_config(personal_ai_actor())
    assert view.configSource == "personal"
    assert view.connectionStatus == state


def test_keyless_provider_is_still_valid_personal_configuration():
    service, _, _ = make_service({
        "provider": "ollama", "apiKeyConfigured": False, "apiKey": "",
    })
    assert service.get_config(personal_ai_actor()).configSource == "personal"


def test_no_valid_admin_returns_empty_safe_view_not_legacy_key_shaped_model():
    service, _, _ = make_service({"model": "csk-" + "fixture-not-a-real-key"}, admin=False)
    view = service.get_config(personal_ai_actor())
    assert view.configSource == "unconfigured"
    assert view.model == ""
    assert view.provider == ""


@pytest.mark.parametrize("prefix", ["csk-", "sk-", "gsk_", "AIza", "Bearer "])
def test_key_shaped_model_is_rejected_without_save_or_echo(prefix):
    service, store, _ = make_service()
    before = deepcopy(store.configs)
    value = prefix + "fixture-not-a-real-key"
    payload = PersonalAiConfigUpdate(provider="cerebras", model=value)
    with pytest.raises(HTTPException) as error:
        service.update_config(personal_ai_actor(), payload)
    assert error.value.status_code == 422
    assert value not in str(error.value.detail)
    assert store.configs == before


def test_clearing_personal_key_returns_effective_admin_config():
    service, _, _ = make_service()
    result = service.update_config(personal_ai_actor(), PersonalAiConfigUpdate(
        provider="cerebras", model="model-a", clearApiKey=True,
    ))
    assert result.configSource == "admin_default"


def test_existing_bad_personal_config_http_response_uses_default_and_never_echoes_model():
    bad_model = "csk-" + "fixture-not-a-real-key"
    service, _, _ = make_service({"model": bad_model, "apiKeyConfigured": False, "apiKey": ""})
    app = FastAPI()
    app.include_router(personal_ai.router, prefix="/workspace/personal-ai")
    app.dependency_overrides[get_current_user] = personal_ai_actor
    with patch.object(personal_ai, "_service", return_value=service):
        with TestClient(app) as client:
            response = client.get("/workspace/personal-ai/config")
    assert response.status_code == 200
    assert response.json()["configSource"] == "admin_default"
    assert response.json()["model"] == "solar-pro4"
    assert bad_model not in response.text
