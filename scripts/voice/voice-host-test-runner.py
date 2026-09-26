#!/usr/bin/env python3
"""Voice-host test runner — cold-managed provisioning for voice-host pytest.

The voice-host test suite needs a managed Python 3.12 environment with
the locked dependencies (pocket-tts==3.1.0, livekit-agents==1.8.3,
onnx-asr==0.12.0, onnxruntime==1.30.0, torch==2.14.0 CPU). Running the
system Python 3.13 produces ImportError on `pocket_tts.models.model_state`
and on `voice_host.worker` (no editable install). This script is the
documented reproduction path for the cold-managed run; the v2 RFC
Phase 0 §"Voice-host test suite" requires it.

The script is intentionally non-mutating when the venv already exists;
it uses the cold-managed uv workflow with the exact uv.lock in
`packages/voice-host/`. The previous Voice baseline
(`voice-runtime-baseline.md`) gates this with `gate-d-cold-04`-style
isolation.

Usage:
    python scripts/voice/voice-host-test-runner.py [--full] [--collect-only]

Exit codes:
    0   success
    2   pytest collection reported errors
    3   uv sync failed
    4   python -c "pocket_tts/voice_host imports" failed
    5   system Python does not have uv on PATH

Output:
    Streams pytest output, then a summary block.
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
PACKAGE = REPO_ROOT / "packages" / "voice-host"
PYPROJECT = PACKAGE / "pyproject.toml"
UV_LOCK = PACKAGE / "uv.lock"
VENV = PACKAGE / ".venv"

# Locked versions — keep in sync with pyproject.toml.
REQUIRED_PYTHON = "3.12"
PYTEST_VERSION = "9.1.1"  # from prior collected runs


def fail(msg: str, code: int) -> int:
    print(f"[voice-host-test-runner] {msg}", file=sys.stderr)
    return code


def run(cmd: list[str], cwd: Path, env: dict | None = None) -> subprocess.CompletedProcess:
    printable = " ".join(cmd)
    print(f"[voice-host-test-runner] $ {printable}  (cwd={cwd})", file=sys.stderr)
    return subprocess.run(cmd, cwd=cwd, env=env, check=False, capture_output=True, text=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="voice-host pytest runner")
    parser.add_argument("--full", action="store_true", help="Run every test (default: collect-only)")
    parser.add_argument("--collect-only", action="store_true", help="Just collect")
    args = parser.parse_args()

    if shutil.which("uv") is None:
        return fail("uv is not on PATH; install https://docs.astral.sh/uv/", 5)

    if not PYPROJECT.exists():
        return fail(f"missing pyproject.toml at {PYPROJECT}", 2)
    if not UV_LOCK.exists():
        return fail(f"missing uv.lock at {UV_LOCK}", 2)

    # Cold-managed Python 3.12 venv (managed-only preference is in pyproject).
    print("[voice-host-test-runner] syncing managed Python 3.12 venv...", file=sys.stderr)
    sync = run(["uv", "sync", "--frozen", "--python", REQUIRED_PYTHON], cwd=PACKAGE)
    if sync.returncode != 0:
        sys.stderr.write(sync.stdout)
        sys.stderr.write(sync.stderr)
        return fail("uv sync failed", 3)

    # Install pytest into the venv (it is not in pyproject dev deps).
    python_path = VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    pip_install = run(
        ["uv", "pip", "install", "--python", str(python_path),
         f"pytest=={PYTEST_VERSION}", "pytest-asyncio"],
        cwd=PACKAGE,
    )
    if pip_install.returncode != 0:
        sys.stderr.write(pip_install.stdout)
        sys.stderr.write(pip_install.stderr)
        return fail("pytest install failed", 3)

    # Smoke-import the modules the legacy run was failing on. The
    # legacy test collection errored on `voice_host.worker` because the
    # package is not on sys.path when pytest is launched without a
    # PYTHONPATH; we add the package root so the smoke and the
    # collection both succeed.
    env = os.environ.copy()
    env["PYTHONPATH"] = str(PACKAGE) + os.pathsep + env.get("PYTHONPATH", "")
    smoke = run(
        ["uv", "run", "--no-sync", "python", "-c",
         "import pocket_tts.models.model_state; import voice_host.worker; print('ok')"],
        cwd=PACKAGE,
        env=env,
    )
    if smoke.returncode != 0:
        sys.stderr.write(smoke.stdout)
        sys.stderr.write(smoke.stderr)
        return fail("smoke import failed", 4)

    # Build the pytest command (PYTHONPATH carries the package root).
    pytest_cmd: list[str] = ["uv", "run", "--no-sync", "pytest", "tests"]
    if args.collect_only or not args.full:
        pytest_cmd.append("--collect-only")
    pytest_cmd.extend(["-q", "--rootdir", str(PACKAGE), "--import-mode=importlib"])

    print("[voice-host-test-runner] running pytest...", file=sys.stderr)
    proc = subprocess.run(pytest_cmd, cwd=PACKAGE, env=env, check=False)
    return proc.returncode


if __name__ == "__main__":
    sys.exit(main())
