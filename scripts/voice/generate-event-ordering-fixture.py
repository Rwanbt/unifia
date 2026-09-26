#!/usr/bin/env python3
"""Generate the cross-runtime canonical event-ordering fixture.

The fixture encodes two things every emitter must agree on:

1. ``precedence`` — pairwise semantic ordering rules (first occurrence of
   ``before`` must come before first occurrence of ``after`` whenever both
   kinds appear in a trace).
2. ``traces`` — complete envelope-valid sessions with strictly increasing
   ``seq``, non-decreasing ``ts`` and one ``generation``/session per trace.

Three suites assert against the JSON this script writes to
``packages/voice-core/fixtures/event-ordering.json``:

- Rust ``unifia-voice-core`` (``src/event.rs``) — envelopes must deserialize
  into ``VoiceEvent`` and pass ``VoiceEvent::validate()``.
- TypeScript ``@unifia/contracts`` (``test/event-ordering.test.ts``) — same
  invariants and precedence rules in the language-neutral validator.
- Python ``voice-host`` (``tests/test_event_ordering.py``) — same rules in
  the reference language.

The app's local/Android producer additionally feeds the kinds it actually
publishes through the same precedence rules
(``packages/app/src/voice/event-ordering-parity.test.ts``).

Re-run this script only after a deliberate canonical-ordering change, then
re-run the three suites so all sides prove parity against the same bytes.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "packages" / "voice-core" / "fixtures" / "event-ordering.json"

SESSION = "ses_ordering_fixture"
TURN_1 = "turn_ordering_1"
TURN_2 = "turn_ordering_2"
GENERATION = 1

# Pairwise rules: first occurrence of `before` must precede first occurrence
# of `after` when both kinds appear in a trace.
PRECEDENCE: list[tuple[str, str]] = [
    ("voice_preparing", "voice_ready"),
    ("voice_ready", "speech_started"),
    ("speech_started", "stt_partial"),
    ("speech_started", "stt_final"),
    ("stt_partial", "stt_final"),
    ("stt_final", "turn_submitted"),
    ("turn_submitted", "agent_thinking"),
    ("turn_submitted", "assistant_text_delta"),
    ("tool_started", "tool_finished"),
    ("assistant_text_delta", "assistant_text_final"),
    ("assistant_text_final", "turn_complete"),
    ("turn_submitted", "speech_segment_ready"),
    ("speech_segment_ready", "tts_started"),
    ("tts_started", "tts_audio"),
    ("tts_audio", "assistant_speaking"),
    ("assistant_speaking", "assistant_interrupted"),
    ("tts_started", "tts_cancelled"),
    ("assistant_interrupted", "turn_incomplete"),
    ("turn_complete", "voice_stopped"),
]


def envelope(turn_id: str | None, ts: int, seq: int, payload: dict[str, object]) -> dict[str, object]:
    event: dict[str, object] = {"sessionID": SESSION}
    if turn_id is not None:
        event["turnID"] = turn_id
    event["ts"] = ts
    event["seq"] = seq
    event["generation"] = GENERATION
    event.update(payload)
    return event


def session_turn() -> list[dict[str, object]]:
    """A complete session: prepare, ready, one dictation turn, stop."""
    events = [
        envelope(None, 1000, 0, {"kind": "voice_preparing", "profile": "live"}),
        envelope(None, 1010, 1, {
            "kind": "voice_ready",
            "profile": "live",
            "capabilities": ["stt", "tts"],
            "language": "en",
            "voice": "en-default",
            "locale_source": "fallback-english",
        }),
        envelope(TURN_1, 1020, 2, {"kind": "speech_started"}),
        envelope(TURN_1, 1030, 3, {"kind": "vad_probability", "value": 0.6}),
        envelope(TURN_1, 1040, 4, {"kind": "stt_partial", "text": "hel", "stable": False}),
        envelope(TURN_1, 1050, 5, {"kind": "stt_partial", "text": "hello", "stable": True}),
        envelope(TURN_1, 1060, 6, {"kind": "stt_final", "text": "hello world", "language": "en"}),
        envelope(TURN_1, 1070, 7, {"kind": "turn_submitted", "message_id": TURN_1}),
        envelope(TURN_1, 1080, 8, {"kind": "agent_thinking"}),
        envelope(TURN_1, 1090, 9, {"kind": "tool_started", "tool": "shell"}),
        envelope(TURN_1, 1100, 10, {"kind": "tool_finished", "tool": "shell", "outcome": "ok"}),
        envelope(TURN_1, 1110, 11, {"kind": "assistant_text_delta", "delta": "Hello "}),
        envelope(TURN_1, 1120, 12, {"kind": "assistant_text_delta", "delta": "world."}),
        envelope(TURN_1, 1130, 13, {
            "kind": "speech_segment_ready",
            "text": "Hello world.",
            "voice": "en-default",
            "language": "en",
        }),
        envelope(TURN_1, 1140, 14, {"kind": "tts_started", "segment": 0}),
        envelope(TURN_1, 1150, 15, {
            "kind": "tts_audio",
            "segment": 0,
            "pcm": [0, 4096, -4096],
            "sample_rate_hz": 24000,
            "channels": 1,
        }),
        envelope(TURN_1, 1160, 16, {"kind": "assistant_speaking"}),
        envelope(TURN_1, 1170, 17, {"kind": "assistant_text_final", "text": "Hello world."}),
        envelope(TURN_1, 1180, 18, {"kind": "turn_complete", "transcript": "hello world", "confidence": 0.98}),
        envelope(None, 1190, 19, {"kind": "voice_stopped", "reason": "user"}),
    ]
    return events


def interrupted_turn() -> list[dict[str, object]]:
    """A mid-session turn cut short by barge-in: session already running."""
    return [
        envelope(TURN_2, 2000, 0, {"kind": "speech_started"}),
        envelope(TURN_2, 2010, 1, {"kind": "stt_partial", "text": "cancel", "stable": True}),
        envelope(TURN_2, 2020, 2, {"kind": "stt_final", "text": "cancel", "language": "en"}),
        envelope(TURN_2, 2030, 3, {"kind": "turn_submitted", "message_id": TURN_2}),
        envelope(TURN_2, 2040, 4, {"kind": "agent_thinking"}),
        envelope(TURN_2, 2050, 5, {"kind": "assistant_text_delta", "delta": "Sure, "}),
        envelope(TURN_2, 2060, 6, {"kind": "assistant_text_delta", "delta": "I can "}),
        envelope(TURN_2, 2070, 7, {
            "kind": "speech_segment_ready",
            "text": "Sure, I can",
            "voice": "en-default",
            "language": "en",
        }),
        envelope(TURN_2, 2080, 8, {"kind": "tts_started", "segment": 0}),
        envelope(TURN_2, 2090, 9, {
            "kind": "tts_audio",
            "segment": 0,
            "pcm": [0, 2048],
            "sample_rate_hz": 24000,
            "channels": 1,
        }),
        envelope(TURN_2, 2100, 10, {"kind": "assistant_speaking"}),
        envelope(TURN_2, 2110, 11, {"kind": "assistant_interrupted"}),
        envelope(TURN_2, 2120, 12, {"kind": "tts_cancelled", "segment": 0, "reason": "user-barge"}),
        envelope(TURN_2, 2130, 13, {"kind": "turn_incomplete"}),
    ]


def main() -> int:
    fixture = {
        "version": 1,
        "source": "scripts/voice/generate-event-ordering-fixture.py",
        "reference": "packages/voice-core/src/event.rs",
        "invariants": {
            "sequenceStrictlyIncreasing": True,
            "timestampNonDecreasing": True,
            "oneGenerationPerTrace": True,
            "oneSessionPerTrace": True,
        },
        "precedence": [{"before": before, "after": after} for before, after in PRECEDENCE],
        "traces": [
            {"name": "sessionTurn", "events": session_turn()},
            {"name": "interruptedTurn", "events": interrupted_turn()},
        ],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(fixture, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
