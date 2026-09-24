"""Real-transport integration test for Live conversation.

Runs a real LiveKit server (the pinned build), the real LiveKit Agents
pipeline (Silero VAD, turn detector v1-mini, room audio I/O), the real
VoiceAgentBridge / SpeechSegmenter / SpeechRenderer / TtsRouter, and a real
WebRTC client. Only the heavy models are doubled — Parakeet (a recognizer
returning a fixed transcript) and the TTS engines (a Pocket that fails and a
Piper stand-in that renders a tone) — and the Unifia server is a scripted
HTTP double speaking the same API. The room token is minted by the Unifia
server's TypeScript code, so the grant format is verified against LiveKit.

Skipped unless UNIFIA_LIVEKIT_SERVER_BIN points to a livekit-server binary.
Input speech is generated with espeak-ng when available.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import unittest
import wave
from pathlib import Path

import numpy as np

LIVEKIT_BIN = os.environ.get("UNIFIA_LIVEKIT_SERVER_BIN")
ESPEAK = shutil.which("espeak-ng")
REPO = Path(__file__).resolve().parents[3]
API_KEY = "APIunifiaintegration"
API_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef"
LONG_ANSWER = (
    "Je regarde les tests qui échouent. "
    "Le premier échec vient du parseur de configuration. "
    "Le deuxième échec vient d'un délai trop court dans le test réseau. "
    "J'ai corrigé les deux problèmes et relancé la suite. "
    "Tout passe maintenant, sauf un test ignoré qui dépend du matériel. "
    "Le correctif complet est visible dans la conversation."
)


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def ipv6_loopback() -> bool:
    try:
        with socket.socket(socket.AF_INET6) as sock:
            sock.bind(("::1", 0))
        return True
    except OSError:
        return False


def livekit_config(port: int, udp: int) -> str:
    # Same shape as livekit_server::config_with_lan_ip (desktop): loopback
    # binds, no TCP ICE, loopback candidates enabled, and a dead loopback STUN
    # server so LiveKit never hands clients its public STUN defaults (pointing it
    # at the UDP mux itself makes ICE time out).
    v6 = ipv6_loopback()
    binds = "  - 127.0.0.1\n" + ("  - ::1\n" if v6 else "")
    ranges = "      - 127.0.0.0/8\n" + ("      - ::1/128\n" if v6 else "")
    return f"""port: {port}
bind_addresses:
{binds}rtc:
  tcp_port: 0
  udp_port: {udp}
  node_ip: 127.0.0.1
  use_external_ip: false
  enable_loopback_candidate: true
  stun_servers:
    - 127.0.0.1:9
  ips:
    includes:
{ranges}keys:
  "{API_KEY}": "{API_SECRET}"
logging:
  level: warn
