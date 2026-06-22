from __future__ import annotations

import hashlib
import json
import shutil
import tarfile
import tempfile
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STORAGE_ROOT = ROOT / "data" / "storage"
RUNTIME_ROOT = ROOT / "data" / "runtime"
OUTPUT_ROOT = ROOT / "docs" / "phase-6"


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def walk_hashes(root: Path) -> dict[str, str]:
    if not root.exists():
        return {}
    result: dict[str, str] = {}
    for path in sorted(root.rglob("*")):
        if path.is_file():
            result[str(path.relative_to(root)).replace("\\", "/")] = file_hash(path)
    return result


def main() -> int:
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
    RUNTIME_ROOT.mkdir(parents=True, exist_ok=True)

    timestamp = time.strftime("%Y-%m-%dT%H-%M-%SZ", time.gmtime())
    archive_path = OUTPUT_ROOT / f"stage6-storage-backup-{timestamp}.tar.gz"
    report_path = OUTPUT_ROOT / f"stage6-storage-restore-report-{timestamp}.json"

    original_storage = walk_hashes(STORAGE_ROOT)
    original_runtime = walk_hashes(RUNTIME_ROOT)

    with tarfile.open(archive_path, "w:gz") as tar:
        tar.add(STORAGE_ROOT, arcname="storage")
        tar.add(RUNTIME_ROOT, arcname="runtime")

    with tempfile.TemporaryDirectory(prefix="stage6-storage-restore-") as temp_dir_raw:
        temp_dir = Path(temp_dir_raw)
        with tarfile.open(archive_path, "r:gz") as tar:
            tar.extractall(temp_dir)
        restored_storage = walk_hashes(temp_dir / "storage")
        restored_runtime = walk_hashes(temp_dir / "runtime")

    report = {
        "executedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "archivePath": str(archive_path.relative_to(ROOT)).replace("\\", "/"),
        "storageFileCount": len(original_storage),
        "runtimeFileCount": len(original_runtime),
        "storageMatches": original_storage == restored_storage,
        "runtimeMatches": original_runtime == restored_runtime,
        "storageFiles": sorted(original_storage.keys()),
        "runtimeFiles": sorted(original_runtime.keys()),
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
