from __future__ import annotations

import base64
import faulthandler
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any

REPOSITORY = Path(__file__).resolve().parents[2]
PROJECT = REPOSITORY / "packages" / "piper-host"
PYTHON = PROJECT / ".venv" / "Scripts" / "python.exe"
LANGUAGES = {
    "en": "Piper qualification sentence in English.",
    "fr": "Phrase de qualification Piper en français.",
    "es": "Frase de cualificación de Piper en español.",
    "it": "Frase di qualificazione Piper in italiano.",
    "de": "Piper-Qualifikationssatz auf Deutsch.",
}


class GpuSampler:
    def __init__(self) -> None:
        self.samples: list[list[int]] = []
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self.sample, daemon=True)

    def read(self) -> None:
        if shutil.which("nvidia-smi") is None:
            return
        try:
            result = subprocess.run(
                ["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
                check=True,
                capture_output=True,
                text=True,
                timeout=5,
            )
            self.samples.append([int(line.strip()) for line in result.stdout.splitlines() if line.strip()])
        except (OSError, subprocess.SubprocessError, ValueError):
            return

    def sample(self) -> None:
        while not self.stop_event.wait(1):
            self.read()

    def start(self) -> None:
        self.read()
        self.thread.start()

    def finish(self) -> dict[str, Any]:
        self.read()
        self.stop_event.set()
        self.thread.join(timeout=6)
        if not self.samples:
            return {"available": False, "deviceDeltaMb": None, "workerDeltaMb": 0}
        baseline = self.samples[0]
        maximum = [max(sample[index] for sample in self.samples if len(sample) > index) for index in range(len(baseline))]
        return {
            "available": True,
            "deviceDeltaMb": [maximum[index] - baseline[index] for index in range(len(baseline))],
            "workerDeltaMb": 0,
            "note": "The Piper worker was verified CPUExecutionProvider-only; device-level deltas may include unrelated GPU activity.",
        }


class PiperProcess:
    def __init__(self, assets: Path, log_path: Path) -> None:
        environment = os.environ.copy()
        environment["UNIFIA_PIPER_ASSET_DIR"] = str(assets)
        environment["CUDA_VISIBLE_DEVICES"] = ""
        environment["PYTHONPATH"] = str(PROJECT)
        self.log = log_path.open("w", encoding="utf-8")
        self.process = subprocess.Popen(
            [str(PYTHON), "-m", "piper_host.worker"],
            cwd=PROJECT,
            env=environment,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=self.log,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )
        print(f"[Piper] worker started: pid={self.process.pid}", flush=True)

    def request(self, action: str, **fields: Any) -> tuple[dict[str, Any], float]:
        request_id = str(uuid.uuid4())
        assert self.process.stdin and self.process.stdout
        self.process.stdin.write(json.dumps({"id": request_id, "action": action, **fields}) + "\n")
        self.process.stdin.flush()
        print(f"[Piper] waiting: action={action} language={fields.get('language', '-')}", flush=True)
        started = time.perf_counter()
        reported_mb = 0
        while True:
            line = self.process.stdout.readline()
            if not line:
                raise RuntimeError(f"Piper worker exited ({self.process.poll()}) during {action}")
            response = json.loads(line)
            if response.get("id") != request_id:
                continue
            if response.get("type") == "progress":
                downloaded = int(response.get("downloadedBytes", 0))
                total = int(response.get("totalBytes", 0))
                downloaded_mb = downloaded // (25 * 1024 * 1024)
                if downloaded_mb > reported_mb:
                    print(f"[Piper] {fields.get('language')} model download: {downloaded // 1048576}/{total // 1048576} MiB", flush=True)
                    reported_mb = downloaded_mb
                continue
            if response.get("type") == "error":
                raise RuntimeError(response.get("message", "Piper worker error"))
            return response, (time.perf_counter() - started) * 1000

    def synthesize(self, language: str, text: str) -> dict[str, Any]:
        request_id = str(uuid.uuid4())
        assert self.process.stdin and self.process.stdout
        self.process.stdin.write(json.dumps({"id": request_id, "action": "synthesize", "text": text}) + "\n")
        self.process.stdin.flush()
        started = time.perf_counter()
        first_audio_ms: float | None = None
        sample_rate = 0
        audio_bytes = 0
        nonzero = False
        while True:
            line = self.process.stdout.readline()
            if not line:
                raise RuntimeError(f"Piper worker exited ({self.process.poll()}) during {language} synthesis")
            response = json.loads(line)
            if response.get("id") != request_id:
                continue
            if response.get("type") == "audio":
                if first_audio_ms is None:
                    first_audio_ms = (time.perf_counter() - started) * 1000
                sample_rate = int(response["sampleRate"])
                pcm = base64.b64decode(response["audio"], validate=True)
                audio_bytes += len(pcm)
                nonzero = nonzero or any(pcm)
            elif response.get("type") == "complete":
                wall_ms = (time.perf_counter() - started) * 1000
                audio_ms = audio_bytes / (sample_rate * 2) * 1000 if sample_rate else 0
                if audio_ms <= 0 or not nonzero:
                    raise RuntimeError(f"Piper returned empty or silent audio for {language}")
                return {
                    "language": language,
                    "sampleRate": sample_rate,
                    "audioBytes": audio_bytes,
                    "audioDurationMs": round(audio_ms, 1),
                    "ttfaMs": round(first_audio_ms or 0, 1),
                    "synthesisWallMs": round(wall_ms, 1),
                    "rtf": round(wall_ms / audio_ms, 3),
                    "cpuSeconds": response.get("cpuSeconds"),
                    "cpuUtilizationPercent": round(float(response.get("cpuSeconds", 0)) / (wall_ms / 1000) * 100, 1),
                    "nonSilent": nonzero,
                }
            elif response.get("type") in {"error", "cancelled"}:
                raise RuntimeError(response.get("message", f"Piper {response['type']} for {language}"))

    def close(self) -> None:
        if self.process.poll() is None:
            try:
                response, _ = self.request("dispose")
                if response.get("type") == "disposed" and self.process.stdin:
                    self.process.stdin.close()
                self.process.wait(timeout=10)
            except (OSError, subprocess.SubprocessError, RuntimeError):
                self.process.kill()
                self.process.wait(timeout=10)
        self.log.close()


def main() -> int:
    faulthandler.dump_traceback_later(15, repeat=True)
    if not PYTHON.is_file():
        raise RuntimeError(f"Piper environment missing: {PYTHON}; run uv sync --locked --project packages/piper-host")
    artifact = REPOSITORY / ".build-temp"
    assets = artifact
    gpu = GpuSampler()
    gpu.start()
    worker = PiperProcess(assets, artifact / "piper-qualification-worker.log")
    results: list[dict[str, Any]] = []
    try:
        health, _ = worker.request("health")
        if health.get("runtimeReady") is not True or "CPUExecutionProvider" not in health.get("availableProviders", []):
            raise RuntimeError(f"Unexpected Piper runtime/providers: {health}")
        for language, text in LANGUAGES.items():
            print(f"[Piper] qualifying {language}", flush=True)
            prepared, prepare_ms = worker.request("prepare", language=language)
            if prepared.get("type") != "prepared" or prepared.get("language") != language:
                raise RuntimeError(f"Unexpected prepared model for {language}: {prepared}")
            if prepared.get("providers") != ["CPUExecutionProvider"]:
                raise RuntimeError(f"Unexpected active ONNX providers for {language}: {prepared.get('providers')}")
            synthesis = worker.synthesize(language, text)
            after, _ = worker.request("health")
            synthesis.update({
                "voice": prepared.get("voice"),
                "prepareMs": round(prepare_ms, 1),
                "rssMb": round(after["workingSetBytes"] / 1048576, 1) if after.get("workingSetBytes") else None,
                "peakRssMb": round(after["peakWorkingSetBytes"] / 1048576, 1) if after.get("peakWorkingSetBytes") else None,
            })
            results.append(synthesis)
            print(json.dumps(synthesis, ensure_ascii=False), flush=True)
        report = {
            "status": "PASS",
            "provider": "piper",
            "runtimeVersion": "1.8.0",
            "availableProviders": health.get("availableProviders"),
            "processId": health.get("processId"),
            "voices": results,
            "gpuMemory": gpu.finish(),
        }
        report_path = artifact / "piper-qualification-report.json"
        report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps({"report": str(report_path), "status": report["status"]}), flush=True)
        return 0
    finally:
        worker.close()
        if gpu.thread.is_alive():
            gpu.finish()


if __name__ == "__main__":
    raise SystemExit(main())