"""


def mint_token(room: str, identity: str, binding: str) -> str:
    script = (
        "import { mintLiveKitToken } from "
        + json.dumps(str(REPO / "packages/unifia/src/server/routes/voice-live.ts"))
        + "; console.log(mintLiveKitToken({apiKey: process.env.K, apiSecret: process.env.S, identity: process.env.I, room: process.env.R, metadata: JSON.stringify({binding: process.env.B})}).token)"
    )
    env = {**os.environ, "K": API_KEY, "S": API_SECRET, "I": identity, "R": room, "B": binding}
    return subprocess.run(["bun", "-e", script], env=env, check=True, capture_output=True, text=True).stdout.strip()


def speech_pcm48k(text: str, voice: str = "fr") -> np.ndarray:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "speech.wav"
        subprocess.run([ESPEAK, "-v", voice, "-s", "150", "-w", str(path), text], check=True)
        with wave.open(str(path)) as reader:
            rate = reader.getframerate()
            samples = np.frombuffer(reader.readframes(reader.getnframes()), dtype="<i2").astype(np.float32)
    positions = np.linspace(0, samples.shape[0] - 1, int(samples.shape[0] * 48000 / rate))
    return np.interp(positions, np.arange(samples.shape[0]), samples).astype("<i2")


class FakeUnifia:
    def __init__(self, room: str, binding: str) -> None:
        self.room = room
        self.binding = binding
        self.prompts: list[dict] = []
        self.prompt_times: list[float] = []
        self.queues: list[asyncio.Queue] = []
        self.messages: set[str] = set()
        self.session_id: str | None = None

    def app(self):
        from aiohttp import web

        app = web.Application()
        app.router.add_get("/voice/live/bindings/{id}", self.get_binding)
        app.router.add_post("/voice/live/bindings/{id}/session", self.bind_session)
        app.router.add_post("/session", self.create_session)
        app.router.add_get("/session/{sid}/message/{mid}", self.get_message)
        app.router.add_post("/session/{sid}/prompt_async", self.prompt)
        app.router.add_get("/event", self.events)
        return app

    async def get_binding(self, request):
        from aiohttp import web

        assert request.headers["Authorization"].startswith("Basic ")
        if request.match_info["id"] != self.binding:
            return web.json_response({"error": "not_found"}, status=404)
        return web.json_response({
            "id": self.binding, "room": self.room, "directory": "/work/project", "sessionID": self.session_id,
            "agent": "build", "model": {"providerID": "local-llm", "modelID": "qwen"},
            "language": "auto", "locale": "fr-FR", "voices": {}, "speed": 1,
        })

    async def bind_session(self, request):
        from aiohttp import web

        self.session_id = (await request.json())["sessionID"]
        return web.json_response(True)

    async def create_session(self, request):
        from aiohttp import web

        return web.json_response({"id": "ses_live1"})

    async def get_message(self, request):
        from aiohttp import web

        found = request.match_info["mid"] in self.messages
        return web.json_response({"info": {}}, status=200 if found else 404)

    async def prompt(self, request):
        from aiohttp import web

        body = await request.json()
        sid = request.match_info["sid"]
        self.prompts.append(body)
        self.prompt_times.append(time.monotonic())
        self.messages.add(body["messageID"])
        asyncio.create_task(self.answer(sid, body["messageID"]))
        return web.Response(status=204)

    async def push(self, event):
        for queue in list(self.queues):
            await queue.put(event)

    async def answer(self, sid: str, user_id: str) -> None:
        assistant = f"msg_assistant_{len(self.prompts)}"
        await self.push({"type": "session.status", "properties": {"sessionID": sid, "status": {"type": "busy"}}})
        await self.push({"type": "message.updated", "properties": {"info": {"id": assistant, "sessionID": sid, "role": "assistant", "parentID": user_id}}})
        await self.push({"type": "message.part.updated", "properties": {"sessionID": sid, "part": {"id": "prt_tool", "messageID": assistant, "type": "tool", "callID": "c1", "tool": "bash", "state": {"status": "running"}}}})
        await asyncio.sleep(0.2)
        await self.push({"type": "message.part.updated", "properties": {"sessionID": sid, "part": {"id": "prt_tool", "messageID": assistant, "type": "tool", "callID": "c1", "tool": "bash", "state": {"status": "completed"}}}})
        await self.push({"type": "message.part.updated", "properties": {"sessionID": sid, "part": {"id": "prt_text", "messageID": assistant, "type": "text", "text": ""}}})
        for word in LONG_ANSWER.split(" "):
            await self.push({"type": "message.part.delta", "properties": {"sessionID": sid, "messageID": assistant, "partID": "prt_text", "field": "text", "delta": word + " "}})
            await asyncio.sleep(0.01)
        await self.push({"type": "session.status", "properties": {"sessionID": sid, "status": {"type": "idle"}}})

    async def events(self, request):
        from aiohttp import web

        response = web.StreamResponse(headers={"Content-Type": "text/event-stream"})
        await response.prepare(request)
        queue: asyncio.Queue = asyncio.Queue()
        self.queues.append(queue)
        await response.write(b'data: {"type":"server.connected","properties":{}}\n\n')
        try:
            while True:
                event = await queue.get()
                await response.write(f"data: {json.dumps(event)}\n\n".encode())
        except (asyncio.CancelledError, ConnectionResetError):
            pass
        finally:
            self.queues.remove(queue)
        return response


class FixedRecognizer:
    def __init__(self) -> None:
        self.calls: list[int] = []

    def recognize(self, waveform, sample_rate=16000):
        self.calls.append(int(waveform.size))
        return "Peux-tu vérifier les tests qui échouent dans le projet ?"


class FailingPocket:
    id = "pocket"

    async def prepare(self, language, voice):
        raise RuntimeError("Pocket runtime unavailable")

    async def synthesize(self, request):
        raise RuntimeError("Pocket runtime unavailable")
        yield  # pragma: no cover

    async def aclose(self):
        pass


class TonePiper:
    """Piper stand-in: 1 s of tone per segment, streamed in 20 ms chunks."""

    id = "piper"

    def __init__(self) -> None:
        self.segments: list[str] = []

    async def prepare(self, language, voice):
        pass

    async def synthesize(self, request):
        from voice_host.live.tts import PcmChunk

        self.segments.append(request.text)
        rate = 22050
        tone = (np.sin(2 * np.pi * 330 * np.arange(rate // 50) / rate) * 9000).astype("<i2").tobytes()
        for _ in range(50):
            if request.cancel.is_set():
                return
            yield PcmChunk(rate, 1, tone)
            await asyncio.sleep(0.005)

    async def aclose(self):
        pass


@unittest.skipUnless(LIVEKIT_BIN and ESPEAK and shutil.which("bun"), "needs livekit-server, espeak-ng and bun")
class LiveTransportIntegration(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        from aiohttp import web

        self.tmp = tempfile.TemporaryDirectory()
        port, udp = free_port(), free_port()
        config = Path(self.tmp.name) / "livekit.yaml"
        config.write_text(livekit_config(port, udp))
        env = {k: v for k, v in os.environ.items() if "proxy" not in k.lower()}
        self.livekit = subprocess.Popen([LIVEKIT_BIN, "--config", str(config)], env=env,
                                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.url = f"ws://127.0.0.1:{port}"
        for _ in range(100):
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                    break
            except OSError:
                await asyncio.sleep(0.1)
        self.room_name = "unifia-live-integrationroom0001"
        self.binding = "lvb_" + "a" * 32
        self.fake = FakeUnifia(self.room_name, self.binding)
        self.runner = web.AppRunner(self.fake.app(), handler_cancellation=True, shutdown_timeout=1)
        await self.runner.setup()
        site = web.TCPSite(self.runner, "127.0.0.1", 0)
        await site.start()
        self.server_url = f"http://127.0.0.1:{site._server.sockets[0].getsockname()[1]}"
        self.recognizer = FixedRecognizer()
        self.piper = TonePiper()
        self.routes = []
        self.agent_thread_error: list[BaseException] = []
        self.agent_loop_ready = threading.Event()
        self.agent_thread = threading.Thread(target=self.run_agent, daemon=True)
        self.agent_thread.start()
        self.assertTrue(self.agent_loop_ready.wait(30), "agent worker did not register")

    def run_agent(self):
        from livekit.agents import AgentServer, JobContext, JobExecutorType, inference

        from voice_host.live import agent as live_agent
        from voice_host.live.bridge import ServerEndpoint
        from voice_host.live.tts import TtsRouter

        os.environ["LIVEKIT_AGENT_NAME"] = live_agent.AGENT_NAME
        resources = live_agent.SharedResources(
            vad=inference.VAD(model="silero"),
            recognizer=self.recognizer,
            stt_error=None,
            router_factory=lambda on_route: TtsRouter(
                {"pocket": FailingPocket(), "piper": self.piper},
                on_route=lambda record: (self.routes.append(record), on_route(record)),
            ),
        )
        endpoint = ServerEndpoint(self.server_url, "unifia", "pw")

        async def main():
            server = AgentServer(job_executor_type=JobExecutorType.THREAD, num_idle_processes=0, load_threshold=1.0,
                                 ws_url=self.url, api_key=API_KEY, api_secret=API_SECRET, host="127.0.0.1", port=0,
                                 http_proxy=None)

            @server.rtc_session()
            async def entrypoint(ctx: JobContext):
                await live_agent.run_job(ctx, endpoint, resources, lambda: inference.TurnDetector(version="v1-mini"))

            server.on("worker_registered", lambda *_: self.agent_loop_ready.set())
            self.agent_server = server
            self.agent_loop = asyncio.get_running_loop()
            await server.run()

        try:
            asyncio.run(main())
        except BaseException as error:  # surfaced by the test
            self.agent_thread_error.append(error)

    async def asyncTearDown(self):
        if getattr(self, "agent_loop", None):
            asyncio.run_coroutine_threadsafe(self.agent_server.aclose(), self.agent_loop)
        self.agent_thread.join(10)
        await self.runner.cleanup()
        self.livekit.terminate()
        try:
            self.livekit.wait(5)
        except subprocess.TimeoutExpired:
            self.livekit.kill()
            self.livekit.wait(5)
        self.tmp.cleanup()

    async def connect_client(self, identity="device-integration"):
        from livekit import rtc

        room = rtc.Room()
        received = {"frames": 0, "loud": 0, "last_loud": 0.0}
        attributes: dict[str, str] = {}

        async def consume(track):
            async for event in rtc.AudioStream(track, sample_rate=48000, num_channels=1):
                received["frames"] += 1
                if np.abs(np.frombuffer(event.frame.data, dtype=np.int16)).mean() > 500:
                    received["loud"] += 1
                    received["last_loud"] = time.monotonic()

        room.on("track_subscribed", lambda track, *_: asyncio.ensure_future(consume(track)) if track.kind == rtc.TrackKind.KIND_AUDIO else None)
        room.on("participant_attributes_changed", lambda changed, participant: attributes.update(participant.attributes))
        started = time.monotonic()
        await room.connect(self.url, mint_token(self.room_name, identity, self.binding))
        connect_ms = (time.monotonic() - started) * 1000
        source = rtc.AudioSource(48000, 1)
        track = rtc.LocalAudioTrack.create_audio_track("microphone", source)
        await room.local_participant.publish_track(track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE))
        return room, source, received, attributes, connect_ms

    async def pump(self, source, samples: np.ndarray, silence_seconds: float) -> None:
        from livekit import rtc

        frame = 480
        padded = np.concatenate([samples, np.zeros(int(48000 * silence_seconds), dtype="<i2")])
        started = time.monotonic()
        for index, offset in enumerate(range(0, padded.shape[0] - frame, frame)):
            await source.capture_frame(rtc.AudioFrame(padded[offset:offset + frame].tobytes(), 48000, 1, frame))
            delay = started + (index + 1) * 0.01 - time.monotonic()
            if delay > 0:
                await asyncio.sleep(delay)

    async def wait_for(self, predicate, timeout: float, message: str):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if predicate():
                return
            await asyncio.sleep(0.05)
        self.fail(message)

    async def test_live_turn_barge_in_and_reconnect(self):
        speech = speech_pcm48k("Bonjour, peux-tu vérifier les tests qui échouent dans le projet ?")
        room, source, received, attributes, connect_ms = await self.connect_client()
        await self.wait_for(lambda: attributes.get("lk.agent.state") == "listening", 30, "agent never listened")

        # Turn 1: real VAD + turn detector end the utterance; the transcript
        # reaches the scripted Unifia session exactly once, with the binding's model.
        pump = asyncio.ensure_future(self.pump(source, speech, silence_seconds=2))
        await self.wait_for(lambda: len(self.fake.prompts) == 1, 30, "turn never reached the Unifia session")
        prompt = self.fake.prompts[0]
        self.assertEqual(prompt["parts"], [{"type": "text", "text": "Peux-tu vérifier les tests qui échouent dans le projet ?"}])
        self.assertEqual(prompt["model"], {"providerID": "local-llm", "modelID": "qwen"})
        self.assertEqual(prompt["agent"], "build")
        self.assertTrue(prompt["messageID"].startswith("msg_"))
        self.assertEqual(self.fake.session_id, "ses_live1")  # first voice turn created and bound the session

        # The answer is spoken: Pocket fails, Piper takes over, audio arrives.
        await self.wait_for(lambda: received["loud"] > 20, 30, "no assistant audio received")
        self.assertEqual(self.routes[0].resolved, "piper")
        self.assertIn("pocket", self.routes[0].fallback_reason)
        self.assertEqual(attributes.get("unifia.session"), "ses_live1")
        spoken = " ".join(self.piper.segments)
        self.assertNotIn("```", spoken)
        await pump

        # Barge-in: the user talks over a long answer; playback stops and the
        # new turn is accepted as a second prompt.
        await self.wait_for(lambda: attributes.get("lk.agent.state") in ("speaking", "listening"), 10, "agent state lost")
        await self.wait_for(lambda: time.monotonic() - received["last_loud"] < 0.1, 10, "assistant not speaking before barge-in")
        segments_before = len(self.piper.segments)
        interrupt_at = time.monotonic()
        pump = asyncio.ensure_future(self.pump(source, speech, silence_seconds=6))
        await asyncio.sleep(2.0)
        # Playback stopped shortly after the user started talking.
        stopped_after_ms = (received["last_loud"] - interrupt_at) * 1000
        self.assertLess(stopped_after_ms, 1500)
        await self.wait_for(lambda: len(self.fake.prompts) == 2, 40, "second turn not accepted after barge-in")
        await pump
        self.assertGreaterEqual(len(self.piper.segments), segments_before)

        # Reconnect with the same binding: no turn is submitted again.
        await room.disconnect()
        room, source, received, attributes, reconnect_ms = await self.connect_client()
        await asyncio.sleep(3)
        self.assertEqual(len(self.fake.prompts), 2)
        await room.disconnect()
        self.assertEqual(self.agent_thread_error, [])
        print(json.dumps({
            "connect_ms": round(connect_ms), "reconnect_ms": round(reconnect_ms),
            "stt_calls": self.recognizer.calls, "segments": len(self.piper.segments),
            "playback_stopped_after_user_speech_ms": round(stopped_after_ms),
            "speech_seconds": round(speech.shape[0] / 48000, 2),
            "second_prompt_after_speech_end_ms": round((self.fake.prompt_times[1] - interrupt_at) * 1000 - speech.shape[0] / 48),
        }))


if __name__ == "__main__":
    unittest.main()
