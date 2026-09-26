"""LiveKit Agents entrypoint for Unifia Live conversation.

Pipeline: room audio -> Silero VAD -> turn detector v1-mini -> Parakeet ->
VoiceAgentBridge (existing Unifia session) -> SpeechSegmenter -> SpeechRenderer
-> TtsRouter (Pocket, Piper fallback) -> room audio.

LiveKit owns transport and turn-taking only. The ``llm`` given to the session
is an adapter that forwards the finalized transcript to Unifia and streams
back Unifia's answer; tools are never registered with LiveKit.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import re
import threading
import time
from collections.abc import AsyncIterable, AsyncIterator, Callable
from dataclasses import dataclass, field
from typing import Any

import aiohttp
import numpy as np
from livekit import rtc
from livekit.agents import (
    DEFAULT_API_CONNECT_OPTIONS,
    APIConnectOptions,
    Agent,
    AgentSession,
    AutoSubscribe,
    JobContext,
    llm,
    tts,
    utils,
)
from livekit.agents.voice import room_io
from livekit.agents.voice.agent import ModelSettings
from livekit.agents.voice.agent_session import SessionConnectOptions

from .bridge import BridgeError, LiveBinding, ServerEndpoint, VoiceAgentBridge, VoiceAgentEvent, _TurnTracker
from .language import LanguageRouter
from .renderer import phrase, render
from .segmenter import Segment, SpeechSegmenter
from .stt import ParakeetSTT
from .tts import PcmChunk, RouteRecord, SynthesisRequest, TtsRouter
from .turns import TurnLedger, VoiceTurn, ascending_id, device_id, turn_id_for
from .voice_errors import publish_voice_error_event, publish_voice_ready_event

log = logging.getLogger("unifia.voice.live")

AGENT_NAME = "unifia-voice"
OUTPUT_RATE = 24_000
FRAME_MS = 20
ACK_AFTER_SECONDS = 2.5
EMPTY_ROOM_GRACE_SECONDS = 90.0
AEC_WARMUP_SECONDS = 0.5
SUMMARY_SEGMENTS = 3
BINDING_ID = re.compile(r"^lvb_[A-Za-z0-9]{16,64}$")


def metric(name: str, value: float | int | None, **labels: Any) -> None:
    """Structured metric line; never carries audio or transcript content."""
    if value is None:
        return
    extra = " ".join(f"{k}={v}" for k, v in labels.items() if v is not None)
    log.info("voice.metric %s=%s %s", name, int(value) if isinstance(value, float) else value, extra)


def segment_text(segment: Segment, language: str) -> str | None:
    if segment.kind == "code":
        return phrase(language, "code")
    if segment.kind == "table":
        return phrase(language, "table")
    if segment.kind == "list_rest":
        return phrase(language, "list_rest", count=segment.count)
    return render(segment.text, language)


def pcm_frames(chunk: PcmChunk, resampler: dict[int, rtc.AudioResampler]) -> list[rtc.AudioFrame]:
    """Convert a PCM chunk into 20 ms mono frames at the output rate."""
    samples = np.frombuffer(chunk.pcm, dtype="<i2")
    if chunk.channels > 1:
        samples = samples.reshape(-1, chunk.channels).mean(axis=1).astype("<i2")
    frames: list[rtc.AudioFrame] = []
    if chunk.sample_rate != OUTPUT_RATE:
        converter = resampler.setdefault(
            chunk.sample_rate, rtc.AudioResampler(chunk.sample_rate, OUTPUT_RATE, num_channels=1)
        )
        source = rtc.AudioFrame(samples.tobytes(), chunk.sample_rate, 1, samples.shape[0])
        converted = converter.push(source)
        samples = (
            np.concatenate([np.frombuffer(f.data, dtype="<i2") for f in converted])
            if converted
            else np.zeros(0, dtype="<i2")
        )
    step = OUTPUT_RATE * FRAME_MS // 1000
    for offset in range(0, samples.shape[0], step):
        part = samples[offset : offset + step]
        if part.size:
            frames.append(rtc.AudioFrame(part.tobytes(), OUTPUT_RATE, 1, part.shape[0]))
    return frames


@dataclass
class LiveConversation:
    """Per-room state shared by the LLM adapter, the TTS node and watchers."""

    room: rtc.Room
    bridge: VoiceAgentBridge
    router: TtsRouter
    languages: LanguageRouter
    voices: dict[str, str] = field(default_factory=dict)
    speed: float = 1.0
    ledger: TurnLedger = field(default_factory=TurnLedger)
    device: str = field(default_factory=device_id)
    latest_turn: str | None = None
    session: AgentSession | None = None
    _attributes: dict[str, str] = field(default_factory=dict)
    _watchers: set[asyncio.Task[None]] = field(default_factory=set)
    _turn_ended_at: float | None = None
    _first_audio_pending: bool = False
    _voice_event_sequence: int = 0

    def language(self) -> str:
        return self.languages.resolve(None)

    async def publish(self, **values: str) -> None:
        changed = {k: v for k, v in values.items() if self._attributes.get(k) != v}
        if not changed or not self.room.isconnected():
            return
        self._attributes.update(changed)
        try:
            await self.room.local_participant.set_attributes({f"unifia.{k}": v for k, v in changed.items()})
        except Exception:  # attributes are advisory UI state
            log.warning("could not publish agent attributes")

    async def publish_voice_error(
        self, session_id: str, code: str, turn_id: str | None = None, stage: str = "session"
    ) -> bool:
        self._voice_event_sequence += 1
        published = await publish_voice_error_event(
            self.room.local_participant,
            session_id=session_id,
            sequence=self._voice_event_sequence,
            stage=stage,
            code=code,
            turn_id=turn_id,
        )
        if not published:
            log.warning("could not publish staged Voice error event")
        return published

    async def publish_voice_ready(self, session_id: str) -> bool:
        self._voice_event_sequence += 1
        published = await publish_voice_ready_event(
            self.room.local_participant,
            session_id=session_id,
            sequence=self._voice_event_sequence,
        )
        if not published:
            log.warning("could not publish Voice readiness event")
        return published

    def on_route(self, record: RouteRecord) -> None:
        metric("voice.tts.first_audio.ms", record.first_audio_ms, provider=record.resolved, language=record.language)
        asyncio.get_event_loop().create_task(
            self.publish(tts=record.resolved or "unavailable", fallback="1" if record.fallback_reason else "")
        )

    # -- turns --------------------------------------------------------------

    async def run_turn(self, message: llm.ChatMessage, emit: Callable[[str], None]) -> None:
        transcript = (message.text_content or "").strip()
        if not transcript:
            return
        participant = next(iter(self.room.remote_participants.values()), None)
        turn_id = turn_id_for(self.room.name, participant.identity if participant else "", message.id)
        try:
            session_id = await self.bridge.ensure_session()
        except (BridgeError, aiohttp.ClientError):
            log.error("voice turn could not reach the Unifia session")
            session_id = self.bridge.binding.session_id
            if session_id and not await self.publish_voice_error(session_id, "SESSION_AGENT_UNAVAILABLE", turn_id):
                await self.publish(error="agent_unavailable")
            await self.publish(task="idle")
            emit(phrase(self.language(), "error"))
            return
        candidate = VoiceTurn(
            id=turn_id,
            session_id=session_id,
            device_id=self.device,
            transcript=transcript,
            language=self.language(),
            started_at=message.created_at,
            ended_at=time.time(),
            message_id=ascending_id("msg"),
        )
        turn = self.ledger.claim(candidate) or candidate
        self.latest_turn = turn.id
        self._turn_ended_at = time.monotonic()
        self._first_audio_pending = True
        await self.publish(session=session_id, task="thinking", error="", attention="")
        tracker = _TurnTracker(session_id=session_id, user_message_id=turn.message_id)
        submitted_at = time.monotonic()
        spoke = acked = finished = False
        stream = self.bridge.submit(turn, tracker)
        iterator = stream.__aiter__()
        pending: asyncio.Future[VoiceAgentEvent] | None = asyncio.ensure_future(anext(iterator))
        try:
            while pending is not None:
                wait = None if (spoke or acked) else ACK_AFTER_SECONDS
                done, _ = await asyncio.wait({pending}, timeout=wait)
                if not done:
                    acked = True
                    emit(phrase(turn.language, "working"))
                    await self.publish(task="working")
                    continue
                try:
                    event = pending.result()
                except StopAsyncIteration:
                    pending = None
                    break
                pending = asyncio.ensure_future(anext(iterator))
                if event.type == "text-delta" and event.text:
                    if not spoke:
                        metric("voice.llm.first_token.ms", (time.monotonic() - submitted_at) * 1000)
                    spoke = True
                    emit(event.text)
                elif event.type == "tool-start":
                    if not spoke and not acked:
                        acked = True
                        emit(phrase(turn.language, "working"))
                    await self.publish(task="working")
                elif event.type == "permission-required":
                    await self.publish(attention="permission")
                    emit(" " + phrase(turn.language, "permission") + " ")
                elif event.type == "question":
                    await self.publish(attention="question")
                    emit(" " + phrase(turn.language, "question") + " ")
                elif event.type == "error":
                    if not await self.publish_voice_error(turn.session_id, "SESSION_AGENT_ERROR", turn.id):
                        await self.publish(error="agent_unavailable")
                    emit(" " + phrase(turn.language, "error"))
                elif event.type == "done":
                    finished = True
        except (BridgeError, aiohttp.ClientError):
            log.error("voice turn stream failed")
            if not await self.publish_voice_error(turn.session_id, "SESSION_AGENT_UNAVAILABLE", turn.id):
                await self.publish(error="agent_unavailable")
            if not spoke:
                emit(phrase(turn.language, "error"))
            finished = True
        finally:
            if pending is not None:
                pending.cancel()
                # The generator must be idle before it can be closed.
                with contextlib.suppress(BaseException):
                    await pending
            await stream.aclose()
            if finished:
                await self.publish(task="idle", attention="")
            else:
                # Speech was interrupted or superseded; the Unifia run goes on.
                self._watch_detached(turn, tracker, spoke_long=acked or bool(tracker.tools_started))

    def _watch_detached(self, turn: VoiceTurn, tracker: _TurnTracker, spoke_long: bool) -> None:
        async def watch() -> None:
            try:
                tracker.busy_seen = True
                async for event in self.bridge.submit(turn, tracker):
                    if event.type == "done":
                        break
                if self.latest_turn == turn.id:
                    await self.publish(task="idle")
                if not spoke_long or self.latest_turn != turn.id or self.session is None:
                    return
                final = await self.bridge.final_text(turn.session_id or "", turn.message_id)
                summary = summarize(final, turn.language)
                if summary:
                    self.session.say(summary, add_to_chat_ctx=False)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                log.warning("detached turn watcher stopped: %s", error)

        task = asyncio.create_task(watch())
        self._watchers.add(task)
        task.add_done_callback(self._watchers.discard)

    async def aclose(self) -> None:
        for task in list(self._watchers):
            task.cancel()
        await self.router.aclose()

    # -- speech output ------------------------------------------------------

    async def speak(self, text: AsyncIterable[str]) -> AsyncIterator[rtc.AudioFrame]:
        language = self.language()
        segmenter = SpeechSegmenter()
        resamplers: dict[int, rtc.AudioResampler] = {}

        async def segments() -> AsyncIterator[Segment]:
            async for delta in text:
                for segment in segmenter.push(delta):
                    yield segment
            for segment in segmenter.flush():
                yield segment

        async for segment in segments():
            spoken = segment_text(segment, language)
            if not spoken:
                continue
            request = SynthesisRequest(
                id=ascending_id("tts"),
                text=spoken,
                language=language,
                voice=self.voices.get(language),
                speed=self.speed,
            )
            try:
                async for chunk in self.router.synthesize(request):
                    for frame in pcm_frames(chunk, resamplers):
                        if self._first_audio_pending and self._turn_ended_at is not None:
                            self._first_audio_pending = False
                            metric("voice.end_to_end.ms", (time.monotonic() - self._turn_ended_at) * 1000)
                        yield frame
            except Exception as error:
                log.error("speech output unavailable: %s", error)
                await self.publish(tts="unavailable", error="tts_unavailable")
                return
            finally:
                request.cancel.set()


def summarize(text: str, language: str) -> str:
    segmenter = SpeechSegmenter()
    parts: list[str] = []
    for segment in [*segmenter.push(text), *segmenter.flush()]:
        spoken = segment_text(segment, language)
        if spoken:
            parts.append(spoken)
        if len(parts) >= SUMMARY_SEGMENTS:
            break
    return " ".join(parts)


class UnifiaLLM(llm.LLM):
    """Forwards finalized user turns to the Unifia session; no model of its own."""

    def __init__(self, conversation: LiveConversation) -> None:
        super().__init__()
        self._conversation = conversation

    @property
    def model(self) -> str:
        return "unifia-session"

    @property
    def provider(self) -> str:
        return "unifia"

    def chat(
        self,
        *,
        chat_ctx: llm.ChatContext,
        tools: list[llm.Tool] | None = None,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
        **_: Any,
    ) -> "UnifiaLLMStream":
        return UnifiaLLMStream(self, self._conversation, chat_ctx=chat_ctx, tools=[], conn_options=conn_options)


class UnifiaLLMStream(llm.LLMStream):
    def __init__(self, owner: UnifiaLLM, conversation: LiveConversation, **kwargs: Any) -> None:
        super().__init__(owner, **kwargs)
        self._conversation = conversation
        self._id = utils.shortuuid("unifia_")

    async def _run(self) -> None:
        user = next(
            (
                item
                for item in reversed(self._chat_ctx.items)
                if getattr(item, "type", None) == "message" and getattr(item, "role", None) == "user"
            ),
            None,
        )
        if user is None:
            return

        def emit(text: str) -> None:
            self._event_ch.send_nowait(
                llm.ChatChunk(id=self._id, delta=llm.ChoiceDelta(role="assistant", content=text))
            )

        await self._conversation.run_turn(user, emit)


class UnifiaTTS(tts.TTS):
    """TtsRouter as a LiveKit TTS; used for ``session.say`` summaries."""

    def __init__(self, conversation: LiveConversation) -> None:
        super().__init__(capabilities=tts.TTSCapabilities(streaming=False), sample_rate=OUTPUT_RATE, num_channels=1)
        self._conversation = conversation

    def synthesize(
        self, text: str, *, conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS
    ) -> "UnifiaChunkedStream":
        return UnifiaChunkedStream(tts=self, input_text=text, conn_options=conn_options)


class UnifiaChunkedStream(tts.ChunkedStream):
    async def _run(self, output_emitter: tts.AudioEmitter) -> None:
        conversation: LiveConversation = self._tts._conversation  # type: ignore[attr-defined]
        output_emitter.initialize(
            request_id=utils.shortuuid(), sample_rate=OUTPUT_RATE, num_channels=1, mime_type="audio/pcm"
        )

        async def once() -> AsyncIterator[str]:
            yield self.input_text

        async for frame in conversation.speak(once()):
            output_emitter.push(bytes(frame.data))
        output_emitter.flush()


class UnifiaVoiceAgent(Agent):
    def __init__(self, conversation: LiveConversation) -> None:
        super().__init__(instructions="Unifia voice relay")
        self._conversation = conversation

    def tts_node(
        self, text: AsyncIterable[str], model_settings: ModelSettings
    ) -> AsyncIterable[rtc.AudioFrame]:
        return self._conversation.speak(text)


@dataclass
class SharedResources:
    """Models shared by every Live room of this process (one copy each).

    ``voice_resource_scheduler`` (R11 desktop convergence, ADR-074)
    owns model leases across memory / thermal / GPU pressure. Optional
    on legacy call sites that predate the R13 wiring — production
    callers should always supply it.
    """

    vad: Any
    recognizer: Any
    router_factory: Callable[[Callable[[RouteRecord], None]], TtsRouter]
    voice_resource_scheduler: Any | None = None
    vad_ready: bool = False
    turn_detector_ready: bool = False


_resources: SharedResources | None = None
_resources_lock = threading.Lock()


def shared_resources(loader: Callable[[], SharedResources]) -> SharedResources:
    global _resources
    with _resources_lock:
        if _resources is None:
            _resources = loader()
        return _resources


async def fetch_binding(
    endpoint: ServerEndpoint, binding_id: str, http: aiohttp.ClientSession
) -> tuple[LiveBinding, dict[str, Any]]:
    async with http.get(
        f"{endpoint.url}/voice/live/bindings/{binding_id}",
        headers={"Authorization": endpoint.auth_header()},
        timeout=aiohttp.ClientTimeout(total=10),
    ) as response:
        if response.status != 200:
            raise BridgeError(f"binding lookup -> HTTP {response.status}")
        data = await response.json()
    return LiveBinding.from_json(data), data


async def run_job(
    ctx: JobContext,
    endpoint: ServerEndpoint,
    resources: SharedResources,
    turn_detector: Callable[[], Any],
) -> None:
    metadata = json.loads(ctx.job.metadata or "{}")
    binding_id = str(metadata.get("binding") or "")
    if not BINDING_ID.match(binding_id):
        log.error("refusing Live job without a valid binding")
        return
    connected_at = time.monotonic()
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    http = aiohttp.ClientSession()
    ctx.add_shutdown_callback(http.close)
    try:
        binding, raw = await fetch_binding(endpoint, binding_id, http)
    except (BridgeError, aiohttp.ClientError):
        log.error("Live binding unavailable")
        await ctx.room.local_participant.set_attributes({"unifia.error": "binding_invalid"})
        ctx.shutdown("binding_invalid")
        return
    if raw.get("room") != ctx.room.name:
        log.error("Live binding does not match its room")
        ctx.shutdown("binding_mismatch")
        return
    if resources.recognizer is None:
        published = bool(binding.session_id) and await publish_voice_error_event(
            ctx.room.local_participant,
            session_id=binding.session_id or "",
            sequence=0,
            stage="stt",
            code="STT_PROVIDER_UNAVAILABLE",
        )
        if not published:
            if binding.session_id:
                log.warning("could not publish startup STT error event")
            await ctx.room.local_participant.set_attributes({"unifia.error": "stt_unavailable"})
        log.error("Parakeet unavailable")
        await asyncio.sleep(3)
        ctx.shutdown("stt_unavailable")
        return
    if resources.vad is None or not resources.vad_ready:
        if not binding.session_id or not await publish_voice_error_event(
            ctx.room.local_participant,
            session_id=binding.session_id,
            sequence=0,
            stage="vad",
            code="VAD_PROVIDER_UNAVAILABLE",
        ):
            await ctx.room.local_participant.set_attributes({"unifia.error": "voice_internal_error"})
        ctx.shutdown("vad_unavailable")
        return

    languages = LanguageRouter(preference=binding.language, application_locale=binding.locale)
    conversation: LiveConversation
    router = resources.router_factory(lambda record: conversation.on_route(record))
    conversation = LiveConversation(
        room=ctx.room,
        bridge=VoiceAgentBridge(endpoint, binding, http),
        router=router,
        languages=languages,
        voices={k: v for k, v in (raw.get("voices") or {}).items() if isinstance(v, str)},
        speed=float(raw.get("speed") or 1.0),
    )
    ctx.add_shutdown_callback(conversation.aclose)
    try:
        await conversation.bridge.probe()
    except (BridgeError, aiohttp.ClientError):
        published = bool(binding.session_id) and await conversation.publish_voice_error(
            binding.session_id or "", "SESSION_AGENT_UNAVAILABLE"
        )
        if not published:
            await conversation.publish(error="agent_unavailable")
        ctx.shutdown("agent_unavailable")
        return
    try:
        detection = turn_detector()
    except Exception:
        detection = None
    if detection is None or not resources.turn_detector_ready:
        published = bool(binding.session_id) and await conversation.publish_voice_error(
            binding.session_id or "", "TURN_DETECTOR_UNAVAILABLE", stage="turn-detection"
        )
        if not published:
            await conversation.publish(error="voice_internal_error")
        ctx.shutdown("turn_detection_unavailable")
        return
    session = AgentSession(
        stt=ParakeetSTT(resources.recognizer, languages),
        vad=resources.vad,
        llm=UnifiaLLM(conversation),
        tts=UnifiaTTS(conversation),
        turn_handling={
            "turn_detection": detection,
            # VAD interruption (the adaptive detector is a cloud feature):
            # 0.3 s of speech stops the assistant; coughs and clicks do not.
            "interruption": {"enabled": True, "mode": "vad", "min_duration": 0.3},
            "preemptive_generation": {"enabled": False},
        },
        tts_text_transforms=None,
        conn_options=SessionConnectOptions(
            llm_conn_options=APIConnectOptions(max_retry=0, timeout=3600),
            tts_conn_options=APIConnectOptions(max_retry=0, timeout=120),
            stt_conn_options=APIConnectOptions(max_retry=0, timeout=60),
        ),
        user_away_timeout=None,
        # LiveKit ignores barge-in for this long after the assistant starts
        # speaking (3 s by default) so echo cannot interrupt it before WebRTC
        # echo cancellation converges; 3 s would make early barge-in impossible.
        aec_warmup_duration=AEC_WARMUP_SECONDS,
    )
    conversation.session = session
    interrupt_started: list[float] = []

    @session.on("user_state_changed")
    def _user_state(event: Any) -> None:
        if event.new_state == "speaking" and session.agent_state == "speaking":
            interrupt_started.append(time.monotonic())

    @session.on("agent_state_changed")
    def _agent_state(event: Any) -> None:
        if event.old_state == "speaking" and event.new_state != "speaking" and interrupt_started:
            metric("voice.interrupt.ms", (time.monotonic() - interrupt_started.pop()) * 1000)
            interrupt_started.clear()

    if await _warm_tts(router, conversation.language(), conversation.voices) is None:
        published = bool(binding.session_id) and await conversation.publish_voice_error(
            binding.session_id or "", "TTS_PROVIDER_UNAVAILABLE", stage="tts"
        )
        if not published:
            if binding.session_id:
                log.warning("could not publish startup TTS error event")
            await conversation.publish(error="tts_unavailable")
        ctx.shutdown("tts_unavailable")
        return

    try:
        session_id = await conversation.bridge.ensure_session()
    except (BridgeError, aiohttp.ClientError, KeyError, TypeError):
        log.error("Live could not bind an Unifia session")
        await conversation.publish(error="agent_unavailable")
        ctx.shutdown("agent_unavailable")
        return

    try:
        await session.start(
            agent=UnifiaVoiceAgent(conversation),
            room=ctx.room,
            room_options=room_io.RoomOptions(close_on_disconnect=False),
            record=False,
        )
    except Exception:
        log.error("Live voice session failed during startup")
        if not await conversation.publish_voice_error(session_id, "SESSION_AGENT_UNAVAILABLE"):
            await conversation.publish(error="agent_unavailable")
        ctx.shutdown("agent_unavailable")
        return
    if not await conversation.publish_voice_ready(session_id):
        if not await conversation.publish_voice_error(session_id, "SESSION_AGENT_UNAVAILABLE"):
            await conversation.publish(error="agent_unavailable")
        ctx.shutdown("agent_unavailable")
        return
    metric("voice.connect.ms", (time.monotonic() - connected_at) * 1000)
    await conversation.publish(
        session=session_id, task="idle", language=conversation.language(), error=""
    )
    # The job outlives this function; the watcher only ends it once the user
    # has been gone past the grace period (network drops keep the job).
    watcher = asyncio.create_task(_end_when_room_empty(ctx))
    ctx.add_shutdown_callback(lambda: _cancel(watcher))


async def _cancel(task: asyncio.Task[None]) -> None:
    task.cancel()


async def _warm_tts(router: TtsRouter, language: str, voices: dict[str, str]) -> str | None:
    for name in router.order():
        try:
            await router.backends[name].prepare(language, voices.get(language))
            return name
        except Exception:
            log.warning("TTS warmup failed for provider %s", name)
    return None


async def _end_when_room_empty(ctx: JobContext) -> None:
    """Keep the job through network drops; end it once the user has left for good."""
    empty_since: float | None = None
    while ctx.room.isconnected():
        if ctx.room.remote_participants:
            empty_since = None
        elif empty_since is None:
            empty_since = time.monotonic()
        elif time.monotonic() - empty_since > EMPTY_ROOM_GRACE_SECONDS:
            ctx.shutdown("room_empty")
            return
        await asyncio.sleep(1)

