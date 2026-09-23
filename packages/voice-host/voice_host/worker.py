"""JSON-lines worker protocol for the supervised Unifia desktop host."""

from __future__ import annotations

import base64
import json
import os
import queue
import sys
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

os.environ["CUDA_VISIBLE_DEVICES"] = ""
os.environ.setdefault("OMP_NUM_THREADS", "2")
os.environ.setdefault("MKL_NUM_THREADS", "2")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "2")

LANGUAGES = {
    "en": "english",
    "fr": "french_24l",
    "es": "spanish_24l",
    "it": "italian_24l",
    "de": "german_24l",
}
VOICES = {
    "alba", "fantine", "cosette", "eponine", "azelma", "marius", "javert", "jean",
    "estelle", "giovanni", "lola", "juergen",
}


@dataclass
class ActiveRequest:
    cancel: threading.Event


class PocketWorker:
    """Own one quantized Pocket model at a time; serialize model access."""

    def __init__(self) -> None:
        self.model: Any = None
        self.voice_state: Any = None
        self.language: str | None = None
        self.voice: str | None = None
        self.model_lock = threading.Lock()
        self.requests: dict[str, ActiveRequest] = {}
        self.requests_lock = threading.Lock()
        self.operations: queue.Queue[dict[str, Any] | None] = queue.Queue()

    def prepare(
        self,
        language: str,
        voice: str,
        voice_sample: str | None = None,
        voice_root: str | None = None,
    ) -> dict[str, Any]:
        if language not in LANGUAGES:
            raise ValueError(f"Unsupported language: {language}")
        from pocket_tts.default_parameters import get_default_voice_for_language

        preset = voice if voice in VOICES else get_default_voice_for_language(LANGUAGES[language])
        voice_source: str | Path = preset
        if voice_sample is not None:
            if voice_root is None:
                raise ValueError("Voice clone root is required")
            root = Path(voice_root).resolve(strict=True)
            sample = Path(voice_sample).resolve(strict=True)
            if not sample.is_relative_to(root) or sample.suffix.lower() != ".wav" or not sample.is_file():
                raise ValueError("Voice clone must be a WAV file under the managed voice directory")
            voice_source = sample
            file_status = sample.stat()
            preset = f"{sample}:{file_status.st_size}:{file_status.st_mtime_ns}"
        with self.model_lock:
            if self.language != language:
                self.model = None
                self.voice_state = None
                self.voice = None
                from pocket_tts import TTSModel

                import torch

                torch.set_num_threads(int(os.environ.get("UNIFIA_TTS_THREADS", "2")))
                print(f"Loading quantized Pocket model for {language}", file=sys.stderr, flush=True)
                self.model = TTSModel.load_model(language=LANGUAGES[language], quantize=True)
                self.language = language
                print(f"Pocket model ready for {language}", file=sys.stderr, flush=True)
            if self.voice != preset:
                print(f"Preparing Pocket voice for {language}", file=sys.stderr, flush=True)
                self.voice_state = self.model.get_state_for_audio_prompt(voice_source)
                self.voice = preset
                print(f"Pocket voice ready for {language}", file=sys.stderr, flush=True)
            return {"language": language, "voice": voice, "sampleRate": self.model.sample_rate}

    def synthesize(self, request: dict[str, Any]) -> None:
        request_id = str(request["id"])
        with self.requests_lock:
            active = self.requests.get(request_id)
            if active is None:
                active = ActiveRequest(threading.Event())
                self.requests[request_id] = active
            cancel = active.cancel
        try:
            with self.model_lock:
                if self.model is None or self.voice_state is None:
                    raise RuntimeError("Pocket worker has not been prepared")
                for chunk in self.model.generate_audio_stream(self.voice_state, str(request["text"])):
                    if cancel.is_set():
                        emit({"id": request_id, "type": "cancelled"})
                        return
                    pcm = chunk.detach().cpu().numpy().astype("<f4", copy=False).tobytes()
                    emit({
                        "id": request_id,
                        "type": "audio",
                        "sampleRate": self.model.sample_rate,
                        "channels": 1,
                        "encoding": "f32le",
                        "audio": base64.b64encode(pcm).decode("ascii"),
                    })
                emit({"id": request_id, "type": "complete"})
        except Exception as error:  # Protocol boundary: report the failure to the supervisor.
            emit({"id": request_id, "type": "error", "message": str(error)})
        finally:
            with self.requests_lock:
                self.requests.pop(request_id, None)

    def handle(self, request: dict[str, Any]) -> None:
        action = request.get("action")
        request_id = str(request.get("id", ""))
        try:
            if action == "health":
                emit({"id": request_id, "type": "health", "ready": True, "provider": "pocket"})
            elif action == "prepare":
                self.operations.put(request)
            elif action == "synthesize":
                cancel = threading.Event()
                with self.requests_lock:
                    self.requests[request_id] = ActiveRequest(cancel)
                self.operations.put(request)
            elif action == "cancel":
                with self.requests_lock:
                    active = self.requests.get(str(request.get("requestId", "")))
                    if active is not None:
                        active.cancel.set()
                emit({"id": request_id, "type": "cancelled", "requestId": request.get("requestId")})
            elif action == "dispose":
                self.operations.put(request)
            else:
                raise ValueError(f"Unknown action: {action}")
        except Exception as error:
            emit({"id": request_id, "type": "error", "message": str(error)})

    def run_operations(self) -> None:
        while (request := self.operations.get()) is not None:
            action = request.get("action")
            request_id = str(request.get("id", ""))
            try:
                if action == "prepare":
                    result = self.prepare(
                        str(request.get("language", "en")),
                        str(request.get("voice", "alba")),
                        request.get("voiceSample"),
                        request.get("voiceRoot"),
                    )
                    emit({"id": request_id, "type": "prepared", **result})
                elif action == "synthesize":
                    self.synthesize(request)
                elif action == "dispose":
                    with self.model_lock:
                        self.model = None
                        self.voice_state = None
                        self.language = None
                        self.voice = None
                    emit({"id": request_id, "type": "disposed"})
            except Exception as error:
                emit({"id": request_id, "type": "error", "message": str(error)})
                if action == "synthesize":
                    with self.requests_lock:
                        self.requests.pop(request_id, None)


def emit(message: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def main() -> None:
    worker = PocketWorker()
    operations = threading.Thread(target=worker.run_operations, daemon=True)
    operations.start()
    for raw_line in sys.stdin:
        try:
            request = json.loads(raw_line)
            if not isinstance(request, dict):
                raise ValueError("Request must be a JSON object")
            worker.handle(request)
        except Exception as error:
            emit({"id": "", "type": "error", "message": str(error)})
    worker.operations.put(None)
    operations.join()


if __name__ == "__main__":
    main()
