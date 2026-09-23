import threading
import unittest
from unittest.mock import patch

from voice_host.worker import ActiveRequest, LANGUAGES, PocketWorker


class PendingModel:
    def generate_audio_stream(self, _voice_state, _text):
        yield None


class WaitingModel:
    def __init__(self):
        self.started = threading.Event()
        self.resume = threading.Event()

    def generate_audio_stream(self, _voice_state, _text):
        self.started.set()
        self.resume.wait(timeout=2)
        yield None


class PocketWorkerContractTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
