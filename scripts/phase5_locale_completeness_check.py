#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Dict, List


ROOT = Path(__file__).resolve().parents[1]
TARGETS = {
    "admin-web": ROOT / "frontend" / "admin-web" / "src" / "i18n.ts",
    "user-web": ROOT / "frontend" / "user-web" / "src" / "i18n.ts",
    "mobile-app": ROOT / "frontend" / "mobile-app" / "App.tsx",
}


def load_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def extract_supported_locales(text: str) -> List[str]:
    match = re.search(r"supportedLocales[^=]*=\s*\[([^\]]*)\]", text, re.S)
    if not match:
        return []
    body = match.group(1)
    return re.findall(r'"([a-zA-Z0-9-]+)"', body)


def find_object_block(text: str, object_name: str) -> str:
    marker = f"const {object_name}"
    idx = text.find(marker)
    if idx < 0:
        return ""

    brace_start = text.find("{", idx)
    if brace_start < 0:
        return ""

    depth = 0
    in_string: str | None = None
    escape = False
    end = -1
    for i in range(brace_start, len(text)):
        char = text[i]
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == in_string:
                in_string = None
            continue
        if char in ("'", '"', "`"):
            in_string = char
            continue
        if char == "{":
            depth += 1
            continue
        if char == "}":
            depth -= 1
            if depth == 0:
                end = i
                break
            continue
    if end < 0:
        return ""
    return text[brace_start : end + 1]


def extract_locale_blocks(locale_object: str, locales: List[str]) -> Dict[str, str]:
    blocks: Dict[str, str] = {}
    for locale in locales:
        marker = f'"{locale}"'
        start = locale_object.find(marker)
        if start < 0:
            continue
        brace_start = locale_object.find("{", start)
        if brace_start < 0:
            continue
        depth = 0
        in_string: str | None = None
        escape = False
        end = -1
        for i in range(brace_start, len(locale_object)):
            char = locale_object[i]
            if in_string:
                if escape:
                    escape = False
                elif char == "\\":
                    escape = True
                elif char == in_string:
                    in_string = None
                continue
            if char in ("'", '"', "`"):
                in_string = char
                continue
            if char == "{":
                depth += 1
                continue
            if char == "}":
                depth -= 1
                if depth == 0:
                    end = i
                    break
                continue
        if end > brace_start:
            blocks[locale] = locale_object[brace_start : end + 1]
    return blocks


def extract_keys_and_types(block_text: str) -> Dict[str, str]:
    entries = {}
    for raw_line in block_text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("}"):
            continue
        match = re.match(r'(?:"|\')?([A-Za-z0-9_]+)(?:"|\')?\s*:\s*(.+?),?\s*$', line)
        if not match:
            continue
        key = match.group(1)
        value_expr = match.group(2).strip()
        if value_expr.startswith('"') or value_expr.startswith("'") or value_expr.startswith("`"):
            value_type = "string"
        elif value_expr in ("true", "false"):
            value_type = "boolean"
        elif re.match(r"^-?\d+(\.\d+)?$", value_expr):
            value_type = "number"
        elif value_expr == "[]":
            value_type = "array"
        elif value_expr == "{}":
            value_type = "object"
        else:
            value_type = "expression"
        entries[key] = value_type
    return entries


def evaluate_file(name: str, path: Path) -> Dict[str, object]:
    if not path.exists():
        raise FileNotFoundError(path)

    text = load_text(path)
    locales = extract_supported_locales(text)
    if not locales:
        raise ValueError(f"{path} does not define supportedLocales")

    object_name = "localeDictionary" if name == "mobile-app" else "dictionary"
    object_block = find_object_block(text, object_name)
    if not object_block:
        raise ValueError(f"{path} does not expose expected {object_name}")

    locale_blocks = extract_locale_blocks(object_block, locales)
    missing_locale: List[str] = [locale for locale in locales if locale not in locale_blocks]
    if missing_locale:
        raise ValueError(f"{path} missing locale block(s): {', '.join(missing_locale)}")

    locale_data: Dict[str, Dict[str, str]] = {
        locale: extract_keys_and_types(block) for locale, block in locale_blocks.items()
    }
    baseline_keys = set(locale_data[locales[0]].keys())
    baseline_locale = locales[0]

    locale_reports = []
    total_missing = 0
    total_extra = 0
    total_type_mismatch = 0

    for locale in locales:
        keys = set(locale_data[locale].keys())
        missing = sorted(baseline_keys - keys)
        extra = sorted(keys - baseline_keys)
        type_mismatch = []
        for key in sorted(baseline_keys & keys):
            if locale_data[locale][key] != locale_data[baseline_locale][key]:
                type_mismatch.append({"key": key, "expected": locale_data[baseline_locale][key], "actual": locale_data[locale][key]})
        if missing:
            total_missing += len(missing)
        if extra:
            total_extra += len(extra)
        if type_mismatch:
            total_type_mismatch += len(type_mismatch)
        locale_reports.append(
            {
                "locale": locale,
                "key_count": len(keys),
                "missing_keys": missing,
                "extra_keys": extra,
                "type_mismatch": type_mismatch,
            }
        )

    return {
        "path": str(path),
        "locales": locales,
        "locale_count": len(locales),
        "baseline_locale": baseline_locale,
        "key_total": len(baseline_keys),
        "missing_count": total_missing,
        "extra_count": total_extra,
        "type_mismatch_count": total_type_mismatch,
        "locales_detail": locale_reports,
        "pass": total_missing == 0 and total_extra == 0 and total_type_mismatch == 0,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Check locale completeness for phase-5")
    parser.add_argument(
        "--output",
        default=str(ROOT / "docs/phase-5/phase5-locale-completeness-report.json"),
        help="output report path",
    )
    args = parser.parse_args()

    summary = {"phase": 5, "status": "pass", "targets": []}

    all_failures = False
    for name, path in TARGETS.items():
        try:
            summary["targets"].append({"name": name, **evaluate_file(name, path)})
        except Exception as exc:  # noqa: BLE001
            all_failures = True
            summary["targets"].append({"name": name, "pass": False, "error": str(exc)})

    summary["status"] = "fail" if all_failures else "pass"
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"RESULT={summary['status'].upper()}")
    print(f"REPORT={output_path}")

    if all_failures:
        print("STATUS: FAIL (locale completeness)")
        return 1

    print("STATUS: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
