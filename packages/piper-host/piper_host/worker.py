"""Supervised JSONL worker; Piper/GPL dependencies remain in this process."""

from __future__ import annotations

import base64
import json
import os
import queue
import sys
import threading
import time
from pathlib import Path
from typing import Any

os.environ["CUDA_VISIBLE_DEVICES"] = ""
os.environ["ORT_DISABLE_TUNABLE_OPS"] = "1"
os.environ.setdefault("OMP_NUM_THREADS", "2")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "2")

from .assets import DownloadCancelled, download_asset, verify_asset
from .catalog import VOICES, resolve_voice

MAX_IPC_LINE_BYTES = 1024 * 1024
MAX_TEXT_BYTES = 64 * 1024
MAX_REQUEST_ID_LENGTH = 128
MAX_PENDING_OPERATIONS = 4
PCM_CHUNK_BYTES = 16 * 1024


class PiperWorker:
    def __init__(self, asset_root: Path) -> None:
        self.asset_root = asset_root
        self.voice: Any = None
        self.voice_id: str | None = None
        self.language: str | None = None
        self.voice_class: Any = None
        self.synthesis_config_class: Any = None
        self.runtime_error: str | None = None
        self.requests: dict[str, threading.Event] = {}
        self.requests_lock = threading.Lock()
        self.output_lock = threading.Lock()
        self.operations: queue.Queue[dict[str, Any] | None] = queue.Queue(
            maxsize=MAX_PENDING_OPERATIONS
        )
        self.pending_ids: set[str] = set()

    def initialize_runtime(self) -> None:
        try:
            from piper import PiperVoice, SynthesisConfig

            self.voice_class = PiperVoice
            self.synthesis_config_class = SynthesisConfig
        except Exception as error:
            self.runtime_error = str(error)
            print(f"Piper runtime import failed: {error}", file=sys.stderr, flush=True)

    def emit(self, payload: dict[str, Any]) -> None:
        with self.output_lock:
            sys.stdout.write(json.dumps(payload, separators=(",", ":")) + "\n")
            sys.stdout.flush()

    def health(self, request_id: str) -> None:
        available_providers: list[str] = []
        if self.voice_class is not None:
            try:
                import onnxruntime

                available_providers = onnxruntime.get_available_providers()
            except Exception as error:
                self.runtime_error = str(error)
        providers = self.session_providers()
        self.emit({
            "id": request_id,
            "type": "health",
            "provider": "piper",
            "alive": True,
            "runtimeReady": self.voice_class is not None,
            "runtimeError": self.runtime_error,
            "modelLoaded": self.voice is not None,
            "language": self.language,
            "voice": self.voice_id,
            "providers": providers,
            "availableProviders": available_providers,
            "processId": os.getpid(),
            **process_memory(),
        })

    def handle(self, request: dict[str, Any]) -> None:
        action = request.get("action")
        request_id = request.get("id")
        try:
            if not isinstance(request_id, str) or not request_id or len(request_id) > MAX_REQUEST_ID_LENGTH:
                raise ValueError("Request id must be a non-empty string of at most 128 characters")
            if action == "health":
                self.health(request_id)
            elif action == "cancel":
                self.cancel(str(request.get("requestId", "")), request_id)
            elif action in {"prepare", "synthesize", "dispose"}:
                self._enqueue(request_id, action, request)
            else:
                raise ValueError(f"Unknown Piper action: {action}")
        except Exception as error:
            self.emit({"id": request_id or "", "type": "error", "message": str(error)})

    def _enqueue(self, request_id: str, action: str, request: dict[str, Any]) -> None:
        with self.requests_lock:
            if request_id in self.pending_ids:
                raise ValueError("Duplicate Piper request id")
            if len(self.pending_ids) >= MAX_PENDING_OPERATIONS:
                raise ValueError("Piper operation queue is full")
            self.pending_ids.add(request_id)
            self.requests[request_id] = threading.Event()
        if action == "synthesize":
            text = request.get("text")
            if not isinstance(text, str) or not text.strip() or len(text.encode("utf-8")) > MAX_TEXT_BYTES:
                self._forget(request_id)
                raise ValueError("Synthesis text must be non-empty and at most 64 KiB")
        try:
            self.operations.put_nowait(request)
        except queue.Full:
            self._forget(request_id)
            raise ValueError("Piper operation queue is full") from None

    def cancel(self, target_id: str, request_id: str) -> None:
        with self.requests_lock:
            cancel = self.requests.get(target_id)
            if cancel is not None:
                cancel.set()
        self.emit({"id": request_id, "type": "cancelled", "requestId": target_id})

    def run_operations(self) -> None:
        while True:
            request = self.operations.get()
            try:
                if request is None:
                    return
                request_id = str(request["id"])
                action = request["action"]
                if action == "prepare":
                    self.prepare(request)
                elif action == "synthesize":
                    self.synthesize(request)
                else:
                    self.dispose(request_id)
                    return
            except Exception as error:
                self.emit({"id": request.get("id", ""), "type": "error", "message": str(error)})
            finally:
                if request is not None:
                    self._forget(str(request.get("id", "")))
                self.operations.task_done()

    def prepare(self, request: dict[str, Any]) -> None:
        if self.voice_class is None:
            raise RuntimeError(f"Piper runtime is not ready: {self.runtime_error or 'unknown error'}")
        manifest = resolve_voice(str(request.get("language", "")), request.get("voice"))
        cancel = self._cancel_for(str(request["id"]))
        if cancel.is_set():
            raise DownloadCancelled("Piper voice preparation was cancelled")

        if self.voice is not None and self.voice_id == manifest.id:
            providers = self.session_providers()
            if providers != ["CPUExecutionProvider"]:
                self.voice = None
                self.voice_id = None
                self.language = None
                raise RuntimeError(f"Piper selected unexpected ONNX providers: {providers}")
            self._emit_prepared(str(request["id"]), manifest, providers)
            return

        def report(downloaded: int, total: int) -> None:
            self.emit({"id": request["id"], "type": "progress", "phase": "download", "downloadedBytes": downloaded, "totalBytes": total})

        model_path = download_asset(self.asset_root, manifest.model, cancel, report)
        config_path = download_asset(self.asset_root, manifest.config, cancel, report)
        if not verify_asset(model_path, manifest.model) or not verify_asset(config_path, manifest.config):
            raise RuntimeError("Installed Piper voice failed integrity verification")
        if cancel.is_set():
            raise DownloadCancelled("Piper voice preparation was cancelled")
        if self.voice_id != manifest.id:
            self.voice = self.voice_class.load(str(model_path), use_cuda=False)
            self.voice_id = manifest.id
            self.language = manifest.language
        providers = self.session_providers()
        if providers != ["CPUExecutionProvider"]:
            self.voice = None
            self.voice_id = None
            self.language = None
            raise RuntimeError(f"Piper selected unexpected ONNX providers: {providers}")
        self._emit_prepared(str(request["id"]), manifest, providers)

    def _emit_prepared(self, request_id: str, manifest: Any, providers: list[str]) -> None:
        self.emit({"id": request_id, "type": "prepared", "voice": manifest.id, "language": manifest.language, "sampleRate": self.voice.config.sample_rate, "providers": providers})

    def session_providers(self) -> list[str]:
        if self.voice is None:
            return []
        return self.voice.session.get_providers()

    def synthesize(self, request: dict[str, Any]) -> None:
        request_id = str(request["id"])
        if self.voice is None:
            raise RuntimeError("Piper worker has not been prepared")
        cancel = self._cancel_for(request_id)
        speed = float(request.get("speed", 1.0))
        if not 0.5 <= speed <= 2.0:
            raise ValueError("Synthesis speed must be between 0.5 and 2.0")
        config = self.synthesis_config_class(length_scale=1.0 / speed)
        started = time.perf_counter()
        cpu_started = time.process_time()
        first_audio_ms: int | None = None
        try:
            for chunk in self.voice.synthesize(str(request["text"]), syn_config=config):
                if cancel.is_set():
                    self.emit({"id": request_id, "type": "cancelled"})
                    return
                if first_audio_ms is None:
                    first_audio_ms = int((time.perf_counter() - started) * 1000)
                self._emit_audio_chunks(request_id, chunk)
            self.emit({"id": request_id, "type": "complete", "firstAudioMs": first_audio_ms or 0, "durationMs": int((time.perf_counter() - started) * 1000), "cpuSeconds": round(time.process_time() - cpu_started, 3)})
        except Exception:
            if cancel.is_set():
                self.emit({"id": request_id, "type": "cancelled"})
                return
            raise

    def _emit_audio_chunks(self, request_id: str, chunk: Any) -> None:
        pcm = chunk.audio_int16_bytes
        for offset in range(0, len(pcm), PCM_CHUNK_BYTES):
            frame = pcm[offset : offset + PCM_CHUNK_BYTES]
            if not frame:
                continue
            self.emit({"id": request_id, "type": "audio", "sampleRate": chunk.sample_rate, "channels": chunk.sample_channels, "encoding": "s16le", "audio": base64.b64encode(frame).decode("ascii")})

    def _cancel_for(self, request_id: str) -> threading.Event:
        with self.requests_lock:
            cancel = self.requests.get(request_id)
        if cancel is None:
            raise RuntimeError("Piper operation is no longer active")
        return cancel

    def _forget(self, request_id: str) -> None:
        with self.requests_lock:
            self.requests.pop(request_id, None)
            self.pending_ids.discard(request_id)

    def dispose(self, request_id: str) -> None:
        self.voice = None
        self.voice_id = None
        self.language = None
        self.emit({"id": request_id, "type": "disposed"})


