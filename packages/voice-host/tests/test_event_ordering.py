import copy
import json
import unittest
from pathlib import Path
from unittest.mock import patch

from voice_host.live.voice_errors import encode_voice_error_event, encode_voice_ready_event

FIXTURE_PATH = (
    Path(__file__).resolve().parents[2]
    / "voice-core"
    / "fixtures"
    / "event-ordering.json"
)


def ordering_violations(fixture):
    """Python mirror of voice-core src/event.rs and contracts src/event-ordering.ts."""
    violations = []
    precedence = [(rule["before"], rule["after"]) for rule in fixture["precedence"]]
    invariants = fixture["invariants"]
    for trace in fixture["traces"]:
        name = trace["name"]
        previous_seq = None
        previous_ts = None
        generation = None
        session = None
        first_seen = {}
        for index, event in enumerate(trace["events"]):
            kind = event.get("kind")
            if not isinstance(kind, str):
                violations.append(f"{name}[{index}]: missing kind")
                continue
            seq = event.get("seq")
            if invariants["sequenceStrictlyIncreasing"] and isinstance(seq, int):
                if previous_seq is not None and seq <= previous_seq:
                    violations.append(
                        f"{name}[{index}] {kind}: seq {seq} does not increase past {previous_seq}"
                    )
                previous_seq = seq
            ts = event.get("ts")
            if invariants["timestampNonDecreasing"] and isinstance(ts, int):
                if previous_ts is not None and ts < previous_ts:
                    violations.append(
                        f"{name}[{index}] {kind}: ts {ts} regresses past {previous_ts}"
                    )
                previous_ts = ts
            if invariants["oneGenerationPerTrace"]:
                if generation is None:
                    generation = event.get("generation")
                elif generation != event.get("generation"):
                    violations.append(
                        f"{name}[{index}] {kind}: generation {event.get('generation')} differs from {generation}"
                    )
            if invariants["oneSessionPerTrace"]:
                if session is None:
                    session = event.get("sessionID")
                elif session != event.get("sessionID"):
                    violations.append(
                        f"{name}[{index}] {kind}: sessionID {event.get('sessionID')} differs from {session}"
                    )
            first_seen.setdefault(kind, index)
        for before, after in precedence:
            if before in first_seen and after in first_seen and first_seen[before] >= first_seen[after]:
                violations.append(
                    f"{name}: {before} (index {first_seen[before]}) must precede {after} (index {first_seen[after]})"
                )
    return violations


def check_kind_order(kinds, fixture):
    """Precedence-only check for emitter kind streams (no envelope fields)."""
    first_seen = {}
    for index, kind in enumerate(kinds):
        first_seen.setdefault(kind, index)
    violations = []
    for rule in fixture["precedence"]:
        before, after = rule["before"], rule["after"]
        if before in first_seen and after in first_seen and first_seen[before] >= first_seen[after]:
            violations.append(f"{before} (index {first_seen[before]}) must precede {after} (index {first_seen[after]})")
    return violations


class EventOrderingFixtureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

    def test_canonical_traces_have_no_violations(self):
        self.assertEqual(ordering_violations(self.fixture), [])

    def test_reordered_trace_is_rejected(self):
        reordered = copy.deepcopy(self.fixture)
        events = reordered["traces"][0]["events"]
        events[0], events[1] = events[1], events[0]
        violations = ordering_violations(reordered)
        self.assertTrue(
            any("voice_preparing" in v and "voice_ready" in v for v in violations),
            violations,
        )

    def test_sequence_regression_is_rejected(self):
        regressed = copy.deepcopy(self.fixture)
        regressed["traces"][0]["events"][2]["seq"] = 0
        violations = ordering_violations(regressed)
        self.assertTrue(any("does not increase" in v for v in violations), violations)

    def test_python_emitter_events_follow_the_shared_envelope_invariants(self):
        with patch(
            "voice_host.live.voice_errors.time.monotonic_ns",
            side_effect=[1_000_000_000, 2_000_000_000],
        ):
            ready = json.loads(encode_voice_ready_event(session_id="ses_ordering_fixture", sequence=0))
            error = json.loads(
                encode_voice_error_event(
                    session_id="ses_ordering_fixture",
                    sequence=1,
                    stage="stt",
                    code="STT_PROVIDER_UNAVAILABLE",
                )
            )

        self.assertEqual(ready["kind"], "voice_ready")
        self.assertEqual(error["kind"], "voice_error")
        self.assertLess(ready["seq"], error["seq"])
        self.assertLessEqual(ready["ts"], error["ts"])
        self.assertEqual(check_kind_order([ready["kind"], error["kind"]], self.fixture), [])


if __name__ == "__main__":
    unittest.main()
