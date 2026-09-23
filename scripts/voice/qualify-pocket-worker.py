from __future__ import annotations

import argparse
import base64
import json
import os
import shutil
import struct
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any

LANGUAGES = {
    "en": ("alba", "A short English sentence for managed Pocket qualification."),
    "fr": ("estelle", "Une phrase courte en français pour qualifier Pocket."),
    "es": ("lola", "Una frase corta en español para comprobar Pocket."),
    "it": ("giovanni", "Una breve frase in italiano per verificare Pocket."),
    "de": ("juergen", "Ein kurzer deutscher Satz zur Prüfung von Pocket."),
}
SWITCH_ORDER = ("en", "fr", "de", "es", "it", "en")


class Worker:
    def __init__(self, python: Path, project: Path, log: Path):
        env = os.environ.copy()
        env["PYTHONPATH"] = str(project)
        env.pop("UNIFIA_TTS_DIAGNOSTICS", None)
        self.log_file = log.open("a", encoding="utf-8")
        self.process = subprocess.Popen(
            [str(python), "-m", "voice_host.worker"],
            cwd=project,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        self.pending: dict[str, list[dict[str, Any]]] = {}
        self.stderr_thread = threading.Thread(target=self._drain_stderr, daemon=True)
        self.stderr_thread.start()

    def _drain_stderr(self) -> None:
        assert self.process.stderr is not None
        for line in self.process.stderr:
            self.log_file.write(line)
            self.log_file.flush()
            safe_line = line.rstrip().encode("ascii", "backslashreplace").decode("ascii")
            print(f"[Pocket] {safe_line}", flush=True)

    def send(self, message: dict[str, Any]) -> None:
        if self.process.stdin is None:
            raise RuntimeError("Worker stdin is closed")
        raw = json.dumps(message, separators=(",", ":"))
        if len(raw.encode("utf-8")) > 1024 * 1024:
            raise ValueError("Qualification request exceeds the 1 MiB IPC limit")
        self.process.stdin.write(raw + "\n")
        self.process.stdin.flush()

    def read(self, request_id: str) -> dict[str, Any]:
        queued = self.pending.get(request_id, [])
        if queued:
            return queued.pop(0)
        assert self.process.stdout is not None
        while True:
            line = self.process.stdout.readline()
            if not line:
                raise RuntimeError(f"Worker exited while awaiting {request_id}: {self.process.poll()}")
            if len(line.encode("utf-8")) > 1024 * 1024:
                raise ValueError("Worker response exceeded the 1 MiB IPC limit")
            message = json.loads(line)
            response_id = str(message.get("id", ""))
            if response_id == request_id:
                return message
            self.pending.setdefault(response_id, []).append(message)

    def request(self, action: str, **fields: Any) -> dict[str, Any]:
        request_id = str(uuid.uuid4())
        print(f"[Gate D] sending worker action: {action}", flush=True)
        self.send({"id": request_id, "action": action, **fields})
        return self.read(request_id)

    def health(self) -> dict[str, Any]:
        result = self.request("health")
        if result.get("alive") is not True or result.get("runtimeReady") is not True:
            raise RuntimeError(f"Worker liveness/runtime readiness failed: {result}")
        return result

    def prepare(self, language: str) -> dict[str, Any]:
        voice, _ = LANGUAGES[language]
        started = time.perf_counter()
        result = self.request("prepare", language=language, voice=voice)
        duration = time.perf_counter() - started
        if result.get("type") != "prepared" or result.get("language") != language:
            raise RuntimeError(f"Model/voice prepare failed for {language}: {result}")
        health = self.health()
        if (
            health.get("modelLoaded") is not True
            or health.get("voiceReady") is not True
            or health.get("language") != language
        ):
            raise RuntimeError(f"Wrong model or stale voice state after {language} prepare: {health}")
        return {
            "language": language,
            "voice": voice,
            "sampleRate": result.get("sampleRate"),
            "prepareSeconds": round(duration, 3),
            "modelLoaded": health["modelLoaded"],
            "voiceReady": health["voiceReady"],
            "rssMb": self._rss_mb(health),
            "peakRssMb": self._peak_rss_mb(health),
        }

    def synthesize(self, language: str, text: str, cancel: bool = False) -> dict[str, Any]:
        voice, _ = LANGUAGES[language]
        request_id = str(uuid.uuid4())
        started = time.perf_counter()
        self.send({"id": request_id, "action": "synthesize", "text": text})
        first_pcm: float | None = None
        samples = 0
        nonzero = False
        chunks = 0
        sample_rate: int | None = None
        cancel_sent: float | None = None
        cancelled_at: float | None = None
        pcm_frames_after_cancel = 0
        last_pcm_after_cancel: float | None = None
        completed = False
        cpu_seconds: float | None = None
        while True:
            message = self.read(request_id)
            kind = message.get("type")
            if kind == "audio":
                if message.get("channels") != 1 or message.get("encoding") != "f32le":
                    raise RuntimeError(f"Invalid PCM format: {message}")
                rate = int(message.get("sampleRate", 0))
                data = base64.b64decode(message.get("audio", ""), validate=True)
                if not rate or len(data) == 0 or len(data) % 4:
                    raise RuntimeError("Empty or malformed PCM frame")
                sample_rate = rate
                now = time.perf_counter()
                first_pcm = first_pcm if first_pcm is not None else now - started
                if cancel_sent is not None:
                    pcm_frames_after_cancel += 1
                    last_pcm_after_cancel = now
                chunks += 1
                samples += len(data) // 4
                nonzero = nonzero or any(abs(value[0]) > 1e-7 for value in struct.iter_unpack("<f", data))
                if cancel and cancel_sent is None:
                    cancel_id = str(uuid.uuid4())
                    cancel_sent = time.perf_counter()
                    self.send({"id": cancel_id, "action": "cancel", "requestId": request_id})
                    print(f"[Gate D] cancel sent after first PCM for {language}", flush=True)
            elif kind == "cancelled":
                cpu_seconds = message.get("cpuSeconds")
                cancelled_at = time.perf_counter()
                break
            elif kind == "complete":
                cpu_seconds = message.get("cpuSeconds")
                completed = True
                break
            elif kind == "error":
                raise RuntimeError(f"Pocket synthesis failed for {language}: {message.get('message')}")
            else:
                raise RuntimeError(f"Unexpected worker event: {message}")

        if cancel:
            if cancel_sent is None or cancelled_at is None or completed:
                raise RuntimeError(f"Cancellation did not stop generation correctly for {language}")
            return {
                "language": language,
                "cancelSentAfterFirstPcm": True,
                "pcmFramesAfterCancel": pcm_frames_after_cancel,
                "lastPcmAfterCancelMs": (
                    round((last_pcm_after_cancel - cancel_sent) * 1000, 1)
                    if last_pcm_after_cancel is not None
                    else None
                ),
                "cancelAcknowledgedMs": round((cancelled_at - cancel_sent) * 1000, 1),
                "completeAfterCancel": False,
                "cpuSeconds": cpu_seconds,
            }

        if not completed or samples <= 0 or not nonzero or sample_rate != 24000:
            raise RuntimeError(f"Synthesis output failed validation for {language}")
        elapsed = time.perf_counter() - started
        duration = samples / sample_rate
        health = self.health()
        result = {
            "language": language,
            "voice": voice,
            "sampleRate": sample_rate,
            "pcmChunks": chunks,
            "samples": samples,
            "audioSeconds": round(duration, 3),
            "firstPcmSeconds": round(first_pcm or 0, 3),
            "synthesisSeconds": round(elapsed, 3),
            "rtf": round(duration / elapsed, 3),
            "workerPid": self.process.pid,
            "rssMb": self._rss_mb(health),
            "peakRssMb": self._peak_rss_mb(health),
            "cpuSeconds": cpu_seconds,
            "cpuUtilizationPercent": (
                round(cpu_seconds / elapsed * 100, 1) if isinstance(cpu_seconds, (int, float)) else None
            ),
            "completion": True,
        }
        print(f"[Gate D] synthesized {language}: {result}", flush=True)
        return result

    @staticmethod
    def _rss_mb(health: dict[str, Any]) -> float | None:
        working_set_bytes = health.get("workingSetBytes")
        if not isinstance(working_set_bytes, int) or working_set_bytes <= 0:
            return None
        return round(working_set_bytes / (1024 * 1024), 1)

    @staticmethod
    def _peak_rss_mb(health: dict[str, Any]) -> float | None:
        peak_working_set_bytes = health.get("peakWorkingSetBytes")
        if not isinstance(peak_working_set_bytes, int) or peak_working_set_bytes <= 0:
            return None
        return round(peak_working_set_bytes / (1024 * 1024), 1)

    def close(self) -> None:
        if self.process.poll() is None:
            self.process.terminate()
            self.process.wait(timeout=15)
        self.stderr_thread.join(timeout=2)
        self.log_file.close()


class GpuMemorySampler:
    def __init__(self) -> None:
        self.available = shutil.which("nvidia-smi") is not None
        self.samples: list[list[int]] = []
        self.errors: list[str] = []
        self.lock = threading.Lock()
        self.stop_event = threading.Event()
        self.thread: threading.Thread | None = None

    def snapshot(self) -> list[int] | None:
        if not self.available:
            return None
        try:
            result = subprocess.run(
                ["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
                check=True,
                capture_output=True,
                text=True,
                timeout=5,
            )
            values = [int(line.strip()) for line in result.stdout.splitlines() if line.strip()]
            with self.lock:
                self.samples.append(values)
            return values
        except (OSError, subprocess.SubprocessError, ValueError) as error:
            with self.lock:
                self.errors.append(str(error))
            return None

    def start(self) -> None:
        self.snapshot()
        self.thread = threading.Thread(target=self._sample_periodically, daemon=True)
        self.thread.start()

    def _sample_periodically(self) -> None:
        while not self.stop_event.wait(1):
            self.snapshot()

    def finish(self) -> dict[str, Any]:
        self.snapshot()
        self.stop_event.set()
        if self.thread is not None:
            self.thread.join(timeout=6)
        with self.lock:
            samples = list(self.samples)
            errors = list(self.errors)
        if not samples:
            return {"available": self.available, "sampleCount": 0, "errors": errors}
        gpu_count = min(len(row) for row in samples)
        peak = [max(row[index] for row in samples if len(row) > index) for index in range(gpu_count)]
        return {
            "available": True,
            "sampleCount": len(samples),
            "beforeMiB": samples[0],
            "peakDuringRunMiB": peak,
            "afterMiB": samples[-1],
            "peakDeltaMiB": [peak[index] - samples[0][index] for index in range(gpu_count)],
            "systemWideOnly": True,
            "errors": errors,
        }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cold-cache-initially-empty", action="store_true")
    args = parser.parse_args()
    project = args.project.resolve()
    python = project / ".venv" / "Scripts" / "python.exe"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    report: dict[str, Any] = {
        "provider": "pocket-tts",
        "version": "3.1.0",
        "python": sys.version,
        "modelCache": os.environ.get("HF_HOME"),
        "coldCacheInitiallyEmpty": args.cold_cache_initially_empty,
        "languageRuns": [],
        "switchRuns": [],
    }
    worker = Worker(python, project, args.output.with_suffix(".worker.log"))
    gpu_sampler = GpuMemorySampler()
    try:
        report["workerPid"] = worker.process.pid
        print(f"[Gate D] worker started, pid={worker.process.pid}", flush=True)
        report["initialHealth"] = worker.health()
        gpu_sampler.start()
        for language in LANGUAGES:
            print(f"[Gate D] cold language qualification: {language}", flush=True)
            prepare = worker.prepare(language)
            synthesis = worker.synthesize(language, LANGUAGES[language][1])
            report["languageRuns"].append({"prepare": prepare, "synthesis": synthesis})
        for cycle in range(1, 3):
            for language in SWITCH_ORDER:
                print(f"[Gate D] model/voice switch qualification cycle {cycle}: {language}", flush=True)
                prepare = worker.prepare(language)
                synthesis = worker.synthesize(language, LANGUAGES[language][1])
                report["switchRuns"].append({"cycle": cycle, "prepare": prepare, "synthesis": synthesis})
        report["switchRssMb"] = [row["prepare"]["rssMb"] for row in report["switchRuns"]]
        worker.prepare("en")
        report["cancellation"] = worker.synthesize(
            "en", "A long cancellation qualification sentence. " * 512, cancel=True
        )
        after_cancel = worker.health()
        if after_cancel.get("language") != "en" or after_cancel.get("voiceReady") is not True:
            raise RuntimeError(f"Worker health failed after cancellation: {after_cancel}")
        report["healthAfterCancel"] = after_cancel
        report["rssAfterCancelMb"] = worker._rss_mb(after_cancel)
        report["reuseAfterCancellation"] = worker.synthesize("en", LANGUAGES["en"][1])
        if report["reuseAfterCancellation"]["workerPid"] != report["workerPid"]:
            raise RuntimeError("Worker process changed between cancellation and reuse")
        report["gpuMemory"] = gpu_sampler.finish()
        args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"[Gate D] language report saved: {args.output}", flush=True)
        return 0
    except Exception as error:
        report["error"] = str(error)
        report["gpuMemory"] = gpu_sampler.finish()
        args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
        raise
    finally:
        if gpu_sampler.thread is not None and not gpu_sampler.stop_event.is_set():
            report["gpuMemory"] = gpu_sampler.finish()
        worker.close()


if __name__ == "__main__":
    raise SystemExit(main())
