import unittest
from unittest.mock import patch

from voice_host.live_agent import AGENT_NAME, _required_secret, create_transcription_session, prewarm


class LiveAgentTests(unittest.TestCase):
    def test_prewarm_loads_cpu_vad_and_injects_parakeet(self) -> None:
        process = type("JobProcessFixture", (), {"userdata": {}})()
        vad_model = object()
        stt_model = object()

        with (
            patch("voice_host.live_agent.silero.VAD.load", return_value=vad_model) as load_vad,
            patch("voice_host.live_agent.load_parakeet_model", return_value=stt_model),
        ):
            prewarm(process)

        load_vad.assert_called_once_with(force_cpu=True, sample_rate=16_000)
        self.assertIs(process.userdata["vad"], vad_model)
        self.assertIs(process.userdata["stt"]._model, stt_model)

    def test_session_is_stt_only_and_uses_injected_cpu_components(self) -> None:
        stt_adapter = object()
        vad_model = object()
        turn_detector = object()

        session = create_transcription_session(
            stt_adapter=stt_adapter,
            vad_model=vad_model,
            turn_detector=turn_detector,
        )

        self.assertEqual(AGENT_NAME, "unifia-voice-transcriber")
        self.assertIs(session.stt, stt_adapter)
        self.assertIs(session.vad, vad_model)
        self.assertIs(session.turn_detection, turn_detector)
        self.assertIsNone(session.llm)
        self.assertIsNone(session.tts)
        self.assertEqual(session.tools, [])

    def test_required_worker_settings_fail_closed(self) -> None:
        with patch.dict("os.environ", {"LIVEKIT_API_SECRET": "  "}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "LIVEKIT_API_SECRET"):
                _required_secret("LIVEKIT_API_SECRET")

    def test_required_worker_settings_trim_whitespace(self) -> None:
        with patch.dict("os.environ", {"LIVEKIT_URL": " ws://127.0.0.1:7880  "}, clear=True):
            self.assertEqual(_required_secret("LIVEKIT_URL"), "ws://127.0.0.1:7880")


if __name__ == "__main__":
    unittest.main()
