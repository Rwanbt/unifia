import io
import json
import threading
import queue
import time
import unittest
from unittest.mock import patch

from voice_host.worker import ActiveRequest, LANGUAGES, PocketWorker, main


class PendingModel:
    def generate_audio_stream(self, _voice_state, _text):
        yield None


class WaitingModel:
    sample_rate = 24000

    def __init__(self):
        self.started = threading.Event()
        self.resume = threading.Event()

    def generate_audio_stream(self, _voice_state, _text):
        self.started.set()
        self.resume.wait(timeout=2)
        yield FakePcm()


class FakePcm:
    def detach(self):
        return self

    def cpu(self):
        return self

    def numpy(self):
        return self

    def astype(self, _dtype, copy=False):
        return self

    def tobytes(self):
        return b"\x00\x00\x80?"


class SwitchableModel:
    sample_rate = 24000

    def get_state_for_audio_prompt(self, _voice):
        return object()

    def generate_audio_stream(self, _state, _text):
        yield FakePcm()


class SwitchableModelFactory:
    @staticmethod
    def load_model(**_options):
        return SwitchableModel()


class PocketWorkerContractTests(unittest.TestCase):
    def wait_for_operations(self, worker):
        deadline = time.monotonic() + 2
        while worker.operations.unfinished_tasks and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertEqual(worker.operations.unfinished_tasks, 0)

    def test_health_reports_process_liveness_without_runtime_or_model_readiness(self):
        worker = PocketWorker()

        with patch("voice_host.worker.process_memory_usage", return_value=(4096, 8192)), patch("voice_host.worker.emit") as emit:
            worker.handle({"id": "health-1", "action": "health"})

        self.assertEqual(
            emit.call_args.args[0],
            {
                "id": "health-1",
                "type": "health",
                "provider": "pocket",
                "alive": True,
                "runtimeReady": False,
                "runtimeError": None,
                "modelLoaded": False,
                "language": None,
                "voiceReady": False,
                "workingSetBytes": 4096,
                "peakWorkingSetBytes": 8192,
            },
        )

    def test_health_reports_loaded_language_and_voice_state(self):
        worker = PocketWorker()
        worker.runtime_ready = True
        worker.model = PendingModel()
        worker.language = "fr"
        worker.voice_state = object()

        with patch("voice_host.worker.process_memory_usage", return_value=(4096, 8192)):
            health = worker.health()
        self.assertEqual(
            health,
            {
                "alive": True,
                "runtimeReady": True,
                "runtimeError": None,
                "modelLoaded": True,
                "language": "fr",
                "voiceReady": True,
                "workingSetBytes": 4096,
                "peakWorkingSetBytes": 8192,
            },
        )

    def test_prepare_fails_closed_until_runtime_imports_are_ready(self):
        with self.assertRaisesRegex(RuntimeError, "Pocket runtime is not ready"):
            PocketWorker().prepare("en", "alba")

    def test_required_languages_have_explicit_model_routes(self):
        self.assertEqual(
            LANGUAGES,
            {
                "en": "english",
                "fr": "french_24l",
                "es": "spanish_24l",
                "it": "italian_24l",
                "de": "german_24l",
            },
        )

    def test_unknown_language_fails_before_loading_a_model(self):
        with self.assertRaisesRegex(ValueError, "Unsupported language"):
            PocketWorker().prepare("pt", "alba")

    def test_cancel_before_worker_dequeue_stays_attached_to_request(self):
        worker = PocketWorker()
        worker.model = PendingModel()
        worker.voice_state = object()
        cancel = threading.Event()
        cancel.set()
        worker.requests["request-1"] = ActiveRequest(cancel)

        with patch("voice_host.worker.emit") as emit:
            worker.synthesize({"id": "request-1", "text": "hello"})

        self.assertEqual(emit.call_args.args[0]["type"], "cancelled")
        self.assertNotIn("request-1", worker.requests)

    def test_cancel_during_generation_stops_before_encoding_next_frame(self):
        worker = PocketWorker()
        model = WaitingModel()
        worker.model = model
        worker.voice_state = object()
        operations = threading.Thread(target=worker.run_operations)

        with patch("voice_host.worker.emit") as emit:
            operations.start()
            worker.handle({"id": "request-2", "action": "synthesize", "text": "hello"})
            self.assertTrue(model.started.wait(timeout=1))
            worker.handle({"id": "cancel-2", "action": "cancel", "requestId": "request-2"})
            model.resume.set()
            worker.operations.put(None)
            operations.join(timeout=1)

        self.assertFalse(operations.is_alive())
        emitted = [call.args[0] for call in emit.call_args_list]
        self.assertTrue(any(item.get("id") == "request-2" and item.get("type") == "cancelled" for item in emitted))
        self.assertNotIn("request-2", worker.requests)

    def test_duplicate_pending_request_id_is_rejected_without_releasing_first_request(self):
        worker = PocketWorker()
        with patch("voice_host.worker.emit") as emit:
            worker.handle({"id": "duplicate", "action": "prepare"})
            worker.handle({"id": "duplicate", "action": "prepare"})

        self.assertIn("duplicate", worker.pending_ids)
        self.assertEqual(worker.operations.qsize(), 1)
        self.assertEqual(emit.call_args.args[0]["type"], "error")
        self.assertIn("Duplicate request id", emit.call_args.args[0]["message"])

    def test_oversized_synthesis_text_is_rejected_before_queueing(self):
        worker = PocketWorker()
        with patch("voice_host.worker.emit") as emit:
            worker.handle({"id": "oversized", "action": "synthesize", "text": "x" * (1024 * 1024)})

        self.assertEqual(worker.operations.qsize(), 0)
        self.assertNotIn("oversized", worker.pending_ids)
        self.assertEqual(emit.call_args.args[0]["type"], "error")
        self.assertIn("IPC limit", emit.call_args.args[0]["message"])

    def test_full_operation_queue_releases_request_identity(self):
        worker = PocketWorker()
        worker.operations = queue.Queue(maxsize=1)
        worker.operations.put({"id": "occupying", "action": "dispose"})
        with patch("voice_host.worker.emit") as emit:
            worker.handle({"id": "queued", "action": "prepare"})

        self.assertNotIn("queued", worker.pending_ids)
        self.assertEqual(emit.call_args.args[0]["type"], "error")

    def test_invalidation_only_clears_matching_clone_state(self):
        worker = PocketWorker()
        worker.voice_state = object()
        worker.voice = "clone:alba:en"
        worker.voice_name = "alba"
        operations = threading.Thread(target=worker.run_operations)

        with patch("voice_host.worker.emit") as emit:
            operations.start()
            worker.handle({"id": "invalidate-other", "action": "invalidate_voice", "voice": "other"})
            worker.handle({"id": "invalidate-alba", "action": "invalidate_voice", "voice": "alba"})
            worker.operations.put(None)
            operations.join(timeout=1)

        self.assertFalse(operations.is_alive())
        self.assertIsNone(worker.voice_state)
        self.assertIsNone(worker.voice_name)
        self.assertEqual([call.args[0]["type"] for call in emit.call_args_list], ["invalidated", "invalidated"])

    def test_main_reports_malformed_and_oversized_lines_then_continues(self):
        input_stream = io.TextIOWrapper(
            io.BytesIO(
                b'{malformed}\n'
                + b'{"id":"oversized","action":"health"}' + b" " * (1024 * 1024) + b"\n"
                + b'{"id":"unknown-action","action":"unknown"}\n'
                + b'{"id":"health-after-error","action":"health"}\n'
            ),
            encoding="utf-8",
        )
        output_stream = io.StringIO()
        with (
            patch("sys.stdin", input_stream),
            patch("sys.stdout", output_stream),
            patch("voice_host.worker.PocketWorker.initialize_runtime"),
            patch("voice_host.worker.process_memory_usage", return_value=(4096, 8192)),
        ):
            main()

        responses = [json.loads(line) for line in output_stream.getvalue().splitlines()]
        self.assertEqual(len(responses), 4)
        self.assertEqual(responses[0]["type"], "error")
        self.assertIn("IPC limit", responses[1]["message"])
        self.assertIn("Unknown action", responses[2]["message"])
        self.assertEqual(responses[3]["type"], "health")
        self.assertEqual(responses[3]["id"], "health-after-error")

    def test_prepare_waits_for_active_synthesis_without_model_state_overlap(self):
        worker = PocketWorker()
        model = WaitingModel()
        worker.runtime_ready = True
        worker.tts_model_type = SwitchableModelFactory
        worker.default_voice_for_language = lambda _language: "alba"
        worker.model = model
        worker.language = "en"
        worker.voice_state = object()
        operations = threading.Thread(target=worker.run_operations)

        with patch("voice_host.worker.emit") as emit:
            operations.start()
            worker.handle({"id": "speak-en", "action": "synthesize", "text": "hello"})
            self.assertTrue(model.started.wait(timeout=1))
            worker.handle({"id": "prepare-fr", "action": "prepare", "language": "fr", "voice": "estelle"})
            model.resume.set()
            self.wait_for_operations(worker)
            worker.operations.put(None)
            operations.join(timeout=1)

        self.assertFalse(operations.is_alive())
        responses = [call.args[0] for call in emit.call_args_list]
        self.assertEqual([item["type"] for item in responses if item["id"] == "speak-en"], ["audio", "complete"])
        self.assertTrue(any(item["id"] == "prepare-fr" and item["type"] == "prepared" for item in responses))
        self.assertEqual(worker.language, "fr")
        self.assertFalse(worker.pending_ids)
        self.assertFalse(worker.requests)

    def test_second_synthesis_is_serialized_after_active_request(self):
        worker = PocketWorker()
        model = WaitingModel()
        worker.model = model
        worker.voice_state = object()
        operations = threading.Thread(target=worker.run_operations)

        with patch("voice_host.worker.emit") as emit:
            operations.start()
            worker.handle({"id": "first", "action": "synthesize", "text": "first"})
            self.assertTrue(model.started.wait(timeout=1))
            worker.handle({"id": "second", "action": "synthesize", "text": "second"})
            model.resume.set()
            self.wait_for_operations(worker)
            worker.operations.put(None)
            operations.join(timeout=1)

        self.assertFalse(operations.is_alive())
        response_types = [(item["id"], item["type"]) for item in (call.args[0] for call in emit.call_args_list)]
        self.assertLess(response_types.index(("first", "complete")), response_types.index(("second", "audio")))
        self.assertIn(("second", "complete"), response_types)
        self.assertFalse(worker.pending_ids)
        self.assertFalse(worker.requests)

    def test_cancel_queued_synthesis_and_dispose_after_cancel(self):
        worker = PocketWorker()
        model = WaitingModel()
        worker.model = model
        worker.voice_state = object()
        operations = threading.Thread(target=worker.run_operations)

        with patch("voice_host.worker.emit") as emit:
            operations.start()
            worker.handle({"id": "active", "action": "synthesize", "text": "active"})
            self.assertTrue(model.started.wait(timeout=1))
            worker.handle({"id": "queued", "action": "synthesize", "text": "queued"})
            worker.handle({"id": "cancel-queued", "action": "cancel", "requestId": "queued"})
            worker.handle({"id": "dispose", "action": "dispose"})
            model.resume.set()
            self.wait_for_operations(worker)
            worker.operations.put(None)
            operations.join(timeout=1)

        self.assertFalse(operations.is_alive())
        responses = [call.args[0] for call in emit.call_args_list]
        self.assertTrue(any(item["id"] == "queued" and item["type"] == "cancelled" for item in responses))
        self.assertFalse(any(item["id"] == "queued" and item["type"] == "audio" for item in responses))
        self.assertTrue(any(item["id"] == "dispose" and item["type"] == "disposed" for item in responses))
        self.assertIsNone(worker.model)
        self.assertIsNone(worker.voice_state)
        self.assertFalse(worker.pending_ids)
        self.assertFalse(worker.requests)

    def test_dispose_while_idle_releases_loaded_model_and_voice(self):
        worker = PocketWorker()
        worker.model = SwitchableModel()
        worker.voice_state = object()
        worker.language = "en"
        worker.voice = "alba"
        operations = threading.Thread(target=worker.run_operations)

        with patch("voice_host.worker.emit") as emit:
            operations.start()
            worker.handle({"id": "dispose-idle", "action": "dispose"})
            self.wait_for_operations(worker)
            worker.operations.put(None)
            operations.join(timeout=1)

        self.assertFalse(operations.is_alive())
        self.assertIsNone(worker.model)
        self.assertIsNone(worker.voice_state)
        self.assertIsNone(worker.language)
        self.assertIsNone(worker.voice)
        self.assertEqual(emit.call_args.args[0]["type"], "disposed")


if __name__ == "__main__":
    unittest.main()
