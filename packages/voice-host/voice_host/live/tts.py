"""Streaming TTS for Live: Pocket in-process first, Piper out-of-process second.

Both backends yield 16-bit mono PCM chunks as soon as they are generated; no
file is written. Cancellation is a ``threading.Event`` checked between chunks,
so no chunk is yielded once a request is cancelled.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import sys
import threading
import time
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

import numpy as np

log = logging.getLogger("unifia.voice.tts")

POCKET_COOLDOWN_SECONDS = 30.0
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


class PiperBackend:
    """Talks to the supervised Piper Host worker over its private JSONL protocol.

    Piper is GPL-3.0-or-later and stays in its own process and environment;
    this module only exchanges JSON lines with it.
    """

    id = "piper"

    def __init__(self, command: list[str], env: dict[str, str] | None = None) -> None:
        self._command = command
        self._env = env
        self._process: asyncio.subprocess.Process | None = None
        self._pending: dict[str, asyncio.Queue[dict[str, Any]]] = {}
        self._reader: asyncio.Task[None] | None = None
        self._lock = asyncio.Lock()
        self._synthesis_lock = asyncio.Lock()
        self._counter = 0

    @classmethod
    def from_project(cls, project: Path, asset_dir: Path) -> "PiperBackend":
        python = project / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        env = {**os.environ, "UNIFIA_PIPER_ASSET_DIR": str(asset_dir), "CUDA_VISIBLE_DEVICES": ""}
        return cls([str(python), "-m", "piper_host.worker"], env)

    def _next_id(self, kind: str) -> str:
        self._counter += 1
        return f"live-{kind}-{self._counter}"

    async def _ensure_process(self) -> asyncio.subprocess.Process:
        async with self._lock:
            if self._process is not None and self._process.returncode is None:
                return self._process
            self._process = await asyncio.create_subprocess_exec(
                *self._command,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=self._env,
                limit=2 * 1024 * 1024,
            )
            self._reader = asyncio.create_task(self._read(self._process))
            asyncio.create_task(self._forward_stderr(self._process))
            return self._process

    async def _read(self, process: asyncio.subprocess.Process) -> None:
        assert process.stdout is not None
        while line := await process.stdout.readline():
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            queue = self._pending.get(str(message.get("id", "")))
            if queue is not None:
                await queue.put(message)
        for queue in self._pending.values():
            await queue.put({"type": "error", "message": "Piper worker exited"})

    async def _forward_stderr(self, process: asyncio.subprocess.Process) -> None:
        assert process.stderr is not None
        while line := await process.stderr.readline():
            log.info("[Piper Host] %s", line.decode("utf-8", "replace").rstrip())

    async def _send(self, request: dict[str, Any]) -> asyncio.Queue[dict[str, Any]]:
        process = await self._ensure_process()
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._pending[request["id"]] = queue
        assert process.stdin is not None
        process.stdin.write((json.dumps(request, separators=(",", ":")) + "\n").encode())
        await process.stdin.drain()
        return queue

    async def prepare(self, language: str, voice: str | None) -> None:
        request_id = self._next_id("prepare")
        queue = await self._send({"id": request_id, "action": "prepare", "language": language, "voice": voice})
        try:
            while True:
                message = await asyncio.wait_for(queue.get(), timeout=600)
                if message.get("type") == "prepared":
                    return
                if message.get("type") == "error":
                    raise RuntimeError(f"Piper prepare failed: {message.get('message')}")
        finally:
            self._pending.pop(request_id, None)

    async def synthesize(self, request: SynthesisRequest) -> AsyncIterator[PcmChunk]:
        async with self._synthesis_lock:
            await self.prepare(request.language, None)
            request_id = self._next_id("synthesize")
            queue = await self._send(
                {"id": request_id, "action": "synthesize", "text": request.text, "speed": request.speed}
            )
            try:
                while True:
                    if request.cancel.is_set():
                        await self._send({"id": self._next_id("cancel"), "action": "cancel", "requestId": request_id})
                        return
                    try:
                        message = await asyncio.wait_for(queue.get(), timeout=0.1)
                    except TimeoutError:
                        continue
                    kind = message.get("type")
                    if kind == "audio":
                        if request.cancel.is_set():
                            continue
                        yield PcmChunk(
                            int(message["sampleRate"]),
                            int(message.get("channels", 1)),
                            base64.b64decode(message["audio"]),
                        )
                    elif kind in ("complete", "cancelled"):
                        return
                    elif kind == "error":
                        raise RuntimeError(f"Piper synthesis failed: {message.get('message')}")
            finally:
                self._pending.pop(request_id, None)

    async def aclose(self) -> None:
        process = self._process
        self._process = None
        if process is None or process.returncode is not None:
            return
        if process.stdin is not None:
            process.stdin.close()
        try:
            await asyncio.wait_for(process.wait(), timeout=5)
        except TimeoutError:
            process.kill()
            await process.wait()


@dataclass
class RouteRecord:
    requested: str
    resolved: str | None
    language: str
    fallback_reason: str | None
    first_audio_ms: int | None


class TtsRouter:
    """``auto`` = Pocket, then Piper when Pocket cannot produce audio."""

    def __init__(
        self,
        backends: dict[str, TtsBackend],
        preference: str = "auto",
        on_route: Callable[[RouteRecord], None] | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if preference not in ("auto", "pocket", "piper"):
            preference = "auto"
        self.backends = backends
        self.preference = preference
        self.on_route = on_route
        self._clock = clock
        self._pocket_unhealthy_until = 0.0

    def order(self) -> list[str]:
        if self.preference == "auto":
            order = ["pocket", "piper"]
            if self._clock() < self._pocket_unhealthy_until:
                order = ["piper", "pocket"]
        else:
            order = [self.preference]
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
                if name == "pocket":
                    self._pocket_unhealthy_until = self._clock() + POCKET_COOLDOWN_SECONDS
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
