"""Parakeet TDT 0.6B v3 (int8, CPU) as a LiveKit batch STT.

LiveKit's VAD + turn detector delimit the utterance; this class transcribes
the finished utterance in memory. It reuses the Parakeet files the desktop
already downloads for dictation, so Live and dictation share one model.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from pathlib import Path
from typing import Any

import numpy as np
from livekit import rtc
from livekit.agents import APIConnectOptions, LanguageCode, stt, utils
from livekit.agents.types import NOT_GIVEN, NotGivenOr

from .language import LanguageRouter, detect_language

log = logging.getLogger("unifia.voice.stt")

TARGET_RATE = 16_000
MAX_UTTERANCE_SECONDS = 60


def load_parakeet(model_dir: Path, threads: int) -> Any:
    import onnx_asr
    import onnxruntime as ort

    options = ort.SessionOptions()
    options.intra_op_num_threads = max(1, threads)
    options.inter_op_num_threads = 1
    return onnx_asr.load_model(
        "nemo-parakeet-tdt-0.6b-v3",
        model_dir,
        quantization="int8",
        providers=["CPUExecutionProvider"],
        sess_options=options,
    )


def frames_to_mono16k(frames: list[rtc.AudioFrame]) -> np.ndarray:
    """Merge LiveKit frames into one float32 mono 16 kHz waveform."""
    if not frames:
        return np.zeros(0, dtype=np.float32)
    merged = rtc.combine_audio_frames(frames)
    samples = np.frombuffer(merged.data, dtype=np.int16).astype(np.float32) / 32768.0
    if merged.num_channels > 1:
        samples = samples.reshape(-1, merged.num_channels).mean(axis=1)
    if merged.sample_rate != TARGET_RATE:
        duration = samples.shape[0] / merged.sample_rate
        target_len = int(round(duration * TARGET_RATE))
        positions = np.linspace(0, samples.shape[0] - 1, num=max(target_len, 1))
        samples = np.interp(positions, np.arange(samples.shape[0]), samples).astype(np.float32)
    return samples[: MAX_UTTERANCE_SECONDS * TARGET_RATE]


class ParakeetSTT(stt.STT):
    def __init__(self, recognizer: Any, router: LanguageRouter) -> None:
        super().__init__(capabilities=stt.STTCapabilities(streaming=False, interim_results=False))
        self._recognizer = recognizer
        self._router = router
        self._lock = threading.Lock()  # one inference at a time per model
        self.last_latency_ms: int | None = None

    @property
    def model(self) -> str:
        return "parakeet-tdt-0.6b-v3-int8"

    @property
    def provider(self) -> str:
        return "unifia"

    def _transcribe(self, waveform: np.ndarray) -> str:
        with self._lock:
            result = self._recognizer.recognize(waveform, sample_rate=TARGET_RATE)
        return str(getattr(result, "text", result) or "").strip()

    async def _recognize_impl(
        self,
        buffer: utils.AudioBuffer,
        *,
        language: NotGivenOr[str] = NOT_GIVEN,
        conn_options: APIConnectOptions,
    ) -> stt.SpeechEvent:
        frames = buffer if isinstance(buffer, list) else [buffer]
        waveform = frames_to_mono16k(frames)
        started = time.perf_counter()
        text = await asyncio.to_thread(self._transcribe, waveform) if waveform.size else ""
        self.last_latency_ms = int((time.perf_counter() - started) * 1000)
        resolved = self._router.resolve(detect_language(text), text)
        log.info(
            "stt utterance audio_ms=%d stt_ms=%d language=%s chars=%d",
            int(waveform.size * 1000 / TARGET_RATE), self.last_latency_ms, resolved, len(text),
        )
        return stt.SpeechEvent(
            type=stt.SpeechEventType.FINAL_TRANSCRIPT,
            alternatives=[stt.SpeechData(language=LanguageCode(resolved), text=text, confidence=1.0 if text else 0.0)],
        )
