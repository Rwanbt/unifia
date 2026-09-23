"""JSON-lines worker protocol for the supervised Unifia desktop host."""

from __future__ import annotations

import base64
import ctypes
import json
import os
import queue
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from ctypes import wintypes

from .voice_state import prepare_voice_state, validate_voice_sample

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
MAX_IPC_LINE_BYTES = 1024 * 1024
MAX_TEXT_BYTES = MAX_IPC_LINE_BYTES - 1024
MAX_PENDING_OPERATIONS = 8
MAX_REQUEST_ID_LENGTH = 128


class MemoryCounters(ctypes.Structure):
    _fields_ = [
        ("cb", wintypes.DWORD),
        ("pageFaultCount", wintypes.DWORD),
        ("peakWorkingSetSize", ctypes.c_size_t),
        ("workingSetSize", ctypes.c_size_t),
        ("quotaPeakPagedPoolUsage", ctypes.c_size_t),
        ("quotaPagedPoolUsage", ctypes.c_size_t),
        ("quotaPeakNonPagedPoolUsage", ctypes.c_size_t),
        ("quotaNonPagedPoolUsage", ctypes.c_size_t),
        ("pagefileUsage", ctypes.c_size_t),
        ("peakPagefileUsage", ctypes.c_size_t),
        ("privateUsage", ctypes.c_size_t),
    ]


