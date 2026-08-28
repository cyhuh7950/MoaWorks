"""불완전한 개인 설정은 관리자 기본 LLM을 가리지 않는다."""
from copy import deepcopy
from unittest.mock import patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user
from app.api.errors import register_error_handlers
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


@pytest.mark.parametrize("value", [
    "csk-" + "fixture-not-a-real-key",
    "sk-" + "fixture-not-a-real-key",
    "gsk_" + "fixture-not-a-real-key",
    "AIza" + "fixture-not-a-real-key",
    "Bearer " + "fixture-not-a-real-key",
    "Q7vN2mK9xR4pL8sT6wY3cD5fH1jB0uE9aC2g",
])
def test_key_shaped_model_is_rejected_without_save_or_echo(value):
    service, store, _ = make_service()
    before = deepcopy(store.configs)
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


# 실제 자격증명이 아닌 격리 시험값. pytest ID에는 값 대신 형태만 표시한다.
OPAQUE_MODEL_CASES = [
    pytest.param("fixture" + "a1" * 24, id="lowercase-digits"),
    pytest.param("fixture_not_real_" + "a1-" * 12, id="underscore-hyphen"),
    pytest.param("abc123" * 6, id="hex-like"),
    pytest.param("prefix_" + "Q7vN2mK9xR4pL8sT6wY3cD5fH1jB0uE9", id="prefixed-mixed"),
    pytest.param("org/" + "abc123" * 6, id="namespaced-token"),
]

VALID_MODEL_CASES = [
    "solar-pro4",
    "gpt-4o-mini",
    "claude-3-5-sonnet-20241022",
    "Meta-Llama-3-1-405B-Instruct-Turbo",
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "mistralai/Mistral-Small-3.2-24B-Instruct-2506",
    "nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4",
    "organization/custom_business_assistant_model_v12",
    "qwen2.5:32b-instruct-q4_K_M",
]


@pytest.fixture
def config_client():
    """실제 route/오류 handler와 메모리 저장소만 연결한다."""
    service, store, provider = make_service()
    app = FastAPI()
    register_error_handlers(app)
    app.include_router(personal_ai.router, prefix="/api/v1/workspace/personal-ai")
    app.dependency_overrides[get_current_user] = personal_ai_actor
    with patch.object(personal_ai, "_service", return_value=service):
        with TestClient(app) as client:
            yield client, service, store, provider


@pytest.mark.parametrize("model", OPAQUE_MODEL_CASES)
def test_opaque_model_http_update_rejected_without_echo_or_write(config_client, model):
    client, _, store, _ = config_client
    before = deepcopy(store.configs)
    response = client.put(
        "/api/v1/workspace/personal-ai/config",
        json={"provider": "cerebras", "model": model},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "PERSONAL_AI_MODEL_INVALID"
    assert model not in response.text
    assert store.configs == before


@pytest.mark.parametrize("model", OPAQUE_MODEL_CASES)
@pytest.mark.parametrize("source", ["personal", "admin_default"])
def test_legacy_opaque_model_never_reaches_public_routes_or_provider(config_client, model, source):
    client, service, store, provider = config_client
    personal = store.configs[("company-f13", "user-f13")]
    if source == "personal":
        personal["model"] = model
        expected_source = "admin_default"
    else:
        personal.update(apiKeyConfigured=False, apiKey="")
        service.company_llm_store.policies["company-f13"]["model"] = model
        expected_source = "unconfigured"
    before = deepcopy(store.configs)
    for method, path, kwargs in [
        ("get", "config", {}),
        ("post", "test", {}),
        ("post", "chat", {"json": {"messages": [{"role": "user", "content": "시험"}]}}),
    ]:
        response = getattr(client, method)(f"/api/v1/workspace/personal-ai/{path}", **kwargs)
        assert model not in response.text
        if path == "config":
            assert response.json()["configSource"] == expected_source
        else:
            assert response.status_code == (200 if source == "personal" else 400)
    requests = provider.connection_configs + provider.chat_configs
    assert all(config["model"] != model for config in requests)
    if source == "admin_default":
        assert requests == []
    assert store.configs == before


@pytest.mark.parametrize("model", VALID_MODEL_CASES)
def test_normal_model_ids_keep_save_read_and_chat_behavior(config_client, model):
    client, service, _, provider = config_client
    response = client.put(
        "/api/v1/workspace/personal-ai/config",
        json={"provider": "cerebras", "model": model},
    )
    assert response.status_code == 200
    assert response.json()["model"] == model
    assert response.json()["configSource"] == "personal"
    service.test_connection(personal_ai_actor())
    result = service.chat(personal_ai_actor(), PersonalAiChatRequest(
        messages=[{"role": "user", "content": "시험"}],
    ))
    assert result.model == model
    assert provider.chat_configs[-1]["model"] == model


@pytest.mark.parametrize("model", VALID_MODEL_CASES)
def test_normal_admin_model_preserves_fallback_without_personal_test(config_client, model):
    client, service, store, provider = config_client
    store.configs[("company-f13", "user-f13")].update(apiKeyConfigured=False, apiKey="")
    service.company_llm_store.policies["company-f13"]["model"] = model
    view = client.get("/api/v1/workspace/personal-ai/config")
    assert view.json()["configSource"] == "admin_default"
    assert view.json()["model"] == model
    response = client.post(
        "/api/v1/workspace/personal-ai/chat",
        json={"messages": [{"role": "user", "content": "시험"}]},
    )
    assert response.status_code == 200
    assert response.json()["model"] == model
    assert provider.connection_configs == []
    assert provider.chat_configs[-1]["model"] == model
