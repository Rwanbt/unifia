"""Safe, ordered Voice error envelopes shared with the TypeScript client."""

from __future__ import annotations

import json
import time
from typing import Any

VOICE_ERROR_TOPIC = "unifia.voice_error"
_SAFE_ERRORS = {
    ("session", "SESSION_AGENT_ERROR"): (
        False,
        "The Unifia session returned an error.",
    ),
    ("session", "SESSION_AGENT_UNAVAILABLE"): (
        False,
        "The Unifia session is unavailable.",
    ),
    ("stt", "STT_PROVIDER_UNAVAILABLE"): (
        False,
        "The speech recognition provider is unavailable.",
    ),
    ("tts", "TTS_PROVIDER_UNAVAILABLE"): (
        False,
        "The speech synthesis provider is unavailable.",
    ),
}


def encode_voice_error_event(
    *, session_id: str, sequence: int, stage: str, code: str, turn_id: str | None = None
) -> str:
    """Serialize only known safe details; never forward provider or transcript text."""
    if not session_id or sequence < 0:
        raise ValueError("Voice error identity is invalid")
    definition = _SAFE_ERRORS.get((stage, code))
    if definition is None or not code.startswith(f"{stage.upper().replace('-', '_')}_"):
        raise ValueError("Voice error code does not match a registered stage")
    recoverable, detail = definition
    event: dict[str, Any] = {
        "kind": "voice_error",
        "sessionID": session_id,
        "ts": time.time_ns() // 1_000_000,
        "seq": sequence,
        "stage": stage,
        "code": code,
        "detail": detail,
        "recoverable": recoverable,
    }
    if turn_id:
        event["turnID"] = turn_id
    return json.dumps(event, separators=(",", ":"), ensure_ascii=True)


async def publish_voice_error_event(
    publisher: Any,
    *,
    session_id: str,
    sequence: int,
    stage: str,
    code: str,
    turn_id: str | None = None,
) -> bool:
    payload = encode_voice_error_event(
        session_id=session_id,
        sequence=sequence,
        stage=stage,
        code=code,
        turn_id=turn_id,
    )
    try:
        await publisher.publish_data(payload, reliable=True, topic=VOICE_ERROR_TOPIC)
        return True
    except Exception:
        return False
