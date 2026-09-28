import asyncio
import json
import sys
import tempfile
import textwrap
import threading
import unittest
from pathlib import Path

import numpy as np
from aiohttp import web

from voice_host.live.bridge import BridgeError, LiveBinding, ServerEndpoint, VoiceAgentBridge, _TurnTracker
from voice_host.live.tts import PcmChunk, PiperBackend, PocketBackend, SynthesisRequest, TtsRouter, float32_to_s16le
from voice_host.live.turns import TurnLedger, VoiceTurn, ascending_id, turn_id_for


def turn(**overrides):
    values = dict(
        id="vt_1", session_id="ses_1", device_id="dev_1", transcript="hello", language="en",
        started_at=0.0, ended_at=1.0, message_id="msg_0000000000011abcdefghijklmn",
    )
    values.update(overrides)
    return VoiceTurn(**values)


class TurnTests(unittest.TestCase):
    def test_ascending_ids_sort_like_server_ids(self):
        ids = [ascending_id("msg", now_ms=1_700_000_000_000) for _ in range(5)]
        self.assertEqual(ids, sorted(ids))
        self.assertTrue(all(i.startswith("msg_") and len(i) == 4 + 26 for i in ids))
        later = ascending_id("msg", now_ms=1_700_000_000_001)
        self.assertGreater(later, ids[-1])

    def test_turn_id_is_stable_and_opaque(self):
        a = turn_id_for("room-x", "device-1", "item_abc")
        self.assertEqual(a, turn_id_for("room-x", "device-1", "item_abc"))
        self.assertNotEqual(a, turn_id_for("room-x", "device-1", "item_abd"))
        self.assertNotIn("device", a)

    def test_ledger_deduplicates_a_resubmitted_turn(self):
        ledger = TurnLedger()
        first = turn()
        self.assertIsNone(ledger.claim(first))
        retry = turn(message_id="msg_other")
        self.assertIs(ledger.claim(retry), first)  # retry reuses the original message id
        self.assertEqual(len(ledger), 1)


class FakeBackend:
    def __init__(self, name, chunks=1, fail_before=False, fail_after=False, rate=24000):
        self.id = name
        self.calls = 0
        self.chunks = chunks
        self.fail_before = fail_before
        self.fail_after = fail_after
        self.rate = rate

    async def prepare(self, language, voice):
        pass

    async def synthesize(self, request):
        self.calls += 1
        if self.fail_before:
            raise RuntimeError(f"{self.id} runtime unavailable")
        for index in range(self.chunks):
            if request.cancel.is_set():
                return
            yield PcmChunk(self.rate, 1, b"\x01\x00" * 480)
            await asyncio.sleep(0)
            if self.fail_after and index == 0:
                raise RuntimeError("mid-utterance failure")

    async def aclose(self):
        pass


async def collect(router, request):
    return [chunk async for chunk in router.synthesize(request)]


class RouterTests(unittest.IsolatedAsyncioTestCase):
    async def test_auto_uses_pocket_when_it_works(self):
        pocket, piper = FakeBackend("pocket"), FakeBackend("piper")
        records = []
        router = TtsRouter({"pocket": pocket, "piper": piper}, on_route=records.append)
        chunks = await collect(router, SynthesisRequest("r1", "hi", "en"))
        self.assertEqual(len(chunks), 1)
        self.assertEqual((pocket.calls, piper.calls), (1, 0))
        self.assertEqual(records[0].resolved, "pocket")
        self.assertIsNone(records[0].fallback_reason)

    async def test_auto_falls_back_to_piper_and_records_why(self):
        pocket, piper = FakeBackend("pocket", fail_before=True), FakeBackend("piper", rate=22050)
        records = []
        router = TtsRouter({"pocket": pocket, "piper": piper}, on_route=records.append)
        chunks = await collect(router, SynthesisRequest("r1", "bonjour", "fr"))
        self.assertEqual(len(chunks), 1)
        self.assertEqual(records[0].resolved, "piper")
        self.assertIn("pocket runtime unavailable", records[0].fallback_reason)
        self.assertEqual(records[0].language, "fr")
        # Pocket is skipped during its cooldown, so the next request starts with Piper.
        self.assertEqual(router.order(), ["piper", "pocket"])

    async def test_explicit_piper_never_starts_pocket(self):
        pocket, piper = FakeBackend("pocket"), FakeBackend("piper")
        router = TtsRouter({"pocket": pocket, "piper": piper}, preference="piper")
        await collect(router, SynthesisRequest("r1", "hi", "en"))
        self.assertEqual(pocket.calls, 0)

    async def test_explicit_pocket_does_not_silently_switch(self):
        router = TtsRouter({"pocket": FakeBackend("pocket", fail_before=True), "piper": FakeBackend("piper")}, preference="pocket")
        with self.assertRaises(RuntimeError):
            await collect(router, SynthesisRequest("r1", "hi", "en"))

    async def test_no_restart_after_audio_started(self):
        pocket, piper = FakeBackend("pocket", chunks=3, fail_after=True), FakeBackend("piper")
        router = TtsRouter({"pocket": pocket, "piper": piper})
        with self.assertRaises(RuntimeError):
            await collect(router, SynthesisRequest("r1", "hi", "en"))
        self.assertEqual(piper.calls, 0)

    async def test_cancel_stops_output(self):
        router = TtsRouter({"pocket": FakeBackend("pocket", chunks=50)})
        request = SynthesisRequest("r1", "hi", "en")
        received = []
        async for chunk in router.synthesize(request):
            received.append(chunk)
            request.cancel.set()
        self.assertEqual(len(received), 1)


