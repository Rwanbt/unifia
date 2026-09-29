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


SUPPORTED_RATES = frozenset({8_000, 11_025, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000})


def frames_to_mono(frames: list[rtc.AudioFrame]) -> tuple[np.ndarray, int]:
    """Merge LiveKit PCM16 frames into one bounded float32 mono waveform.

    Frames must share one sample rate and match their declared dimensions;
    the waveform keeps its rate when onnx-asr can resample it (higher
    quality than a local interpolation) and is interpolated to 16 kHz
    otherwise.
    """
    if not frames:
        return np.zeros(0, dtype=np.float32), TARGET_RATE
    rate = frames[0].sample_rate
    if rate <= 0:
        raise ValueError("Audio frame sample rate must be positive")
    chunks: list[np.ndarray] = []
    total = 0
    for frame in frames:
        if frame.sample_rate != rate or frame.num_channels < 1:
            raise ValueError("Audio frames must share one sample rate and have channels")
        samples = np.frombuffer(frame.data, dtype="<i2")
        if samples.size != frame.samples_per_channel * frame.num_channels:
            raise ValueError("Audio frame data does not match its sample dimensions")
        if frame.samples_per_channel == 0:
            continue
        mono = samples.reshape(-1, frame.num_channels).astype(np.float32).mean(axis=1) / 32768.0
        chunks.append(mono.astype(np.float32))
        total += frame.samples_per_channel
        if total >= rate * MAX_UTTERANCE_SECONDS:
            break
    if not chunks:
        return np.zeros(0, dtype=np.float32), rate
    waveform = np.concatenate(chunks)[: rate * MAX_UTTERANCE_SECONDS]
    if rate not in SUPPORTED_RATES:
        target_len = max(int(round(waveform.shape[0] * TARGET_RATE / rate)), 1)
        positions = np.linspace(0, waveform.shape[0] - 1, num=target_len)
        waveform = np.interp(positions, np.arange(waveform.shape[0]), waveform).astype(np.float32)
        rate = TARGET_RATE
    return waveform, rate


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

    def _transcribe(self, waveform: np.ndarray, rate: int) -> str:
        with self._lock:
            result = self._recognizer.recognize(waveform, sample_rate=rate)
        return str(getattr(result, "text", result) or "").strip()

    async def _recognize_impl(
        self,
        buffer: utils.AudioBuffer,
        *,
        language: NotGivenOr[str] = NOT_GIVEN,
        conn_options: APIConnectOptions,
    ) -> stt.SpeechEvent:
        frames = buffer if isinstance(buffer, list) else [buffer]
        waveform, rate = frames_to_mono(frames)
        started = time.perf_counter()
        text = await asyncio.to_thread(self._transcribe, waveform, rate) if waveform.size else ""
        self.last_latency_ms = int((time.perf_counter() - started) * 1000)
        resolved = self._router.resolve(detect_language(text), text)
        log.info(
            "stt utterance audio_ms=%d stt_ms=%d language=%s chars=%d",
            int(waveform.size * 1000 / rate), self.last_latency_ms, resolved, len(text),
        )
        return stt.SpeechEvent(
            type=stt.SpeechEventType.FINAL_TRANSCRIPT,
            alternatives=[stt.SpeechData(language=LanguageCode(resolved), text=text, confidence=1.0 if text else 0.0)],
        )
