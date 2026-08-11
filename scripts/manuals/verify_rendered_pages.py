from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
QA_DIR = ROOT / "docs" / "manuals" / "qa"
RENDER_DIR = QA_DIR / "rendered-release"
EXPECTED = {
    "moaworks-admin-operator-manual-v2.0": 9,
    "moaworks-end-user-manual-v2.0": 25,
    "moaworks-incident-backup-recovery-manual-v2.0": 10,
    "moaworks-install-deploy-manual-v2.0": 13,
}
MIN_DARK_RATIO = 0.007


def dark_ratio(path: Path) -> float:
    with Image.open(path) as image:
        gray = image.convert("L")
        histogram = gray.histogram()
        dark = sum(histogram[:245])
        return dark / (image.width * image.height)


def verify() -> dict:
    failures: list[str] = []
    manuals = []
    total_pages = 0
    for name, expected_pages in EXPECTED.items():
        directory = RENDER_DIR / name
        pages = sorted(directory.glob("page-*.png")) if directory.exists() else []
        ratios = [dark_ratio(page) for page in pages]
        total_pages += len(pages)
        if len(pages) != expected_pages:
            failures.append(f"{name}: {len(pages)} pages, expected {expected_pages}")
        sparse = [pages[index].name for index, ratio in enumerate(ratios) if ratio < MIN_DARK_RATIO]
        if sparse:
            failures.append(f"{name}: possible blank pages {sparse}")
        manuals.append({
            "manual": name,
            "pageCount": len(pages),
            "expectedPageCount": expected_pages,
            "minimumDarkRatio": min(ratios) if ratios else None,
            "possibleBlankPages": sparse,
        })
    result = {
        "schemaVersion": 1,
        "verifiedAt": datetime.now(timezone.utc).isoformat(),
        "status": "PASS" if not failures else "FAIL",
        "totalPages": total_pages,
        "threshold": MIN_DARK_RATIO,
        "manuals": manuals,
        "failures": failures,
    }
    (QA_DIR / "render-verification.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return result


if __name__ == "__main__":
    outcome = verify()
    print(json.dumps(outcome, ensure_ascii=False, indent=2))
    if outcome["status"] != "PASS":
        sys.exit(1)
