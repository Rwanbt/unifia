import hashlib
import io
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
import uuid

from piper_host.assets import AssetIntegrityError, DownloadCancelled, download_asset, verify_asset
from piper_host.catalog import VoiceAsset

TEST_TEMP_ROOT = Path(__file__).resolve().parents[3] / ".build-temp"


class AssetResponse(io.BytesIO):
    def geturl(self) -> str:
        return "https://huggingface.co/example/model.onnx"


class PiperAssetTests(unittest.TestCase):
    def setUp(self):
        self.payload = b"pinned model bytes"
        self.asset = VoiceAsset(
            filename=f"piper-test-{uuid.uuid4().hex}.onnx",
            relative_path="en/model.onnx",
            sha256=hashlib.sha256(self.payload).hexdigest(),
            size_bytes=len(self.payload),
        )

    def test_download_verifies_and_atomically_installs_asset(self):
        progress = []
        with patch("piper_host.assets.urlopen", return_value=AssetResponse(self.payload)):
            path = download_asset(
                TEST_TEMP_ROOT,
                self.asset,
                threading.Event(),
                lambda *event: progress.append(event),
            )

        self.addCleanup(path.unlink, missing_ok=True)
        self.assertTrue(verify_asset(path, self.asset))
        self.assertEqual(path.read_bytes(), self.payload)
        self.assertEqual(progress, [(len(self.payload), len(self.payload))])
        self.assertEqual(self.partial_files(), [])

    def test_hash_mismatch_does_not_install_asset(self):
        bad = VoiceAsset(**{**self.asset.__dict__, "sha256": "0" * 64})
        with patch("piper_host.assets.urlopen", return_value=AssetResponse(self.payload)):
            with self.assertRaises(AssetIntegrityError):
                download_asset(TEST_TEMP_ROOT, bad, threading.Event(), lambda *_: None)

        self.assertFalse((TEST_TEMP_ROOT / bad.filename).exists())
        self.assertEqual(self.partial_files(), [])

    def test_transient_network_error_retries_before_atomic_install(self):
        with patch(
            "piper_host.assets.urlopen",
            side_effect=[TimeoutError("temporary network failure"), AssetResponse(self.payload)],
        ) as open_url:
            path = download_asset(TEST_TEMP_ROOT, self.asset, threading.Event(), lambda *_: None)

        self.addCleanup(path.unlink, missing_ok=True)
        self.assertEqual(open_url.call_count, 2)
        self.assertTrue(verify_asset(path, self.asset))
        self.assertEqual(self.partial_files(), [])

    def test_cancelled_download_leaves_no_partial_asset(self):
        cancel = threading.Event()
        cancel.set()
        with patch("piper_host.assets.urlopen", return_value=AssetResponse(self.payload)):
            with self.assertRaises(DownloadCancelled):
                download_asset(TEST_TEMP_ROOT, self.asset, cancel, lambda *_: None)

        self.assertFalse((TEST_TEMP_ROOT / self.asset.filename).exists())
        self.assertEqual(self.partial_files(), [])

    def partial_files(self) -> list[Path]:
        return [path for path in TEST_TEMP_ROOT.glob("*.part") if self.asset.filename in path.name]


if __name__ == "__main__":
    unittest.main()
