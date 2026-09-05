"""합성 경로에 대한 제한 패턴 계약. 실제 Docker context/build 증거는 아니다."""
from fnmatch import fnmatchcase
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


def excluded(path):
    # 이번 ignore에서 쓰는 root/recursive glob과 마지막 negation만 평가한다.
    # 실제 파일 목록이나 Secret은 읽지 않는다.
    prefixes = ["/".join(path.split("/")[:n]) for n in range(1, len(path.split("/")) + 1)]
    result = False
    for line in (ROOT / ".dockerignore").read_text(encoding="utf-8").splitlines():
        pattern = line.strip()
        if not pattern or pattern.startswith("#"):
            continue
        allow = pattern.startswith("!")
        pattern = pattern.lstrip("!").strip("/")
        variants = [pattern, pattern[3:]] if pattern.startswith("**/") else [pattern]
        if any(fnmatchcase(prefix, variant) for prefix in prefixes for variant in variants):
            result = not allow
    return result


@pytest.mark.parametrize("path", [
    ".env", ".env.production", "backend/.env", "backend/nested/.env.local",
    "frontend/admin-web/.env.production", ".smtp-submission-password",
    "nested/.smtp-submission-password", ".agents/run/result.json", ".codex/config.toml",
    ".worktrees/other/backend/app.py", "docs/work-progress/private-report.md",
    "docs/workorders/private.md", "docs/public/internal-note.md", "backend/.venv/Lib/package.py",
    "frontend/admin-web/node_modules/pkg/index.js", "frontend/user-web/dist/index.html",
    "backend/__pycache__/app.pyc", "frontend/user-web/.vite/cache.json",
    "frontend/admin-web/tsconfig.app.tsbuildinfo",
])
def test_private_or_generated_path_excluded(path):
    assert excluded(path), path


@pytest.mark.parametrize("path", [
    ".env.example", "backend/.env.example", "frontend/user-web/.env.example",
    "backend/app/main.py", "backend/requirements.txt", "backend/migrations/072_mail_delivery_claim_fencing.sql",
    "frontend/admin-web/package-lock.json", "frontend/user-web/src/App.tsx",
    "frontend/admin-web/public/assets/logo.svg", "deploy/mail-gateway/ca.crt",
    "deploy/mail-gateway/pgsql-sender-login.cf.template", "docs/manuals/admin-operator.md",
])
def test_required_build_source_example_and_ca_preserved(path):
    assert not excluded(path), path


@pytest.mark.parametrize("compose", ["docker-compose.yml", "docker-compose.oracle.yml", "docker-compose.wsl.yml"])
def test_mail_layer_gate_uses_worker_specific_sql_probe(compose):
    import yaml
    spec = yaml.safe_load((ROOT / "deploy" / compose).read_text(encoding="utf-8"))
    worker = spec["services"]["mail-layer"]
    assert worker["healthcheck"]["test"] == ["CMD", "python", "-m", "app.workers.mail_delivery_healthcheck"]
    assert worker["environment"]["MAIL_DELIVERY_WORKER_ID"] == "moaworks-mail-layer"
    assert worker["command"] == ["python", "-m", "app.workers.mail_delivery_worker"]