class FakePocketWorker:
    def __init__(self):
        self.runtime_ready = True
        self.runtime_error = None
        self.prepared = []
        self.produced = 0
        self.lock = threading.Lock()

    def initialize_runtime(self):
        pass

    def prepare(self, language, voice):
        self.prepared.append((language, voice))

    def stream_pcm(self, text, cancel):
        with self.lock:
            for _ in range(100):
                if cancel.is_set():
                    return
                self.produced += 1
                yield 24000, np.full(1920, 0.5, dtype="<f4").tobytes()


class PocketBackendTests(unittest.IsolatedAsyncioTestCase):
    async def test_streams_int16_and_stops_producer_when_consumer_leaves(self):
        worker = FakePocketWorker()
        backend = PocketBackend(lambda: worker)
        request = SynthesisRequest("r1", "hello", "fr", voice="estelle")
        stream = backend.synthesize(request)
        first = await anext(stream)
        self.assertEqual(first.sample_rate, 24000)
        self.assertEqual(len(first.pcm), 1920 * 2)
        self.assertEqual(np.frombuffer(first.pcm, dtype="<i2")[0], 16383)
        await stream.aclose()  # barge-in closes the generator
        await asyncio.sleep(0.5)
        self.assertLess(worker.produced, 100)  # producer unwound instead of generating everything
        self.assertTrue(worker.lock.acquire(timeout=1))  # model lock released
        worker.lock.release()
        self.assertEqual(worker.prepared, [("fr", "estelle")])

    async def test_unready_runtime_is_an_error(self):
        worker = FakePocketWorker()
        worker.runtime_ready = False
        worker.runtime_error = "torch missing"
        with self.assertRaisesRegex(RuntimeError, "torch missing"):
            await PocketBackend(lambda: worker).prepare("en", None)

    def test_float_conversion_clips(self):
        pcm = float32_to_s16le(np.array([2.0, -2.0, 0.0], dtype="<f4").tobytes())
        self.assertEqual(list(np.frombuffer(pcm, dtype="<i2")), [32767, -32767, 0])


FAKE_PIPER = textwrap.dedent(
    """
    import base64, json, sys
    for line in sys.stdin:
        request = json.loads(line)
        rid = request["id"]
        action = request["action"]
        if action == "prepare":
            print(json.dumps({"id": rid, "type": "prepared", "sampleRate": 22050}), flush=True)
        elif action == "synthesize":
            if request["text"] == "fail":
                print(json.dumps({"id": rid, "type": "error", "message": "voice missing"}), flush=True)
                continue
            for _ in range(3):
                print(json.dumps({"id": rid, "type": "audio", "sampleRate": 22050, "channels": 1,
                                  "encoding": "s16le", "audio": base64.b64encode(b"\\x02\\x00" * 64).decode()}), flush=True)
            print(json.dumps({"id": rid, "type": "complete"}), flush=True)
        elif action == "cancel":
            print(json.dumps({"id": rid, "type": "cancelled", "requestId": request["requestId"]}), flush=True)
    """
)


class PiperBackendTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        script = Path(self.tmp.name) / "fake_piper.py"
        script.write_text(FAKE_PIPER)
        self.backend = PiperBackend([sys.executable, str(script)])

    async def asyncTearDown(self):
        await self.backend.aclose()
        self.tmp.cleanup()

    async def test_streams_audio_over_jsonl(self):
        chunks = [c async for c in self.backend.synthesize(SynthesisRequest("r1", "hallo", "de"))]
        self.assertEqual(len(chunks), 3)
        self.assertEqual(chunks[0].sample_rate, 22050)

    async def test_reports_worker_errors(self):
        with self.assertRaisesRegex(RuntimeError, "voice missing"):
            [c async for c in self.backend.synthesize(SynthesisRequest("r1", "fail", "de"))]


class FakeUnifia:
    """Just enough of the Unifia HTTP API to exercise the bridge end to end."""

    def __init__(self):
        self.prompts = []
        self.sessions = 0
        self.bindings = {}
        self.messages = set()
        self.queues = []
        self.probes = 0

    def app(self):
        app = web.Application()
        app.router.add_get("/session", self.list_sessions)
        app.router.add_get("/provider", self.list_providers)
        app.router.add_post("/session", self.create_session)
        app.router.add_post("/voice/live/bindings/{id}/session", self.bind)
        app.router.add_get("/session/{sid}/message/{mid}", self.get_message)
        app.router.add_post("/session/{sid}/prompt_async", self.prompt)
        app.router.add_get("/event", self.events)
        return app

    def check_auth(self, request):
        assert request.headers["Authorization"].startswith("Basic ")
        assert request.query["directory"] == "/work/project"

    async def create_session(self, request):
        self.check_auth(request)
        self.sessions += 1
        return web.json_response({"id": f"ses_{self.sessions}"})

    async def list_sessions(self, request):
        self.check_auth(request)
        assert request.query["limit"] == "1"
        self.probes += 1
        return web.json_response([])

    async def list_providers(self, request):
        self.check_auth(request)
        return web.json_response({
            "all": [{"id": "local-llm", "models": {"qwen": {"id": "qwen"}}}],
            "connected": ["local-llm"],
        })

    async def bind(self, request):
        self.bindings[request.match_info["id"]] = (await request.json())["sessionID"]
        return web.json_response(True)

    async def get_message(self, request):
        if request.match_info["mid"] in self.messages:
            return web.json_response({"info": {}})
        return web.json_response({"name": "NotFoundError"}, status=404)

    async def prompt(self, request):
        self.check_auth(request)
        body = await request.json()
        sid = request.match_info["sid"]
        self.prompts.append((sid, body))
        self.messages.add(body["messageID"])
        user = body["messageID"]
        script = [
            {"type": "session.status", "properties": {"sessionID": sid, "status": {"type": "busy"}}},
            {"type": "message.updated", "properties": {"info": {"id": "msg_a", "sessionID": sid, "role": "assistant", "parentID": user}}},
            {"type": "message.part.updated", "properties": {"sessionID": sid, "part": {"id": "prt_r", "messageID": "msg_a", "type": "reasoning", "text": ""}}},
            {"type": "message.part.delta", "properties": {"sessionID": sid, "messageID": "msg_a", "partID": "prt_r", "field": "text", "delta": "secret thoughts"}},
            {"type": "message.part.delta", "properties": {"sessionID": sid, "messageID": "msg_a", "partID": "prt_t", "field": "text", "delta": "Hel"}},
            {"type": "message.part.updated", "properties": {"sessionID": sid, "part": {"id": "prt_t", "messageID": "msg_a", "type": "text", "text": "Hel"}}},
            {"type": "message.part.delta", "properties": {"sessionID": sid, "messageID": "msg_a", "partID": "prt_t", "field": "text", "delta": "lo."}},
            {"type": "message.part.updated", "properties": {"sessionID": sid, "part": {"id": "prt_x", "messageID": "msg_a", "type": "tool", "callID": "c1", "tool": "bash", "state": {"status": "running"}}}},
            {"type": "permission.asked", "properties": {"id": "per_1", "sessionID": sid, "permission": "bash"}},
            {"type": "message.part.updated", "properties": {"sessionID": sid, "part": {"id": "prt_x", "messageID": "msg_a", "type": "tool", "callID": "c1", "tool": "bash", "state": {"status": "completed"}}}},
            {"type": "message.part.delta", "properties": {"sessionID": "ses_other", "messageID": "msg_z", "partID": "prt_z", "field": "text", "delta": "not ours"}},
            {"type": "session.status", "properties": {"sessionID": sid, "status": {"type": "idle"}}},
        ]
        for queue in self.queues:
            for event in script:
                await queue.put(event)
        return web.Response(status=204)

    async def events(self, request):
        self.check_auth(request)
        response = web.StreamResponse(headers={"Content-Type": "text/event-stream"})
        await response.prepare(request)
        queue = asyncio.Queue()
        self.queues.append(queue)
        await response.write(f"data: {json.dumps({'type': 'server.connected', 'properties': {}})}\n\n".encode())
        try:
            while True:
                event = await queue.get()
                await response.write(f"data: {json.dumps(event)}\n\n".encode())
        except (asyncio.CancelledError, ConnectionResetError):
            pass
        finally:
            self.queues.remove(queue)
        return response


class BridgeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        import aiohttp

        self.fake = FakeUnifia()
        self.runner = web.AppRunner(self.fake.app(), handler_cancellation=True, shutdown_timeout=1)
        await self.runner.setup()
        site = web.TCPSite(self.runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]
        self.http = aiohttp.ClientSession()
        self.binding = LiveBinding(id="lvb_abcdefghijklmnop", directory="/work/project", agent="build",
                                   model={"providerID": "local-llm", "modelID": "qwen"})
        self.bridge = VoiceAgentBridge(ServerEndpoint(f"http://127.0.0.1:{port}", "unifia", "pw"), self.binding, self.http)

    async def asyncTearDown(self):
        await self.http.close()
        await self.runner.cleanup()

    async def test_first_turn_creates_one_session_and_records_it(self):
        first = await self.bridge.ensure_session()
        second = await self.bridge.ensure_session()
        self.assertEqual(first, second)
        self.assertEqual(self.fake.sessions, 1)
        self.assertEqual(self.fake.bindings["lvb_abcdefghijklmnop"], first)

    async def test_readiness_probe_checks_bridge_without_creating_a_session(self):
        await self.bridge.probe()
        self.assertEqual(self.fake.probes, 1)
        self.assertEqual(self.fake.sessions, 0)

    async def test_readiness_probe_accepts_configured_selected_model_without_creating_a_turn(self):
        await self.bridge.probe_selected_model()
        self.assertEqual(self.fake.sessions, 0)
        self.assertEqual(self.fake.prompts, [])

    async def test_readiness_probe_rejects_unconfigured_selected_model(self):
        self.binding.model = {"providerID": "local-llm", "modelID": "missing"}
        with self.assertRaisesRegex(BridgeError, "selected model is not configured"):
            await self.bridge.probe_selected_model()
        self.assertEqual(self.fake.sessions, 0)
        self.assertEqual(self.fake.prompts, [])

    async def test_turn_streams_only_its_own_answer(self):
        sid = await self.bridge.ensure_session()
        voice_turn = turn(session_id=sid)
        events = [e async for e in self.bridge.submit(voice_turn)]
        text = "".join(e.text for e in events if e.type == "text-delta")
        self.assertEqual(text, "Hello.")  # reasoning and other sessions excluded
        kinds = [e.type for e in events]
        self.assertEqual(kinds.count("tool-start"), 1)
        self.assertEqual(kinds.count("tool-end"), 1)
        self.assertIn("permission-required", kinds)
        self.assertEqual(kinds[-1], "done")
        (session, body), = self.fake.prompts
        self.assertEqual(session, sid)
        self.assertEqual(body["messageID"], voice_turn.message_id)
        self.assertEqual(body["parts"], [{"type": "text", "text": "hello"}])
        self.assertEqual(body["agent"], "build")
        self.assertEqual(body["model"], {"providerID": "local-llm", "modelID": "qwen"})

    async def test_relistening_never_submits_twice(self):
        sid = await self.bridge.ensure_session()
        voice_turn = turn(session_id=sid)
        [e async for e in self.bridge.submit(voice_turn)]
        tracker = _TurnTracker(session_id=sid, user_message_id=voice_turn.message_id)
        stream = self.bridge.submit(voice_turn, tracker)
        listener = asyncio.ensure_future(anext(stream))
        await asyncio.sleep(0.2)
        listener.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await listener
        await stream.aclose()
        self.assertEqual(len(self.fake.prompts), 1)


if __name__ == "__main__":
    unittest.main()
