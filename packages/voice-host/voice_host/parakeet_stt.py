"""LiveKit STT adapter for the local, CPU-only Parakeet model."""

from __future__ import annotations

import asyncio
import threading
from typing import Any

import numpy as np
import onnx_asr
from livekit.agents import stt, utils
from livekit.agents.types import NOT_GIVEN, NotGivenOr
from livekit import rtc

MODEL_NAME = "nemo-parakeet-tdt-0.6b-v3"
MODEL_SAMPLE_RATE = 16_000
MAX_UTTERANCE_SECONDS = 30
SUPPORTED_LANGUAGES = frozenset({"en", "fr", "es", "it", "de"})


def load_parakeet_model(model_path: str | None = None) -> Any:
    """Load the multilingual model with CPU execution and int8 weights."""
    return onnx_asr.load_model(
        MODEL_NAME,
        path=model_path,
        quantization="int8",
        providers=["CPUExecutionProvider"],
    )


def frames_to_mono_float32(frames: utils.AudioBuffer) -> tuple[np.ndarray, int]:
    """Convert LiveKit PCM16 frames to a bounded mono float waveform."""
    frame_list = [frames] if isinstance(frames, rtc.AudioFrame) else frames
    if not frame_list:
        return np.empty(0, dtype=np.float32), MODEL_SAMPLE_RATE

    sample_rate = frame_list[0].sample_rate
    if sample_rate <= 0:
        raise ValueError("Audio frame sample rate must be positive")

    chunks: list[np.ndarray] = []
    total_samples = 0
    for frame in frame_list:
        if frame.sample_rate != sample_rate or frame.num_channels < 1:
            raise ValueError("Audio frames must have consistent rates and valid channels")
        samples = np.frombuffer(frame.data, dtype="<i2")
        expected_samples = frame.samples_per_channel * frame.num_channels
        if samples.size != expected_samples:
            raise ValueError("Audio frame data does not match its sample dimensions")
        if frame.samples_per_channel == 0:
            continue
        mono = samples.reshape(-1, frame.num_channels).astype(np.float32)
        mono /= 32768.0
        chunks.append(mono.mean(axis=1, dtype=np.float32))
        total_samples += frame.samples_per_channel

    if total_samples > sample_rate * MAX_UTTERANCE_SECONDS:
        raise ValueError("Audio utterance exceeds the 30-second recognition limit")
    if not chunks:
        return np.empty(0, dtype=np.float32), sample_rate
    waveform = np.concatenate(chunks)
    return waveform, sample_rate


class ParakeetSTT(stt.STT):
    """Expose synchronous onnx-asr recognition through LiveKit's async STT API."""

    def __init__(self, model: Any) -> None:
        super().__init__(capabilities=stt.STTCapabilities(streaming=False, interim_results=False))
        self._model = model
        self._recognition_lock = threading.Lock()

    async def _recognize_impl(
        self,
        buffer: utils.AudioBuffer,
        *,
        language: NotGivenOr[str] = NOT_GIVEN,
        conn_options: stt.APIConnectOptions,
    ) -> stt.SpeechEvent:
        waveform, sample_rate = frames_to_mono_float32(buffer)
        language_code = "en" if language is NOT_GIVEN else str(language).split("-")[0].lower()
        if language_code not in SUPPORTED_LANGUAGES:
            raise ValueError("Parakeet language must be en, fr, es, it, or de")
        if waveform.size == 0:
            text = ""
        else:
            text = await asyncio.to_thread(self._recognize, waveform, sample_rate)
        return stt.SpeechEvent(
            type=stt.SpeechEventType.FINAL_TRANSCRIPT,
            alternatives=[stt.SpeechData(language=language_code, text=text)],
        )

    def _recognize(self, waveform: np.ndarray, sample_rate: int) -> str:
        with self._recognition_lock:
            result = self._model.recognize(waveform, sample_rate=sample_rate)
        if not isinstance(result, str):
            raise TypeError("Parakeet returned an invalid transcript result")
        return result.strip()
