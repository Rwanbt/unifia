import asyncio
import unittest
from unittest.mock import patch

import numpy as np
from livekit import rtc
from livekit.agents import stt

from voice_host.parakeet_stt import (
    MAX_UTTERANCE_SECONDS,
    MODEL_SAMPLE_RATE,
    ParakeetSTT,
    frames_to_mono_float32,
    load_parakeet_model,
)


def make_frame(samples: np.ndarray, sample_rate: int, channels: int = 1) -> rtc.AudioFrame:
    pcm16 = np.asarray(samples, dtype="<i2").reshape(-1)
    return rtc.AudioFrame(
        data=pcm16.tobytes(),
        sample_rate=sample_rate,
        num_channels=channels,
        samples_per_channel=pcm16.size // channels,
    )


class FakeModel:
    def __init__(self, result: str = " recognized words ") -> None:
        self.result = result
        self.calls: list[tuple[np.ndarray, int]] = []

    def recognize(self, waveform: np.ndarray, *, sample_rate: int) -> str:
        self.calls.append((waveform, sample_rate))
        return self.result


class ParakeetSTTTests(unittest.TestCase):
    def test_model_is_pinned_to_cpu_and_int8(self) -> None:
        with patch("voice_host.parakeet_stt.onnx_asr.load_model", return_value="model") as load:
            self.assertEqual(load_parakeet_model("managed-model"), "model")
        load.assert_called_once_with(
            "nemo-parakeet-tdt-0.6b-v3",
            path="managed-model",
            quantization="int8",
            providers=["CPUExecutionProvider"],
        )

    def test_frames_are_mixed_and_source_rate_is_preserved_for_model_resampler(self) -> None:
        samples = np.array([[16384, -16384], [32767, 32767]], dtype=np.int16)
        waveform, sample_rate = frames_to_mono_float32([make_frame(samples, 32_000, 2)])

        self.assertEqual(sample_rate, 32_000)
        np.testing.assert_allclose(waveform, [0.0, 1.0], atol=1e-4)

    def test_same_rate_frames_concatenate_without_conversion(self) -> None:
        first = make_frame(np.array([0, 8192], dtype=np.int16), MODEL_SAMPLE_RATE)
        second = make_frame(np.array([16384], dtype=np.int16), MODEL_SAMPLE_RATE)

        waveform, sample_rate = frames_to_mono_float32([first, second])

        self.assertEqual(sample_rate, MODEL_SAMPLE_RATE)
        np.testing.assert_allclose(waveform, [0.0, 0.25, 0.5])

    def test_inconsistent_frames_are_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "consistent rates"):
            frames_to_mono_float32(
                [make_frame(np.array([0], dtype=np.int16), 16_000), make_frame(np.array([0], dtype=np.int16), 48_000)]
            )

    def test_oversized_utterance_is_rejected(self) -> None:
        frame = make_frame(np.zeros(MODEL_SAMPLE_RATE * MAX_UTTERANCE_SECONDS + 1, dtype=np.int16), MODEL_SAMPLE_RATE)
        with self.assertRaisesRegex(ValueError, "30-second"):
            frames_to_mono_float32(frame)

    def test_recognition_returns_final_transcript_and_normalizes_language(self) -> None:
        model = FakeModel()
        adapter = ParakeetSTT(model)

        event = asyncio.run(
            adapter._recognize_impl(
                make_frame(np.array([4096, 8192], dtype=np.int16), MODEL_SAMPLE_RATE),
                language="fr-FR",
                conn_options=None,
            )
        )

        self.assertEqual(event.type, stt.SpeechEventType.FINAL_TRANSCRIPT)
        self.assertEqual(event.alternatives[0].language, "fr")
        self.assertEqual(event.alternatives[0].text, "recognized words")
        self.assertEqual(len(model.calls), 1)

    def test_empty_audio_returns_empty_final_without_model_call(self) -> None:
        model = FakeModel()
        adapter = ParakeetSTT(model)
        event = asyncio.run(
            adapter._recognize_impl(
                [],
                language="en",
                conn_options=None,
            )
        )

        self.assertEqual(event.type, stt.SpeechEventType.FINAL_TRANSCRIPT)
        self.assertEqual(event.alternatives[0].text, "")
        self.assertEqual(model.calls, [])

    def test_unsupported_language_is_rejected(self) -> None:
        adapter = ParakeetSTT(FakeModel())
        with self.assertRaisesRegex(ValueError, "en, fr, es, it, or de"):
            asyncio.run(
                adapter._recognize_impl(
                    make_frame(np.array([0], dtype=np.int16), MODEL_SAMPLE_RATE),
                    language="ja",
                    conn_options=None,
                )
            )


if __name__ == "__main__":
    unittest.main()
