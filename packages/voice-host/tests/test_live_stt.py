import asyncio
import unittest
from unittest.mock import patch

import numpy as np
from livekit import rtc
from livekit.agents import DEFAULT_API_CONNECT_OPTIONS, stt

from voice_host.live.language import LanguageRouter
from voice_host.live.stt import MAX_UTTERANCE_SECONDS, ParakeetSTT, frames_to_mono, load_parakeet


def frame(samples, rate=16_000, channels=1):
    data = np.asarray(samples, dtype="<i2")
    return rtc.AudioFrame(data.tobytes(), rate, channels, data.size // channels)


class RecordingModel:
    def __init__(self, text="corrige le test qui échoue dans le parseur"):
        self.text = text
        self.calls = []

    def recognize(self, waveform, sample_rate=16_000):
        self.calls.append((waveform.size, sample_rate))
        return self.text


class ParakeetTests(unittest.TestCase):
    def test_model_is_loaded_int8_on_cpu(self):
        with patch("onnx_asr.load_model", return_value="model") as load:
            self.assertEqual(load_parakeet("managed-model", threads=2), "model")
        args, kwargs = load.call_args
        self.assertEqual(args[:2], ("nemo-parakeet-tdt-0.6b-v3", "managed-model"))
        self.assertEqual(kwargs["quantization"], "int8")
        self.assertEqual(kwargs["providers"], ["CPUExecutionProvider"])

    def test_stereo_frames_are_mixed_and_supported_rates_kept(self):
        waveform, rate = frames_to_mono([frame([0, 0, 32767, 32767], rate=32_000, channels=2)])
        self.assertEqual(rate, 32_000)
        np.testing.assert_allclose(waveform, [0.0, 1.0], atol=1e-4)

    def test_same_rate_frames_concatenate(self):
        waveform, rate = frames_to_mono([frame([0, 8192]), frame([16384])])
        self.assertEqual(rate, 16_000)
        np.testing.assert_allclose(waveform, [0.0, 0.25, 0.5])

    def test_unsupported_rates_are_resampled_to_16k(self):
        waveform, rate = frames_to_mono([frame(np.zeros(12_000), rate=12_000)])
        self.assertEqual(rate, 16_000)
        self.assertEqual(waveform.size, 16_000)

    def test_inconsistent_frames_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "one sample rate"):
            frames_to_mono([frame([0], rate=16_000), frame([0], rate=48_000)])

    def test_long_utterances_are_capped(self):
        waveform, _ = frames_to_mono([frame(np.zeros(16_000 * (MAX_UTTERANCE_SECONDS + 5)))])
        self.assertEqual(waveform.size, 16_000 * MAX_UTTERANCE_SECONDS)

    def test_final_transcript_carries_the_routed_language(self):
        model = RecordingModel()
        engine = ParakeetSTT(model, LanguageRouter(application_locale="en-US"))
        event = asyncio.run(engine._recognize_impl([frame(np.ones(1600))], conn_options=DEFAULT_API_CONNECT_OPTIONS))
        self.assertEqual(event.type, stt.SpeechEventType.FINAL_TRANSCRIPT)
        self.assertEqual(event.alternatives[0].text, model.text)
        self.assertEqual(event.alternatives[0].language, "fr")
        self.assertEqual(model.calls, [(1600, 16_000)])

    def test_empty_audio_skips_the_model(self):
        model = RecordingModel()
        engine = ParakeetSTT(model, LanguageRouter())
        event = asyncio.run(engine._recognize_impl([], conn_options=DEFAULT_API_CONNECT_OPTIONS))
        self.assertEqual(event.alternatives[0].text, "")
        self.assertEqual(model.calls, [])


if __name__ == "__main__":
    unittest.main()
