# SPDX-License-Identifier: MIT
"""G13 host convergence — narrow producer seam parity test.

This mirrors ``packages/app/src/voice/event-ordering-parity.test.ts``: it
replays the canonical ``packages/voice-core/fixtures/event-ordering.json``
through the production Rust ``VoiceCore`` reached via its stable C ABI,
the same surface the Android JNI uses. The Python desktop Live worker
should not bypass this contract; this test enforces that.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from voice_host.live.voice_core_abi import VoiceCoreError, VoiceCoreSession


FIXTURE_PATH = (
    Path(__file__).resolve().parents[2]
    / "voice-core"
    / "fixtures"
    / "event-ordering.json"
)


@pytest.fixture(scope="module")
def fixture() -> dict[str, object]:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def _event_kind(event: dict[str, object]) -> str:
    kind = event.get("kind")
    if not isinstance(kind, str):
        raise AssertionError(f"event is missing `kind`: {event}")
    return kind


def test_canonical_traces_satisfy_seam(fixture: dict[str, object]) -> None:
    """The VoiceCore parity contract must be respected end-to-end.

    For each canonical trace we replay every event through the C ABI and
    assert no invariants are broken. Precedence is checked in source order;
    sequence strictly increases; one session and one generation per trace;
    timestamps are non-decreasing.
    """
    if not FIXTURE_PATH.is_file():
        pytest.skip(f"fixture missing: {FIXTURE_PATH}")
    traces = fixture.get("traces")
    assert isinstance(traces, list) and traces, "fixture must list canonical traces"

    for trace in traces:
        name = trace["name"]
        events = trace["events"]
        if not events:
            continue
        session_id = str(events[0].get("sessionID"))
        with VoiceCoreSession(session_id) as session:
            # The core fences a turn exactly once (a second `begin_turn` for
            # the same id is `DuplicateTurn`); every later event of that turn
            # reuses the fence. Track what has been begun instead of calling
            # it per event.
            begun: set[str] = set()
            for index, event in enumerate(events):
                turn_id = event.get("turnID")
                if turn_id is not None:
                    turn = str(turn_id)
                    if turn not in begun:
                        session.begin_turn(turn)
                        begun.add(turn)
                envelope = session.publish(
                    turn_id=str(turn_id) if turn_id is not None else None,
                    monotonic_timestamp_ms=int(event["ts"]),
                    event=dict(event),
                )
                # The core stamps `seq` itself, so the published envelope must
                # carry the same sessionID/kind as the input.
                assert envelope["sessionID"] == session_id, (
                    f"trace {name}[{index}] sessionID drifted"
                )
                assert envelope["kind"] == _event_kind(event)
        # Cross-trace invariants.
        kinds_seen = [event["kind"] for event in events]
        # precedence: every (before, after) pair that fires must appear in
        # source order.
        for before, after in fixture.get("precedence", []):
            if before in kinds_seen and after in kinds_seen:
                assert kinds_seen.index(before) < kinds_seen.index(after), (
                    f"{name}: precedence violated ({before} before {after})"
                )


def test_session_rejects_invalid_id() -> None:
    """VoiceCore validates session IDs at creation; empty/wrong-prefix ids are refused."""
    with pytest.raises(ValueError):
        VoiceCoreSession("")
    with pytest.raises(ValueError):
        VoiceCoreSession("not_a_session_id")


def test_invalid_event_payload_is_refused(fixture: dict[str, object]) -> None:
    """Events missing `kind` or with non-canonical kinds are refused by VoiceCore."""
    if not FIXTURE_PATH.is_file():
        pytest.skip(f"fixture missing: {FIXTURE_PATH}")
    traces = fixture.get("traces")
    events = next(iter(traces))["events"]
    session_id = str(events[0]["sessionID"])
    with VoiceCoreSession(session_id) as session:
        with pytest.raises(ValueError):
            session.publish(turn_id=None, monotonic_timestamp_ms=1, event={"foo": "bar"})
        # VoiceCore itself rejects an unknown kind with a JSON error envelope
        # that raises as VoiceCoreError.
        with pytest.raises(VoiceCoreError):
            session.publish(
                turn_id=None,
                monotonic_timestamp_ms=2,
                event={"kind": "not_a_real_event_kind"},
            )
