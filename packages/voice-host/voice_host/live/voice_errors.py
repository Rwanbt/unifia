"""Safe, ordered Voice error envelopes shared with the TypeScript client."""

from __future__ import annotations

import json
import logging
import time
from typing import Any

VOICE_ERROR_TOPIC = "unifia.voice_error"
VOICE_READY_TOPIC = "unifia.voice_ready"
SESSION_ID_PREFIX = "ses_"
MAX_SESSION_ID_LENGTH = 128
MAX_PROVIDER_ID_LENGTH = 120
log = logging.getLogger("unifia.voice.errors")
_SAFE_ERRORS = {
    ("audio-input", "AUDIO_INPUT_UNAVAILABLE"): (
        True,
        "Audio input is unavailable.",
        "device",
    ),
    ("permission", "PERMISSION_MICROPHONE_DENIED"): (
        False,
        "Microphone permission was denied.",
        "permission",
    ),
    ("session", "SESSION_AGENT_ERROR"): (
        False,
        "The Unifia session returned an error.",
        "session",
    ),
    ("session", "SESSION_AGENT_UNAVAILABLE"): (
        False,
        "The Unifia session is unavailable.",
        "session",
    ),
    ("provider", "PROVIDER_VOICE_HOST_UNAVAILABLE"): (
        True,
        "The configured Voice Host is unavailable.",
        "availability",
    ),
    ("provider", "PROVIDER_LAN_ACCESS_DISABLED"): (
        False,
        "Voice Host LAN access is disabled.",
        "provider",
    ),
    ("stt", "STT_PROVIDER_UNAVAILABLE"): (
        False,
        "The speech recognition provider is unavailable.",
        "availability",
    ),
    ("tts", "TTS_PROVIDER_UNAVAILABLE"): (
        False,
        "The speech synthesis provider is unavailable.",
        "availability",
    ),
    ("vad", "VAD_PROVIDER_UNAVAILABLE"): (
        False,
        "The voice activity detector is unavailable.",
        "availability",
    ),
    ("turn-detection", "TURN_DETECTION_UNAVAILABLE"): (
        False,
        "The turn detection provider is unavailable.",
        "availability",
    ),
    ("audio-output", "AUDIO_OUTPUT_UNAVAILABLE"): (
        True,
        "Audio output is unavailable.",
        "device",
    ),
    ("model-missing", "MODEL_MISSING_REQUIRED"): (
        False,
        "A required speech model is missing.",
        "availability",
    ),
    ("model-download", "MODEL_DOWNLOAD_FAILED"): (
        True,
        "A speech model could not be downloaded.",
        "network",
    ),
    ("integrity", "INTEGRITY_VERIFICATION_FAILED"): (
        False,
        "A speech model failed integrity verification.",
        "provider",
    ),
    ("model-load", "MODEL_LOAD_FAILED"): (
        False,
        "A speech model could not be loaded.",
        "provider",
    ),
    ("llm", "LLM_UNAVAILABLE"): (
        True,
        "The selected language model is unavailable.",
        "availability",
    ),
    ("tool", "TOOL_EXECUTION_FAILED"): (
        True,
        "A session tool failed.",
        "session",
    ),
    ("provider", "PROVIDER_BINDING_INVALID"): (
        False,
        "The Voice provider binding is invalid.",
        "provider",
    ),
    ("resource", "RESOURCE_PRESSURE"): (
        True,
        "Voice resources are under pressure.",
        "availability",
    ),
    ("thermal", "THERMAL_LIMIT"): (
        True,
        "The device is thermally constrained.",
        "device",
    ),
    ("network", "NETWORK_CONNECTION_LOST"): (
        True,
        "The Voice network connection was lost.",
        "network",
    ),
    ("network", "NETWORK_RATE_LIMITED"): (
        True,
        "The Voice provider is rate limited.",
        "network",
    ),
    ("unsupported-capability", "UNSUPPORTED_CAPABILITY_UNCLASSIFIED_RUNTIME_ERROR"): (
        False,
        "An unclassified Voice runtime failure occurred.",
        "programmer",
    ),
    ("abi", "ABI_UNSUPPORTED"): (
        False,
        "The speech runtime ABI is unsupported.",
        "provider",
    ),
    ("logging", "LOGGING_FAILURE"): (
        True,
        "Voice diagnostics could not be recorded.",
        "availability",
    ),
}


def _valid_session_id(session_id: str) -> bool:
    return (
        session_id.startswith(SESSION_ID_PREFIX)
        and len(SESSION_ID_PREFIX) < len(session_id) <= MAX_SESSION_ID_LENGTH
    )


def encode_voice_error_event(
    *,
    session_id: str,
    sequence: int,
    stage: str,
    code: str,
    turn_id: str | None = None,
    provider_id: str | None = None,
) -> str:
    """Serialize only known safe details; never forward provider or transcript text."""
    if not _valid_session_id(session_id) or sequence < 0:
        raise ValueError("Voice error identity is invalid")
    definition = _SAFE_ERRORS.get((stage, code))
    if definition is None or not code.startswith(f"{stage.upper().replace('-', '_')}_"):
        raise ValueError("Voice error code does not match a registered stage")
    recoverable, detail, cause_category = definition
    if provider_id is not None and (
        not isinstance(provider_id, str)
        or len(provider_id) > MAX_PROVIDER_ID_LENGTH
        or not provider_id
        or not all(
            character.isascii() and (character.isalnum() or character in "._@:-")
            for character in provider_id
        )
    ):
        raise ValueError("Voice error provider identity is invalid")
    event: dict[str, Any] = {
        "kind": "voice_error",
        "sessionID": session_id,
        "ts": time.time_ns() // 1_000_000,
        "seq": sequence,
        "stage": stage,
        "code": code,
        "detail": detail,
        "recoverable": recoverable,
        "cause_category": cause_category,
    }
    if provider_id:
        event["provider_id"] = provider_id
    if turn_id:
        event["turnID"] = turn_id
    return json.dumps(event, separators=(",", ":"), ensure_ascii=True)


def encode_voice_ready_event(*, session_id: str, sequence: int) -> str:
    if not _valid_session_id(session_id) or sequence < 0:
        raise ValueError("Voice readiness identity is invalid")
    event = {
        "kind": "voice_ready",
        "sessionID": session_id,
        "ts": time.time_ns() // 1_000_000,
        "seq": sequence,
        "profile": "live",
    }
    return json.dumps(event, separators=(",", ":"), ensure_ascii=True)


async def publish_voice_error_event(
    publisher: Any,
    *,
    session_id: str,
    sequence: int,
    stage: str,
    code: str,
    turn_id: str | None = None,
    provider_id: str | None = None,
) -> bool:
    payload = encode_voice_error_event(
        session_id=session_id,
        sequence=sequence,
        stage=stage,
        code=code,
        turn_id=turn_id,
        provider_id=provider_id,
    )
    try:
        await publisher.publish_data(payload, reliable=True, topic=VOICE_ERROR_TOPIC)
        return True
    except Exception:
        return False


async def publish_voice_ready_event(
    publisher: Any, *, session_id: str, sequence: int
) -> bool:
    payload = encode_voice_ready_event(session_id=session_id, sequence=sequence)
    published = False
    try:
        await publisher.publish_data(payload, reliable=True, topic=VOICE_READY_TOPIC)
    except Exception:
        log.warning("could not publish Voice readiness data event")
    else:
        published = True
    try:
        await publisher.set_attributes({"unifia.voice_ready": payload})
    except Exception:
        log.warning("could not publish Voice readiness participant attribute")
    else:
        published = True
    return published
