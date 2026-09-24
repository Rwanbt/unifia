import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from piper_host.assets import DownloadCancelled
from piper_host.catalog import VOICES
from piper_host.worker import PiperWorker


class PiperWorkerTests(unittest.TestCase):
    def setUp(self):
        self.worker = PiperWorker(Path("unused-assets"))
        self.worker.voice_class = object
        self.manifest = VOICES["en"]
        self.worker.voice_id = self.manifest.id
        self.worker.language = self.manifest.language
        self.worker.voice = SimpleNamespace(
            session=SimpleNamespace(get_providers=lambda: ["CPUExecutionProvider"]),
            config=SimpleNamespace(sample_rate=22050),
        )
        self.events = []
        self.worker.emit = self.events.append

    def test_cached_prepare_skips_asset_hashing_and_reports_ready(self):
        request_id = "cached-prepare"
        self.worker.requests[request_id] = threading.Event()

        with patch("piper_host.worker.download_asset", side_effect=AssertionError("cached voice reloaded")):
            self.worker.prepare({"id": request_id, "language": "en"})

        self.assertEqual(
            self.events,
            [{
                "id": request_id,
                "type": "prepared",
                "voice": self.manifest.id,
                "language": "en",
                "sampleRate": 22050,
                "providers": ["CPUExecutionProvider"],
            }],
        )

    def test_cached_prepare_honors_pending_cancellation(self):
        request_id = "cancelled-prepare"
        cancellation = threading.Event()
        cancellation.set()
        self.worker.requests[request_id] = cancellation

        with self.assertRaisesRegex(DownloadCancelled, "cancelled"):
            self.worker.prepare({"id": request_id, "language": "en"})

        self.assertEqual(self.events, [])


if __name__ == "__main__":
    unittest.main()
