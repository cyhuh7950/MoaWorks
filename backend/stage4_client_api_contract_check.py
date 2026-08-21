from __future__ import annotations

from pathlib import Path
import json
import sys


ROOT = Path(__file__).resolve().parents[1]

CLIENTS = {
    "user-web": ROOT / "frontend" / "user-web" / "src" / "api.ts",
    "desktop-client": ROOT / "frontend" / "desktop-client" / "index.html",
    "mobile-app": ROOT / "frontend" / "mobile-app" / "App.tsx",
}

REQUIRED_MARKERS = [
    "/approvals",
    "submit",
    "approve",
    "reject",
    "withdraw",
    "redraft",
]


def main() -> int:
    result: dict[str, dict[str, bool]] = {}
    missing: list[str] = []

    for client_name, path in CLIENTS.items():
        text = path.read_text(encoding="utf-8")
        checks: dict[str, bool] = {}
        for marker in REQUIRED_MARKERS:
            exists = marker in text
            checks[marker] = exists
            if not exists:
                missing.append(f"{client_name}:{marker}")
        result[client_name] = checks

    payload = {"status": "PASS" if not missing else "FAIL", "result": result, "missing": missing}
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if not missing else 1


if __name__ == "__main__":
    sys.exit(main())
