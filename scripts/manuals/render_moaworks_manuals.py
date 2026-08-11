from __future__ import annotations

import importlib.util
import os
from pathlib import Path

OFFICIAL_RENDERER = Path(
    os.environ.get(
        "MOAWORKS_OFFICIAL_DOCX_RENDERER",
        r"C:\Users\cyhuh\.codex\plugins\cache\openai-primary-runtime\documents\26.805.11740\skills\documents\render_docx.py",
    )
)
SOFFICE_CONSOLE = Path(
    os.environ.get(
        "MOAWORKS_SOFFICE_CONSOLE",
        r"C:\Program Files\LibreOffice\program\soffice.com",
    )
)
POPPLER_BIN = Path(
    os.environ.get(
        "MOAWORKS_POPPLER_BIN",
        r"C:\Users\cyhuh\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\poppler\Library\bin",
    )
)


def load_renderer():
    if not OFFICIAL_RENDERER.exists():
        raise FileNotFoundError(f"official renderer not found: {OFFICIAL_RENDERER}")
    if not SOFFICE_CONSOLE.exists():
        raise FileNotFoundError(f"LibreOffice console executable not found: {SOFFICE_CONSOLE}")
    if not POPPLER_BIN.exists():
        raise FileNotFoundError(f"Poppler bin directory not found: {POPPLER_BIN}")
    spec = importlib.util.spec_from_file_location(
        "moaworks_official_render_docx", OFFICIAL_RENDERER
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load renderer: {OFFICIAL_RENDERER}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    os.environ["PATH"] = str(POPPLER_BIN) + os.pathsep + os.environ.get("PATH", "")
    renderer = load_renderer()
    original_run_cmd = renderer._run_cmd

    def run_cmd(cmd, *args, **kwargs):
        adjusted = list(cmd)
        if adjusted and adjusted[0] == "soffice":
            adjusted[0] = str(SOFFICE_CONSOLE)
        for index, value in enumerate(adjusted):
            prefix = "-env:UserInstallation=file://"
            if value.startswith(prefix):
                raw_path = value[len(prefix):]
                adjusted[index] = "-env:UserInstallation=" + Path(raw_path).as_uri()
        return original_run_cmd(adjusted, *args, **kwargs)

    renderer._run_cmd = run_cmd
    renderer.main()


if __name__ == "__main__":
    main()
