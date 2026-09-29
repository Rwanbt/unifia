from __future__ import annotations

import argparse
import json
import os
import runpy
import statistics
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SWITCH_ORDER = ("en", "fr", "de", "es", "it", "en")
MB = 1024 * 1024


def record(
    rows: list[dict[str, Any]],
    phase: str,
    cycle: int,
    language: str,
    request: dict[str, Any],
    pid: int,
    started: float,
) -> None:
    row = {
        "requestNumber": len(rows) + 1,
        "cycle": cycle,
        "phase": phase,
        "language": language,
        "elapsedSeconds": round(time.perf_counter() - started, 3),
        "workerPid": pid,
        **request,
    }
    rows.append(row)
    print(json.dumps(row, separators=(",", ":")), flush=True)


def cycle_endpoints(rows: list[dict[str, Any]], cycles: int) -> list[dict[str, Any]]:
    endpoints = []
    for cycle in range(1, cycles + 1):
        samples = [row for row in rows if row["cycle"] == cycle]
        if not samples:
            continue
        endpoints.append(
            {
                "cycle": cycle,
                "workingSetMb": samples[-1]["rssMb"],
                "privateMb": (
                    round(samples[-1]["privateBytes"] / MB, 1)
                    if samples[-1]["privateBytes"] is not None
                    else None
                ),
            }
        )
    return endpoints


def build_summary(rows: list[dict[str, Any]], cycles: int) -> dict[str, Any]:
    endpoints = cycle_endpoints(rows, cycles)
    working_set = [row["workingSetMb"] for row in endpoints if row["workingSetMb"]]
    private = [row["privateMb"] for row in endpoints if row["privateMb"]]
    tail = working_set[-5:]
    tail_range = round(max(tail) - min(tail), 1) if tail else None
    return {
        "cycles": cycles,
        "requests": len(rows),
        "allSynthesisCompleted": all(
            row["completion"] for row in rows if row["phase"] == "synthesis"
        ),
        "allWorkersSamePid": len({row["workerPid"] for row in rows}) == 1,
        "workingSetCycleEndpointsMb": working_set,
        "privateBytesCycleEndpointsMb": private,
        "finalFiveWorkingSetRangeMb": tail_range,
        "maximumWorkingSetMb": max(working_set) if working_set else None,
        "finalWorkingSetMb": working_set[-1] if working_set else None,
        "finalFiveWorkingSetMedianMb": round(statistics.median(tail), 1) if tail else None,
        "staleModelOrVoiceState": any(
            not row.get("modelLoaded") or not row.get("voiceReady")
            for row in rows
            if row["phase"] == "prepare"
        ),
    }


def sample_external_windows_memory(pid: int) -> dict[str, int] | None:
    if os.name != "nt":
        return None
    command = (
        f"$process = Get-Process -Id {pid}; "
        "[PSCustomObject]@{ workingSetBytes = $process.WorkingSet64; "
        "peakWorkingSetBytes = $process.PeakWorkingSet64; "
        "privateBytes = $process.PrivateMemorySize64 } | ConvertTo-Json -Compress"
    )
    result = subprocess.run(
        ["powershell.exe", "-NoProfile", "-Command", command],
        check=True,
        capture_output=True,
        text=True,
        timeout=15,
    )
    return json.loads(result.stdout)


def main() -> int:
    parser = argparse.ArgumentParser(description="Ten-cycle managed Pocket memory soak")
    parser.add_argument("--project", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cycles", type=int, default=10)
    args = parser.parse_args()
    if args.cycles < 10:
        parser.error("Gate D memory qualification requires at least 10 cycles")

    repo = Path(__file__).resolve().parents[2]
    harness = runpy.run_path(str(repo / "scripts" / "voice" / "qualify-pocket-worker.py"))
    worker_type = harness["Worker"]
    languages = harness["LANGUAGES"]
    args.output = args.output.resolve()
    args.project = args.project.resolve()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    log_path = args.output.with_suffix(".worker.log")
    runtime_root = args.project.parent / "runtime"
    os.environ["HF_HOME"] = str(runtime_root / "huggingface")
    os.environ["HUGGINGFACE_HUB_CACHE"] = str(runtime_root / "huggingface" / "hub")
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["CUDA_VISIBLE_DEVICES"] = ""
    os.environ.setdefault("OMP_NUM_THREADS", "2")
    os.environ.setdefault("MKL_NUM_THREADS", "2")
    os.environ.setdefault("OPENBLAS_NUM_THREADS", "2")
    worker = worker_type(Path(sys.executable), args.project, log_path)
    rows: list[dict[str, Any]] = []
    started = time.perf_counter()
    report: dict[str, Any] = {
        "startedAtUtc": datetime.now(timezone.utc).isoformat(),
        "launcherPid": worker.process.pid,
        "cycleOrder": list(SWITCH_ORDER),
        "measurements": rows,
    }
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")

    try:
        expected_pid = worker.health().get("processId")
        if not isinstance(expected_pid, int):
            raise RuntimeError("Worker health did not report its process id")
        for cycle in range(1, args.cycles + 1):
            for language in SWITCH_ORDER:
                prepared = worker.prepare(language)
                health = worker.health()
                if health.get("processId") != expected_pid:
                    raise RuntimeError("The Pocket worker process changed during the soak")
                record(
                    rows,
                    "prepare",
                    cycle,
                    language,
                    {**prepared, "workerPid": expected_pid, "privateBytes": health.get("privateBytes")},
                    expected_pid,
                    started,
                )
                synthesized = worker.synthesize(language, languages[language][1])
                health = worker.health()
                if (
                    health.get("processId") != expected_pid
                    or health.get("language") != language
                    or health.get("voiceReady") is not True
                ):
                    raise RuntimeError(f"Stale model/voice state after {language}: {health}")
                record(
                    rows,
                    "synthesis",
                    cycle,
                    language,
                    {
                        **synthesized,
                        "workerPid": expected_pid,
                        "privateBytes": health.get("privateBytes"),
                        "modelLoaded": health["modelLoaded"],
                        "voiceReady": health["voiceReady"],
                    },
                    expected_pid,
                    started,
                )
            external_memory = sample_external_windows_memory(expected_pid)
            if external_memory is not None:
                report.setdefault("externalWindowsMemory", []).append(
                    {
                        "cycle": cycle,
                        "workerPid": expected_pid,
                        **external_memory,
                    }
                )
            report["summary"] = build_summary(rows, cycle)
            report["lastCompletedCycle"] = cycle
            args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
            print(f"[Gate D soak] cycle {cycle}/{args.cycles}: {report['summary']}", flush=True)
        report["finishedAtUtc"] = datetime.now(timezone.utc).isoformat()
        report["summary"] = build_summary(rows, args.cycles)
        report["status"] = "completed"
        args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
        return 0
    except Exception as error:
        report["status"] = "failed"
        report["error"] = str(error)
        report["summary"] = build_summary(rows, max(1, min(args.cycles, rows[-1]["cycle"] if rows else 1)))
        args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
        raise
    finally:
        worker.close()

if __name__ == "__main__":
    raise SystemExit(main())