def main() -> int:
    worker = PiperWorker(Path(os.environ.get("UNIFIA_PIPER_ASSET_DIR", "assets")))
    worker.initialize_runtime()
    operations = threading.Thread(target=worker.run_operations, daemon=True)
    operations.start()
    for line in sys.stdin.buffer:
        if len(line) > MAX_IPC_LINE_BYTES:
            worker.emit({"id": "", "type": "error", "message": "Piper IPC line exceeded 1 MiB"})
            continue
        try:
            request = json.loads(line)
            if not isinstance(request, dict):
                raise ValueError("Piper request must be a JSON object")
            worker.handle(request)
        except Exception as error:
            worker.emit({"id": "", "type": "error", "message": str(error)})
    with worker.requests_lock:
        for cancel in worker.requests.values():
            cancel.set()
    operations.join(timeout=5)
    return 0


def process_memory() -> dict[str, int | None]:
    if sys.platform != "win32":
        return {"workingSetBytes": None, "peakWorkingSetBytes": None}
    try:
        import ctypes
        from ctypes import wintypes

        class ProcessMemoryCounters(ctypes.Structure):
            _fields_ = [
                ("cb", wintypes.DWORD),
                ("page_fault_count", wintypes.DWORD),
                ("peak_working_set_size", ctypes.c_size_t),
                ("working_set_size", ctypes.c_size_t),
                ("quota_peak_paged_pool_usage", ctypes.c_size_t),
                ("quota_paged_pool_usage", ctypes.c_size_t),
                ("quota_peak_non_paged_pool_usage", ctypes.c_size_t),
                ("quota_non_paged_pool_usage", ctypes.c_size_t),
                ("pagefile_usage", ctypes.c_size_t),
                ("peak_pagefile_usage", ctypes.c_size_t),
            ]

        counters = ProcessMemoryCounters()
        counters.cb = ctypes.sizeof(counters)
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        psapi = ctypes.WinDLL("psapi", use_last_error=True)
        kernel32.GetCurrentProcess.restype = wintypes.HANDLE
        psapi.GetProcessMemoryInfo.argtypes = (
            wintypes.HANDLE,
            ctypes.POINTER(ProcessMemoryCounters),
            wintypes.DWORD,
        )
        psapi.GetProcessMemoryInfo.restype = wintypes.BOOL
        success = psapi.GetProcessMemoryInfo(
            kernel32.GetCurrentProcess(), ctypes.byref(counters), counters.cb
        )
        if not success:
            return {"workingSetBytes": None, "peakWorkingSetBytes": None}
        return {
            "workingSetBytes": counters.working_set_size,
            "peakWorkingSetBytes": counters.peak_working_set_size,
        }
    except (AttributeError, OSError, TypeError, ValueError):
        return {"workingSetBytes": None, "peakWorkingSetBytes": None}


if __name__ == "__main__":
    raise SystemExit(main())
