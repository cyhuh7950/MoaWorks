from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.services.admin_mfa_break_glass_service import AdminMfaBreakGlassService


def _json(path: Path) -> dict[str, object]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("JSON artifact는 object여야 합니다.")
    return value


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="MoaWorks 관리자 MFA 2인 복구")
    commands = parser.add_subparsers(dest="command", required=True)
    request = commands.add_parser("request")
    request.add_argument("--target-user-id", required=True)
    request.add_argument("--reason-file", required=True, type=Path)
    request.add_argument("--correlation-id", required=True)
    request.add_argument("--expires-in-minutes", type=int, default=15)
    request.add_argument("--out", required=True, type=Path)
    sign = commands.add_parser("sign")
    sign.add_argument("--request", required=True, type=Path)
    sign.add_argument("--approver-id", required=True)
    sign.add_argument("--key-version", required=True, type=int)
    sign.add_argument("--private-key-file", required=True, type=Path)
    sign.add_argument("--out", required=True, type=Path)
    approve = commands.add_parser("approve")
    approve.add_argument("--request-id", required=True)
    approve.add_argument("--approval-file", required=True, type=Path)
    execute = commands.add_parser("execute")
    execute.add_argument("--request-id", required=True)
    execute.add_argument("--challenge-output", required=True, type=Path)
    cancel = commands.add_parser("cancel")
    cancel.add_argument("--request-id", required=True)
    cancel.add_argument("--reason-file", required=True, type=Path)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "sign":
        request = _json(args.request)
        approval = AdminMfaBreakGlassService.sign_request(
            request, approver_id=args.approver_id, key_version=args.key_version,
            private_key=AdminMfaBreakGlassService.load_private_key(args.private_key_file),
        )
        AdminMfaBreakGlassService.write_new_json(args.out, approval)
        print(json.dumps({"status": "signed", "requestId": request["requestId"], "output": str(args.out)}))
        return 0
    service = AdminMfaBreakGlassService.from_settings()
    if args.command == "request":
        artifact = service.create_request(
            target_user_id=args.target_user_id,
            reason=args.reason_file.read_text(encoding="utf-8"),
            correlation_id=args.correlation_id,
            expires_in_minutes=args.expires_in_minutes,
        )
        AdminMfaBreakGlassService.write_new_json(args.out, artifact)
        print(json.dumps({"status": "pending", "requestId": artifact["requestId"], "output": str(args.out)}))
    elif args.command == "approve":
        service.approve(args.request_id, _json(args.approval_file))
        print(json.dumps({"status": "approved", "requestId": args.request_id}))
    elif args.command == "execute":
        result = service.execute(args.request_id, challenge_output=args.challenge_output)
        print(json.dumps({"status": "consumed", "requestId": result.request_id, "output": str(result.challenge_output)}))
    elif args.command == "cancel":
        service.cancel(args.request_id, reason=args.reason_file.read_text(encoding="utf-8"))
        print(json.dumps({"status": "cancelled", "requestId": args.request_id}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
