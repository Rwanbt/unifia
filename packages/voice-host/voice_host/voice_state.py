"""Persistent Pocket voice conditioning states for managed user clones."""

from __future__ import annotations

import hashlib
import json
import os
import re
import uuid
import warnings
from pathlib import Path
from typing import Any

VOICE_STATE_FORMAT = 1
POCKET_VERSION = "3.1.0"
MAX_VOICE_NAME_LENGTH = 128
MAX_VOICE_SAMPLE_BYTES = 24 * 1024 * 1024
VOICE_NAME_PATTERN = re.compile(r"[A-Za-z0-9_][A-Za-z0-9._ -]{0,127}\Z")


def validate_voice_sample(root_value: str, sample_value: str, voice_name: str) -> tuple[Path, Path]:
    if (
        not VOICE_NAME_PATTERN.fullmatch(voice_name)
        or len(voice_name) > MAX_VOICE_NAME_LENGTH
        or ".." in voice_name
    ):
        raise ValueError("Invalid voice name")
    try:
        root = Path(root_value).resolve(strict=True)
        sample = Path(sample_value).resolve(strict=True)
    except OSError as error:
        raise ValueError("Managed voice root and sample must exist") from error
    if not sample.is_relative_to(root) or sample.suffix.lower() != ".wav" or not sample.is_file():
        raise ValueError("Voice clone must be a WAV file under the managed voice directory")
    if sample.stat().st_size > MAX_VOICE_SAMPLE_BYTES:
        raise ValueError("Voice clone WAV exceeds the 24 MiB limit")
    return root, sample


def prepare_voice_state(
    model: Any,
    root: Path,
    sample: Path,
    language: str,
    voice_name: str,
) -> tuple[Any, str]:
    if not getattr(model, "has_voice_cloning", False):
        raise RuntimeError("The loaded Pocket model does not support voice cloning")
    identity = _identity(model, sample, language, voice_name)
    fingerprint = hashlib.sha256(_canonical(identity)).hexdigest()
    voice_dir = _contained_directory(root, ".pocket-state-cache", voice_name)
    state_path = voice_dir / f"{language}-{fingerprint}.safetensors"
    metadata_path = voice_dir / f"{language}-{fingerprint}.json"
    cached = _read_cached_state(model, state_path, metadata_path, identity)
    if cached is not None:
        return cached, f"clone:{voice_name}:{language}:{identity['sourceSha256']}:{identity['modelRevision']}"

    state = model.get_state_for_audio_prompt(sample)
    _write_cached_state(state, state_path, metadata_path, identity)
    _remove_stale_language_states(voice_dir, language, state_path)
    return state, f"clone:{voice_name}:{language}:{identity['sourceSha256']}:{identity['modelRevision']}"


def voice_cache_directory(root: Path, voice_name: str) -> Path:
    if (
        not VOICE_NAME_PATTERN.fullmatch(voice_name)
        or len(voice_name) > MAX_VOICE_NAME_LENGTH
        or ".." in voice_name
    ):
        raise ValueError("Invalid voice name")
    return root / ".pocket-state-cache" / voice_name


def _identity(model: Any, sample: Path, language: str, voice_name: str) -> dict[str, Any]:
    config = model.config
    weights = config.weights_path if model.has_voice_cloning else config.weights_path_without_voice_cloning
    if not weights:
        raise RuntimeError("Pocket model configuration has no pinned weight identity")
    model_uri, separator, revision = weights.rpartition("@")
    if not separator or not revision:
        raise RuntimeError("Pocket model weights are missing a pinned revision")
    return {
        "voiceStateFormat": VOICE_STATE_FORMAT,
        "voiceId": voice_name,
        "sourceSha256": _file_sha256(sample),
        "language": language,
        "providerVersion": POCKET_VERSION,
        "modelIdentifier": model_uri,
        "modelRevision": revision,
    }


def _read_cached_state(
    model: Any,
    state_path: Path,
    metadata_path: Path,
    identity: dict[str, Any],
) -> Any | None:
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        state_hash = _file_sha256(state_path)
        if metadata.get("identity") != identity or metadata.get("stateSha256") != state_hash:
            return None
        return model.get_state_for_audio_prompt(state_path)
    except FileNotFoundError:
        return None
    except (OSError, ValueError, RuntimeError) as error:
        warnings.warn(f"Ignoring invalid cached Pocket voice state: {error}", RuntimeWarning)
        return None


def _write_cached_state(
    state: Any,
    state_path: Path,
    metadata_path: Path,
    identity: dict[str, Any],
) -> None:
    import pocket_tts.models.model_state as model_state

    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_temp = state_path.with_name(f".{state_path.stem}.{uuid.uuid4().hex}.tmp.safetensors")
    metadata_temp = metadata_path.with_name(f".{metadata_path.name}.{uuid.uuid4().hex}.tmp")
    try:
        model_state.export_model_state(state, state_temp)
        os.replace(state_temp, state_path)
        metadata = {"identity": identity, "stateSha256": _file_sha256(state_path)}
        metadata_temp.write_text(json.dumps(metadata, sort_keys=True), encoding="utf-8")
        os.replace(metadata_temp, metadata_path)
    finally:
        state_temp.unlink(missing_ok=True)
        metadata_temp.unlink(missing_ok=True)


def _remove_stale_language_states(directory: Path, language: str, keep: Path) -> None:
    for state_path in directory.glob(f"{language}-*.safetensors"):
        if state_path == keep:
            continue
        metadata_path = state_path.with_suffix(".json")
        state_path.unlink(missing_ok=True)
        metadata_path.unlink(missing_ok=True)


def _contained_directory(root: Path, cache_name: str, voice_name: str) -> Path:
    cache_root = root / cache_name
    if cache_root.exists() and not cache_root.resolve(strict=True).is_relative_to(root):
        raise ValueError("Voice-state cache escapes the managed voice directory")
    cache_root.mkdir(parents=True, exist_ok=True)
    resolved_cache_root = cache_root.resolve(strict=True)
    if not resolved_cache_root.is_relative_to(root):
        raise ValueError("Voice-state cache escapes the managed voice directory")
    voice_dir = cache_root / voice_name
    if voice_dir.exists() and not voice_dir.resolve(strict=True).is_relative_to(resolved_cache_root):
        raise ValueError("Voice-state entry escapes its cache directory")
    voice_dir.mkdir(parents=True, exist_ok=True)
    resolved_voice_dir = voice_dir.resolve(strict=True)
    if not resolved_voice_dir.is_relative_to(resolved_cache_root):
        raise ValueError("Voice-state entry escapes its cache directory")
    return resolved_voice_dir


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical(value: dict[str, Any]) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
