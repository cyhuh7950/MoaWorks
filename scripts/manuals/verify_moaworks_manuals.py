from __future__ import annotations

import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]
MANUAL_DIR = ROOT / "docs" / "manuals"
OUTPUT_DIR = MANUAL_DIR / "output"
QA_DIR = MANUAL_DIR / "qa"
A11Y_DIR = QA_DIR / "a11y"
SOURCES = {
    "end_user": MANUAL_DIR / "moaworks-end-user-manual-v2.0.md",
    "admin_operator": MANUAL_DIR / "moaworks-admin-operator-manual-v2.0.md",
    "install_deploy": MANUAL_DIR / "moaworks-install-deploy-manual-v2.0.md",
    "incident_recovery": MANUAL_DIR / "moaworks-incident-backup-recovery-manual-v2.0.md",
}
REQUIRED = {
    "end_user": ["로그인", "메일", "전자결재", "메신저", "일정", "주소록", "파일", "Android", "문제 해결"],
    "admin_operator": ["사용자 계정", "조직", "권한", "메일 운영", "LLM", "감사 로그", "변경 관리"],
    "install_deploy": ["Cloudflare", "MX", "SPF", "DKIM", "DMARC", "Docker", "PostgreSQL", "same-origin", "OCI Email Delivery", "자체 메일 엔진", "iOS"],
    "incident_recovery": ["심각도", "증적", "데이터베이스", "메일 장애", "백업", "복원", "롤백", "재해 복구"],
}
MIN_IMAGES = {"end_user": 20, "admin_operator": 2, "install_deploy": 7, "incident_recovery": 1}
BANNED = [
    re.compile(r"127\.0\.0\.1"),
    re.compile(r"localhost", re.IGNORECASE),
    re.compile(r"BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY"),
    re.compile(r"ocid1\.(?:instance|tenancy|user|dynamicgroup)\.[a-z0-9.-]{30,}", re.IGNORECASE),
    re.compile(r"(?:api[_ -]?key|password|비밀번호)\s*[:=]\s*[^<\s][^\s]{8,}", re.IGNORECASE),
]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def image_links(text: str) -> list[str]:
    return re.findall(r"!\[[^\]]+\]\(([^)]+)\)", text)


def docx_media_count(path: Path) -> int:
    with ZipFile(path) as archive:
        return sum(name.startswith("word/media/") for name in archive.namelist())


def verify() -> dict:
    checks = []
    artifacts = []
    failures = []

    for key, source in SOURCES.items():
        if not source.exists():
            failures.append(f"missing source: {source}")
            continue
        text = source.read_text(encoding="utf-8")
        missing_terms = [term for term in REQUIRED[key] if term not in text]
        links = image_links(text)
        missing_images = [ref for ref in links if not (source.parent / ref).exists()]
        banned_hits = [pattern.pattern for pattern in BANNED if pattern.search(text)]
        a11y_report = A11Y_DIR / f"{source.stem}.json"
        a11y_counts = None
        if not a11y_report.exists():
            failures.append(f"{key}: accessibility report missing")
        else:
            a11y_counts = json.loads(a11y_report.read_text(encoding="utf-8")).get("counts", {})
            if any(a11y_counts.get(level, 0) for level in ("high", "medium", "low")):
                failures.append(f"{key}: accessibility findings {a11y_counts}")


        checks.append({
            "manual": key,
            "source": str(source.relative_to(ROOT)),
            "required_terms_missing": missing_terms,
            "image_count": len(links),
            "minimum_images": MIN_IMAGES[key],
            "missing_images": missing_images,
            "banned_pattern_hits": banned_hits,
            "heading_count": len(re.findall(r"^#{1,3}\s+", text, re.MULTILINE)),
            "accessibility": a11y_counts,
        })
        if missing_terms:
            failures.append(f"{key}: missing required terms {missing_terms}")
        if len(links) < MIN_IMAGES[key]:
            failures.append(f"{key}: only {len(links)} images, require {MIN_IMAGES[key]}")
        if missing_images:
            failures.append(f"{key}: missing images {missing_images}")
        if banned_hits:
            failures.append(f"{key}: banned patterns {banned_hits}")

        docx = OUTPUT_DIR / source.with_suffix(".docx").name
        pdf = OUTPUT_DIR / source.with_suffix(".pdf").name
        for artifact in (docx, pdf):
            if not artifact.exists() or artifact.stat().st_size == 0:
                failures.append(f"missing output: {artifact}")
                continue
            record = {
                "path": str(artifact.relative_to(ROOT)),
                "bytes": artifact.stat().st_size,
                "sha256": sha256(artifact),
            }
            if artifact.suffix == ".docx":
                record["embedded_media"] = docx_media_count(artifact)
                if record["embedded_media"] < MIN_IMAGES[key]:
                    failures.append(
                        f"{key}: docx has {record['embedded_media']} media, require {MIN_IMAGES[key]}"
                    )
            artifacts.append(record)

    manifest = MANUAL_DIR / "assets" / "asset-manifest.json"
    if not manifest.exists():
        failures.append("asset manifest missing")
    else:
        data = json.loads(manifest.read_text(encoding="utf-8"))
        if data.get("assetCount") != len(data.get("assets", [])):
            failures.append("asset manifest count mismatch")
        for asset in data.get("assets", []):
            path = MANUAL_DIR / "assets" / asset["file"]
            if not path.exists():
                failures.append(f"manifest asset missing: {asset['file']}")
            elif sha256(path) != asset["sha256"]:
                failures.append(f"manifest hash mismatch: {asset['file']}")

    result = {
        "schemaVersion": 1,
        "verifiedAt": datetime.now(timezone.utc).isoformat(),
        "status": "PASS" if not failures else "FAIL",
        "checks": checks,
        "artifacts": artifacts,
        "failures": failures,
        "deferred": [
            "iOS macOS/Xcode, Apple signing, and iPhone native device verification"
        ],
    }
    QA_DIR.mkdir(parents=True, exist_ok=True)
    (QA_DIR / "verification.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return result


def main() -> None:
    result = verify()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if result["status"] != "PASS":
        sys.exit(1)


if __name__ == "__main__":
    main()
