"""Streaming TTS for Live: Pocket in-process, the only bundled engine.

The backend yields 16-bit mono PCM chunks as soon as they are generated; no
file is written. Cancellation is a ``threading.Event`` checked between chunks,
so no chunk is yielded once a request is cancelled.
"""

from __future__ import annotations

import asyncio
import logging
import sys
import threading
import time
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

import numpy as np

log = logging.getLogger("unifia.voice.tts")

MAX_QUEUED_CHUNKS = 32


@dataclass(frozen=True)
class PcmChunk:
    sample_rate: int
    channels: int
    pcm: bytes  # s16le


@dataclass
class SynthesisRequest:
    id: str
    text: str
    language: str
    voice: str | None = None
    speed: float = 1.0
    cancel: threading.Event = field(default_factory=threading.Event)


class TtsBackend(Protocol):
    id: str

    async def prepare(self, language: str, voice: str | None) -> None: ...

    def synthesize(self, request: SynthesisRequest) -> AsyncIterator[PcmChunk]: ...

    async def aclose(self) -> None: ...


def float32_to_s16le(pcm: bytes) -> bytes:
    samples = np.frombuffer(pcm, dtype="<f4")
    return (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()


class _ConsumerGone(Exception):
    """Raised inside the producer thread once nobody will read its chunks."""


async def _drain_thread(
    produce: Callable[[Callable[[PcmChunk], None]], None], cancel: threading.Event
) -> AsyncIterator[PcmChunk]:
    """Run a blocking producer in a thread and stream its chunks with backpressure.

    The bounded queue makes a fast producer wait for playback. If the consumer
    stops early (barge-in closes the generator) the producer's next ``put``
    raises ``_ConsumerGone``, which unwinds it and releases the model.
    """
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[PcmChunk | BaseException | None] = asyncio.Queue(MAX_QUEUED_CHUNKS)
    gone = threading.Event()

    def put(item: PcmChunk | BaseException | None) -> None:
        future = asyncio.run_coroutine_threadsafe(queue.put(item), loop)
        while True:
            if gone.is_set() or (cancel.is_set() and isinstance(item, PcmChunk)):
                future.cancel()
                raise _ConsumerGone()
            try:
                future.result(timeout=0.1)
                return
            except TimeoutError:
                continue

    def run() -> None:
        try:
            produce(put)
            put(None)
        except _ConsumerGone:
            return
        except BaseException as error:  # delivered to the consumer
            try:
                put(error)
            except _ConsumerGone:
                return

    thread = threading.Thread(target=run, name="unifia-tts", daemon=True)
    thread.start()
    try:
        while True:
            item = await queue.get()
            if item is None:
                return
            if isinstance(item, BaseException):
                raise item
            if cancel.is_set():
                return
            yield item
    finally:
        gone.set()


class PocketBackend:
    """Owns one in-process quantized Pocket model (see ``PocketWorker``)."""

    id = "pocket"

    def __init__(self, worker_factory: Callable[[], Any] | None = None) -> None:
        self._factory = worker_factory
        self._worker: Any = None
        self._init_lock = asyncio.Lock()

    async def _ensure_worker(self) -> Any:
        async with self._init_lock:
            if self._worker is None:
                if self._factory is None:
                    from ..worker import PocketWorker

                    self._factory = PocketWorker
                worker = self._factory()
                await asyncio.to_thread(worker.initialize_runtime)
                if not worker.runtime_ready:
                    raise RuntimeError(f"Pocket runtime unavailable: {worker.runtime_error}")
                self._worker = worker
            return self._worker

    async def prepare(self, language: str, voice: str | None) -> None:
        worker = await self._ensure_worker()
        await asyncio.to_thread(worker.prepare, language, voice or "")

    async def synthesize(self, request: SynthesisRequest) -> AsyncIterator[PcmChunk]:
        await self.prepare(request.language, request.voice)
        worker = self._worker

        def produce(put: Callable[[PcmChunk], None]) -> None:
            for sample_rate, pcm in worker.stream_pcm(request.text, request.cancel):
                put(PcmChunk(sample_rate, 1, float32_to_s16le(pcm)))

        async for chunk in _drain_thread(produce, request.cancel):
            yield chunk

    async def aclose(self) -> None:
        self._worker = None


@dataclass
class RouteRecord:
    requested: str
    resolved: str | None
    language: str
    fallback_reason: str | None
    first_audio_ms: int | None


class TtsRouter:
    """``auto`` resolves to Pocket, the only bundled engine."""

    def __init__(
        self,
        backends: dict[str, TtsBackend],
        preference: str = "auto",
        on_route: Callable[[RouteRecord], None] | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if preference not in ("auto", "pocket"):
            preference = "auto"
        self.backends = backends
        self.preference = preference
        self.on_route = on_route
        self._clock = clock

    def order(self) -> list[str]:
        order = ["pocket"] if self.preference == "auto" else [self.preference]
        return [name for name in order if name in self.backends]

    async def synthesize(self, request: SynthesisRequest) -> AsyncIterator[PcmChunk]:
        started = self._clock()
        fallback_reason: str | None = None
        providers = self.order()
        for index, name in enumerate(providers):
            backend = self.backends[name]
            produced = False
            try:
                async for chunk in backend.synthesize(request):
                    if request.cancel.is_set():
                        return
                    if not produced:
                        produced = True
                        self._record(name, request.language, fallback_reason, started)
                    yield chunk
                if not produced and not request.cancel.is_set():
                    raise RuntimeError(f"{name} produced no audio")
                return
            except asyncio.CancelledError:
                raise
            except Exception as error:
                if produced or request.cancel.is_set():
                    raise  # never restart an utterance that already started playing
                fallback_reason = f"{name}: {type(error).__name__}: {error}"[:300]
                log.warning(
                    "TTS provider failed",
                    extra={"provider": name, "language": request.language, "reason": fallback_reason},
                )
                if index == len(providers) - 1:
                    self._record(None, request.language, fallback_reason, started)
                    raise
        if not providers:
            raise RuntimeError("No TTS provider is available")

    def _record(self, resolved: str | None, language: str, reason: str | None, started: float) -> None:
        record = RouteRecord(
            requested=self.preference,
            resolved=resolved,
            language=language,
            fallback_reason=reason,
            first_audio_ms=int((self._clock() - started) * 1000) if resolved else None,
        )
        log.info(
            "tts route requested=%s resolved=%s language=%s first_audio_ms=%s fallback=%s",
            record.requested, record.resolved, record.language, record.first_audio_ms, record.fallback_reason,
        )
        if self.on_route:
            self.on_route(record)

    async def aclose(self) -> None:
        for backend in self.backends.values():
            await backend.aclose()


def default_python() -> str:
    return sys.executable
