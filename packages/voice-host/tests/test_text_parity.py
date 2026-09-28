"""Cross-runtime parity: the Python reference must keep reproducing
``packages/voice-core/fixtures/speech-text-parity.json``.

The fixture is generated from this reference implementation by
``scripts/voice/generate-speech-fixtures.py`` and asserted from both sides
(this file and ``packages/app/src/voice/speech-text-parity.test.ts``). If this
suite fails, either the reference drifted without regenerating the fixture or
the fixture was edited outside the generator — regenerate and re-run both.
"""

import json
import unittest
from pathlib import Path

from voice_host.live.renderer import phrase, redact_secrets, render
from voice_host.live.segmenter import SpeechSegmenter

FIXTURE_PATH = (
    Path(__file__).resolve().parents[2]
    / "voice-core"
    / "fixtures"
    / "speech-text-parity.json"
)


def _segment_dict(segment) -> dict[str, object]:
    return {"kind": segment.kind, "text": segment.text, "count": segment.count}


class SpeechTextParityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

    def test_fixture_is_versioned_and_populated(self) -> None:
        self.assertEqual(self.fixture["version"], 1)
        self.assertGreater(len(self.fixture["segmenter"]), 10)
        self.assertGreater(len(self.fixture["render"]), 10)
        self.assertGreater(len(self.fixture["redact"]), 5)
        self.assertEqual(len(self.fixture["phrases"]), 45)

    def test_segmenter_reproduces_every_incremental_step(self) -> None:
        for case in self.fixture["segmenter"]:
            with self.subTest(case=case["name"]):
                segmenter = SpeechSegmenter()
                steps = [
                    {"delta": step["delta"], "segments": [_segment_dict(s) for s in segmenter.push(step["delta"])]}
                    for step in case["steps"]
                ]
                flush = [_segment_dict(s) for s in segmenter.flush()]
                self.assertEqual(steps, case["steps"])
                self.assertEqual(flush, case["flush"])

    def test_render_reproduces_the_reference_output(self) -> None:
        for case in self.fixture["render"]:
            with self.subTest(case=case["name"]):
                self.assertEqual(render(case["input"], case["language"]), case["output"])

    def test_redact_reproduces_the_reference_output(self) -> None:
        for case in self.fixture["redact"]:
            with self.subTest(case=case["name"]):
                self.assertEqual(redact_secrets(case["input"], case["language"]), case["output"])

    def test_phrases_reproduce_the_reference_output(self) -> None:
        for case in self.fixture["phrases"]:
            with self.subTest(language=case["language"], key=case["key"]):
                self.assertEqual(phrase(case["language"], case["key"], **case["values"]), case["output"])


if __name__ == "__main__":
    unittest.main()
