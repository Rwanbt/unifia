import shutil
import os
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import pocket_tts.models.model_state

from voice_host.voice_state import prepare_voice_state, validate_voice_sample

TEST_TEMP_ROOT = Path(__file__).parent.parent / ".build-temp" / "voice-state-tests"
TEST_TEMP_ROOT.mkdir(parents=True, exist_ok=True)


class TemporaryWorkspace:
    def __enter__(self):
        self.path = TEST_TEMP_ROOT / uuid4().hex
        self.path.mkdir()
        return str(self.path)

    def __exit__(self, *_error):
        shutil.rmtree(self.path)


class CachedStateModel:
    has_voice_cloning = True

    def __init__(self):
        self.config = SimpleNamespace(
            weights_path="hf://kyutai/pocket-tts/model.safetensors@revision123",
            weights_path_without_voice_cloning=None,
        )
        self.loaded_paths = []
        self.computed_samples = []

    def get_state_for_audio_prompt(self, source):
        path = Path(source)
        if path.is_file() and path.suffix == ".safetensors":
            self.loaded_paths.append(path)
            return path.read_bytes()
        self.computed_samples.append(path)
        return b"conditioned-state"


class VoiceStateTests(unittest.TestCase):
    def test_second_model_load_reuses_persistent_state(self):
        with TemporaryWorkspace() as temporary:
            root = Path(temporary)
            sample = root / "alba.wav"
            sample.write_bytes(b"sample")
            with patch("pocket_tts.models.model_state.export_model_state", side_effect=lambda state, path: Path(path).write_bytes(state)):
                first_model = CachedStateModel()
                first, _ = prepare_voice_state(first_model, root, sample, "en", "alba")
                second_model = CachedStateModel()
                second, identity = prepare_voice_state(second_model, root, sample, "en", "alba")

            self.assertEqual(first, b"conditioned-state")
            self.assertEqual(second, first)
            self.assertEqual(len(first_model.computed_samples), 1)
            self.assertEqual(second_model.computed_samples, [])
            self.assertEqual(len(second_model.loaded_paths), 1)
            self.assertIn("revision123", identity)

    def test_changed_sample_fingerprint_computes_new_state(self):
        with TemporaryWorkspace() as temporary:
            root = Path(temporary)
            sample = root / "alba.wav"
            sample.write_bytes(b"before")
            with patch("pocket_tts.models.model_state.export_model_state", side_effect=lambda state, path: Path(path).write_bytes(state)):
                prepare_voice_state(CachedStateModel(), root, sample, "en", "alba")
                sample.write_bytes(b"after with different content")
                model = CachedStateModel()
                prepare_voice_state(model, root, sample, "en", "alba")

            self.assertEqual(len(model.computed_samples), 1)
            self.assertEqual(model.loaded_paths, [])

    def test_corrupt_state_hash_is_recomputed(self):
        with TemporaryWorkspace() as temporary:
            root = Path(temporary)
            sample = root / "alba.wav"
            sample.write_bytes(b"sample")
            with patch("pocket_tts.models.model_state.export_model_state", side_effect=lambda state, path: Path(path).write_bytes(state)):
                prepare_voice_state(CachedStateModel(), root, sample, "en", "alba")
                state_path = next((root / ".pocket-state-cache" / "alba").glob("*.safetensors"))
                state_path.write_bytes(b"corrupt")
                model = CachedStateModel()
                prepare_voice_state(model, root, sample, "en", "alba")

            self.assertEqual(len(model.computed_samples), 1)

    def test_model_without_clone_weights_fails_closed(self):
        model = CachedStateModel()
        model.has_voice_cloning = False
        with TemporaryWorkspace() as temporary:
            root = Path(temporary)
            sample = root / "alba.wav"
            sample.write_bytes(b"sample")
            with self.assertRaisesRegex(RuntimeError, "does not support voice cloning"):
                prepare_voice_state(model, root, sample, "en", "alba")

    def test_sample_must_be_a_bounded_wav_inside_managed_root(self):
        with TemporaryWorkspace() as temporary:
            root = Path(temporary)
            valid = root / "clone.wav"
            valid.write_bytes(b"wav")
            self.assertEqual(validate_voice_sample(str(root), str(valid), "clone")[1], valid)
            external = root.parent / f"{root.name}-external.wav"
            external.write_bytes(b"wav")
            try:
                with self.assertRaisesRegex(ValueError, "under the managed voice directory"):
                    validate_voice_sample(str(root), str(external), "clone")
            finally:
                external.unlink(missing_ok=True)
            with self.assertRaisesRegex(ValueError, "Invalid voice name"):
                validate_voice_sample(str(root), str(valid), "../clone")

    def test_sample_rejects_missing_wrong_extension_and_oversized_files(self):
        with TemporaryWorkspace() as temporary:
            root = Path(temporary)
            wrong_extension = root / "clone.mp3"
            wrong_extension.write_bytes(b"audio")
            with self.assertRaisesRegex(ValueError, "must be a WAV file"):
                validate_voice_sample(str(root), str(wrong_extension), "clone")
            with self.assertRaisesRegex(ValueError, "must exist"):
                validate_voice_sample(str(root), str(root / "missing.wav"), "clone")
            oversized = root / "large.wav"
            oversized.write_bytes(b"0" * (24 * 1024 * 1024 + 1))
            with self.assertRaisesRegex(ValueError, "24 MiB limit"):
                validate_voice_sample(str(root), str(oversized), "large")

    def test_symlink_escape_is_rejected_when_host_allows_file_symlinks(self):
        with TemporaryWorkspace() as temporary:
            root = Path(temporary)
            external = root.parent / f"{root.name}-outside.wav"
            external.write_bytes(b"wav")
            link = root / "clone.wav"
            try:
                try:
                    os.symlink(external, link)
                except OSError as error:
                    self.skipTest(f"Windows file symlink creation is unavailable: {error}")
                with self.assertRaisesRegex(ValueError, "under the managed voice directory"):
                    validate_voice_sample(str(root), str(link), "clone")
            finally:
                link.unlink(missing_ok=True)
                external.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