def process_memory_usage() -> tuple[int | None, int | None, int | None]:
    if os.name == "nt":
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        psapi = ctypes.WinDLL("psapi", use_last_error=True)
        kernel.GetCurrentProcess.restype = wintypes.HANDLE
        psapi.GetProcessMemoryInfo.argtypes = [
            wintypes.HANDLE,
            ctypes.POINTER(MemoryCounters),
            wintypes.DWORD,
        ]
        psapi.GetProcessMemoryInfo.restype = wintypes.BOOL
        counters = MemoryCounters()
        counters.cb = ctypes.sizeof(counters)
        if psapi.GetProcessMemoryInfo(kernel.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
            return counters.workingSetSize, counters.peakWorkingSetSize, counters.privateUsage
        return None, None, None
    statm = Path("/proc/self/statm")
    if statm.is_file():
        resident_pages = int(statm.read_text(encoding="ascii").split()[1])
        return resident_pages * os.sysconf("SC_PAGE_SIZE"), None, None
    return None, None, None


@dataclass
class ActiveRequest:
    cancel: threading.Event


class PocketWorker:
    """Own one quantized Pocket model at a time; serialize model access."""

    def __init__(self) -> None:
        self.model: Any = None
        self.tts_model_type: Any = None
        self.default_voice_for_language: Any = None
        self.torch: Any = None
        self.runtime_ready = False
        self.runtime_error: str | None = None
        self.voice_state: Any = None
        self.language: str | None = None
        self.voice: str | None = None
        self.voice_name: str | None = None
        self.model_lock = threading.Lock()
        self.requests: dict[str, ActiveRequest] = {}
        self.requests_lock = threading.Lock()
        self.operations: queue.Queue[dict[str, Any] | None] = queue.Queue(maxsize=MAX_PENDING_OPERATIONS)
        self.pending_ids: set[str] = set()

    def initialize_runtime(self) -> None:
        print("Importing Pocket and PyTorch", file=sys.stderr, flush=True)
        try:
            from pocket_tts import TTSModel
            from pocket_tts.default_parameters import get_default_voice_for_language
            import torch

            torch.set_num_threads(int(os.environ.get("UNIFIA_TTS_THREADS", "2")))
            self.tts_model_type = TTSModel
            self.default_voice_for_language = get_default_voice_for_language
            self.torch = torch
            self.runtime_ready = True
            print("Pocket and PyTorch imports ready", file=sys.stderr, flush=True)
        except Exception as error:
            self.runtime_error = str(error)
            print(f"Pocket runtime import failed: {error}", file=sys.stderr, flush=True)

    def prepare(
        self,
        language: str,
        voice: str,
        voice_sample: str | None = None,
        voice_root: str | None = None,
    ) -> dict[str, Any]:
        if language not in LANGUAGES:
            raise ValueError(f"Unsupported language: {language}")
        print(f"Preparing Pocket runtime for {language}", file=sys.stderr, flush=True)
        if not self.runtime_ready:
            raise RuntimeError(f"Pocket runtime is not ready: {self.runtime_error or 'not initialized'}")

        preset = voice if voice in VOICES else self.default_voice_for_language(LANGUAGES[language])
        voice_source: str | Path = preset
        clone_identity: str | None = None
        if voice_sample is not None:
            if voice_root is None:
                raise ValueError("Voice clone root is required")
            root, sample = validate_voice_sample(voice_root, voice_sample, voice)
            voice_source = sample
            file_status = sample.stat()
            clone_identity = f"clone:{voice}:{language}:{sample}:{file_status.st_size}:{file_status.st_mtime_ns}"
        with self.model_lock:
            if self.language != language:
                self.model = None
                self.voice_state = None
                self.voice = None
                self.voice_name = None
                print(f"Loading quantized Pocket model for {language}; first use may download assets", file=sys.stderr, flush=True)
                self.model = self.tts_model_type.load_model(language=LANGUAGES[language], quantize=True)
                self.language = language
                print(f"Pocket model ready for {language}", file=sys.stderr, flush=True)
            selected_voice = clone_identity or preset
            if self.voice != selected_voice:
                print(f"Preparing Pocket voice for {language}", file=sys.stderr, flush=True)
                if clone_identity is not None:
                    self.voice_state, _ = prepare_voice_state(
                        self.model, root, sample, language, voice
                    )
                else:
                    self.voice_state = self.model.get_state_for_audio_prompt(voice_source)
                self.voice = clone_identity or preset
                self.voice_name = voice if clone_identity is not None else None
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
                started_cpu_seconds = time.process_time()
                for chunk in self.model.generate_audio_stream(self.voice_state, str(request["text"])):
                    if cancel.is_set():
                        emit({
                            "id": request_id,
                            "type": "cancelled",
                            "cpuSeconds": round(time.process_time() - started_cpu_seconds, 3),
                        })
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
                emit({
                    "id": request_id,
                    "type": "complete",
                    "cpuSeconds": round(time.process_time() - started_cpu_seconds, 3),
                })
        except Exception as error:  # Protocol boundary: report the failure to the supervisor.
            emit({"id": request_id, "type": "error", "message": str(error)})
        finally:
            with self.requests_lock:
                self.requests.pop(request_id, None)

    def health(self) -> dict[str, Any]:
        working_set_bytes, peak_working_set_bytes, private_bytes = process_memory_usage()
        return {
            "alive": True,
            "processId": os.getpid(),
            "runtimeReady": self.runtime_ready,
            "runtimeError": self.runtime_error,
            "modelLoaded": self.model is not None,
            "voiceCloningSupported": (
                bool(getattr(self.model, "has_voice_cloning", False))
                if self.model is not None
                else None
            ),
            "language": self.language,
            "voiceReady": self.voice_state is not None,
            "workingSetBytes": working_set_bytes,
            "peakWorkingSetBytes": peak_working_set_bytes,
            "privateBytes": private_bytes,
        }

    def handle(self, request: dict[str, Any]) -> None:
        action = request.get("action")
        raw_request_id = request.get("id")
        request_id = raw_request_id if isinstance(raw_request_id, str) else ""
        registered = False
        try:
            if not request_id or len(request_id) > MAX_REQUEST_ID_LENGTH:
                raise ValueError("Request id must be a non-empty string of at most 128 characters")
            if action == "health":
                emit({"id": request_id, "type": "health", "provider": "pocket", **self.health()})
            elif action == "prepare":
                self._register_pending(request_id)
                registered = True
                self.operations.put_nowait(request)
            elif action == "synthesize":
                text = request.get("text")
                if not isinstance(text, str) or len(text.encode("utf-8")) > MAX_TEXT_BYTES:
                    raise ValueError("Synthesis text must be a string within the 1 MiB IPC limit")
                self._register_pending(request_id)
                registered = True
                cancel = threading.Event()
                with self.requests_lock:
                    self.requests[request_id] = ActiveRequest(cancel)
                self.operations.put_nowait(request)
            elif action == "cancel":
                with self.requests_lock:
                    active = self.requests.get(str(request.get("requestId", "")))
                    if active is not None:
                        active.cancel.set()
                emit({"id": request_id, "type": "cancelled", "requestId": request.get("requestId")})
            elif action == "dispose":
                self._register_pending(request_id)
                registered = True
                self.operations.put_nowait(request)
            elif action == "invalidate_voice":
                self._register_pending(request_id)
                registered = True
                self.operations.put_nowait(request)
            else:
                raise ValueError(f"Unknown action: {action}")
        except Exception as error:
            if registered:
                with self.requests_lock:
                    self.pending_ids.discard(request_id)
                    if action == "synthesize":
                        self.requests.pop(request_id, None)
            emit({"id": request_id, "type": "error", "message": str(error)})

    def _register_pending(self, request_id: str) -> None:
        with self.requests_lock:
            if request_id in self.pending_ids:
                raise ValueError("Duplicate request id")
            self.pending_ids.add(request_id)

    def run_operations(self) -> None:
        while True:
            request = self.operations.get()
            if request is None:
                self.operations.task_done()
                break
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
                        self.voice_name = None
                    emit({"id": request_id, "type": "disposed"})
                elif action == "invalidate_voice":
                    with self.model_lock:
                        if self.voice_name == request.get("voice"):
                            self.voice_state = None
                            self.voice = None
                            self.voice_name = None
                    emit({"id": request_id, "type": "invalidated"})
            except Exception as error:
                emit({"id": request_id, "type": "error", "message": str(error)})
                if action == "synthesize":
                    with self.requests_lock:
                        self.requests.pop(request_id, None)
            finally:
                with self.requests_lock:
                    self.pending_ids.discard(request_id)
                self.operations.task_done()


def emit(message: dict[str, Any]) -> None:
    serialized = json.dumps(message, separators=(",", ":"))
    if len(serialized.encode("utf-8")) > MAX_IPC_LINE_BYTES:
        serialized = json.dumps({"id": str(message.get("id", ""))[:MAX_REQUEST_ID_LENGTH], "type": "error", "message": "Worker response exceeds the 1 MiB IPC limit"}, separators=(",", ":"))
    sys.stdout.write(serialized + "\n")
    sys.stdout.flush()


def main() -> None:
    worker = PocketWorker()
    worker.initialize_runtime()
    operations = threading.Thread(target=worker.run_operations, daemon=True)
    operations.start()
    while raw_bytes := sys.stdin.buffer.readline(MAX_IPC_LINE_BYTES + 1):
        try:
            if len(raw_bytes) > MAX_IPC_LINE_BYTES:
                while raw_bytes and not raw_bytes.endswith(b"\n"):
                    raw_bytes = sys.stdin.buffer.readline(MAX_IPC_LINE_BYTES + 1)
                raise ValueError("Worker request exceeds the 1 MiB IPC limit")
            request = json.loads(raw_bytes.decode("utf-8"))
            if not isinstance(request, dict):
                raise ValueError("Request must be a JSON object")
            worker.handle(request)
        except Exception as error:
            emit({"id": "", "type": "error", "message": str(error)})
    worker.operations.put(None)
    operations.join()


if __name__ == "__main__":
    main()
