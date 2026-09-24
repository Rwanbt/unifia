"""Integrity-checked, cancellable and atomic downloads for voice assets."""

from __future__ import annotations

import hashlib
import os
import threading
import uuid
from pathlib import Path
from typing import Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .catalog import VoiceAsset

CHUNK_BYTES = 256 * 1024
RETRY_DELAYS = (0.25, 0.75)


class DownloadCancelled(Exception):
    """Raised when a caller cancels an in-progress download."""


class AssetIntegrityError(Exception):
    """Raised when an artifact does not match its pinned manifest."""


def asset_path(root: Path, asset: VoiceAsset) -> Path:
    resolved_root = root.resolve()
    path = resolved_root / asset.filename
    if path.parent != resolved_root or path.is_symlink():
        raise ValueError("Voice asset path is not a safe managed file")
    return path


def verify_asset(path: Path, asset: VoiceAsset) -> bool:
    if not path.is_file() or path.is_symlink() or path.stat().st_size != asset.size_bytes:
        return False
    digest = hashlib.sha256()
    with path.open("rb") as asset_file:
        for chunk in iter(lambda: asset_file.read(CHUNK_BYTES), b""):
            digest.update(chunk)
    return digest.hexdigest() == asset.sha256


def _download_once(
    asset: VoiceAsset,
    partial: Path,
    cancel: threading.Event,
    progress: Callable[[int, int], None],
) -> None:
    request = Request(asset.url, headers={"User-Agent": "Unifia-Piper-Host/1.0"})
    digest = hashlib.sha256()
    downloaded = 0
    with urlopen(request, timeout=15) as response, partial.open("xb") as output:
        final_url = response.geturl()
        host = final_url.split("/", 3)[2].lower()
        allowed_hosts = ("huggingface.co", "hf.co", "xethub.hf.co")
        if not final_url.startswith("https://") or not any(
            host == domain or host.endswith(f".{domain}") for domain in allowed_hosts
        ):
            raise ValueError("Voice asset download redirected outside Hugging Face")
        while True:
            if cancel.is_set():
                raise DownloadCancelled("Piper asset download was cancelled")
            chunk = response.read(CHUNK_BYTES)
            if not chunk:
                break
            downloaded += len(chunk)
            if downloaded > asset.size_bytes:
                raise AssetIntegrityError("Voice asset exceeded its pinned size")
            digest.update(chunk)
            output.write(chunk)
            progress(downloaded, asset.size_bytes)
        output.flush()
        os.fsync(output.fileno())
    if cancel.is_set():
        raise DownloadCancelled("Piper asset download was cancelled")
    if downloaded != asset.size_bytes or digest.hexdigest() != asset.sha256:
        raise AssetIntegrityError("Piper voice asset SHA-256 verification failed")


def download_asset(
    root: Path,
    asset: VoiceAsset,
    cancel: threading.Event,
    progress: Callable[[int, int], None],
) -> Path:
    destination = asset_path(root, asset)
    if verify_asset(destination, asset):
        return destination
    destination.parent.mkdir(parents=True, exist_ok=True)

    for delay in (*RETRY_DELAYS, None):
        partial = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.part")
        try:
            _download_once(asset, partial, cancel, progress)
            os.replace(partial, destination)
            return destination
        except AssetIntegrityError:
            raise
        except DownloadCancelled:
            raise
        except (HTTPError, URLError, TimeoutError, OSError):
            if delay is None or cancel.is_set():
                raise
            cancel.wait(delay)
        finally:
            partial.unlink(missing_ok=True)
    raise RuntimeError(f"Could not download {asset.filename} after {len(RETRY_DELAYS) + 1} attempts")
