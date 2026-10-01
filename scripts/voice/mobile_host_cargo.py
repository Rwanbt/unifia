#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Build the Linux mobile host against the qualified ONNX C library."""

import hashlib
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys

LIBRARY_NAME = "libonnxruntime.so.1.28.0"
LIBRARY_SHA256 = "aa4079d18f4ea7a5f3a94d80cd4bbe0f2740436626622d64d793803a20381083"
REPO_ROOT = Path(__file__).resolve().parents[2]


def verify_library(library: Path) -> None:
    with library.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != LIBRARY_SHA256:
        raise RuntimeError(f"Unqualified ONNX Runtime library: {library} ({digest})")


def prepare_runtime(source: Path, directory: Path) -> dict[str, str]:
    verify_library(source)
    directory.mkdir(parents=True, exist_ok=True)
    library = directory / LIBRARY_NAME
    # WHY: retain the verified runtime beside Cargo outputs after the Python
    # environment disappears; ort-sys may link its copied dylibs to this path.
    if library.is_symlink():
        raise RuntimeError(f"Runtime library must be a regular file: {library}")
    if not library.exists():
        with library.open("xb") as destination, source.open("rb") as origin:
            shutil.copyfileobj(origin, destination)
    verify_library(library)
    for name in ("libonnxruntime.so", "libonnxruntime.so.1"):
        alias = directory / name
        if alias.is_symlink():
            if alias.readlink() != Path(LIBRARY_NAME):
                raise RuntimeError(f"Unexpected runtime symlink: {alias}")
        elif alias.exists():
            raise RuntimeError(f"Runtime alias must be a symlink: {alias}")
        else:
            alias.symlink_to(LIBRARY_NAME)
    environment = os.environ.copy()
    environment["ORT_LIB_LOCATION"] = str(directory)
    environment["ORT_PREFER_DYNAMIC_LINK"] = "1"
    search_path = environment.get("LD_LIBRARY_PATH", "")
    environment["LD_LIBRARY_PATH"] = str(directory) + (":" + search_path if search_path else "")
    return environment


def main() -> int:
    if platform.system() != "Linux" or platform.machine() != "x86_64":
        raise RuntimeError("This pinned host runtime requires Linux x86_64")
    if len(sys.argv) < 2:
        raise RuntimeError("Pass a Cargo command, for example: test --lib")
    import onnxruntime

    if onnxruntime.__version__ != "1.28.0":
        raise RuntimeError("Install onnxruntime==1.28.0 in the host environment")
    source = Path(onnxruntime.__file__).parent / "capi" / LIBRARY_NAME
    manifest = REPO_ROOT / "packages/mobile/src-tauri/Cargo.toml"
    directory = manifest.parent / "target" / "qualified-host-ort"
    environment = prepare_runtime(source, directory)
    command = ["cargo", sys.argv[1], "--manifest-path", str(manifest), *sys.argv[2:]]
    return subprocess.run(command, env=environment, check=False).returncode


if __name__ == "__main__":
    sys.exit(main())
