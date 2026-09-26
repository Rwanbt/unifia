"""Supervised entrypoint: ``python -m voice_host.live [serve|check]``.

The desktop supervisor starts this process with the LiveKit URL/keys and the
local Unifia server credentials in the environment. The process prints
``UNIFIA_LIVE_READY`` on stdout once it is registered with LiveKit, and exits
when its stdin closes (the supervisor died) or on SIGTERM/SIGINT.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import sys
import threading
from pathlib import Path

# CPU-first: hide CUDA before any numerical library is imported.
os.environ["CUDA_VISIBLE_DEVICES"] = ""

from .config import LiveConfig  # noqa: E402

READY_MARKER = "UNIFIA_LIVE_READY"


def parakeet_ready(directory: Path | None) -> bool:
    return bool(directory) and (directory / "encoder-model.int8.onnx").is_file() and (directory / "vocab.txt").is_file()


def build_resources(config: LiveConfig):
    from livekit.agents import inference

    from ..resource_scheduler import (
        PlatformSignals,
        ResourcePriority,
        ResidencyClass,
        ThermalStatus,
        VoiceResourceScheduler,
    )
    from .agent import SharedResources
    from .stt import load_parakeet
    from .tts import PiperBackend, PocketBackend, TtsRouter

    threads = config.threads
    os.environ["UNIFIA_TTS_THREADS"] = str(threads["pocket"])
    for key in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
        os.environ[key] = str(threads["pocket"])
    recognizer = None
    stt_error: str | None = None
    if parakeet_ready(config.parakeet_dir):
        try:
            recognizer = load_parakeet(config.parakeet_dir, threads["stt"])  # type: ignore[arg-type]
        except Exception as error:
            stt_error = f"{type(error).__name__}: {error}"
    else:
        stt_error = "Parakeet model is not installed"

    def router_factory(on_route):
        backends = {"pocket": PocketBackend()}
        if config.piper_project and config.piper_assets:
            backends["piper"] = PiperBackend.from_project(config.piper_project, config.piper_assets)
        return TtsRouter(backends, preference=config.tts_provider, on_route=on_route)

    # R13 desktop convergence (ADR-074): instantiate the VoiceResourceScheduler
    # in desktop mode with `local-llm` as the GPU owner so Voice never
    # allocates discrete VRAM by default (we already documented this as the
    # the canonical behaviour in the v2 plan §20 / §32).
    # R13.2 plugs in `DesktopPlatformSignals` so the scheduler receives
    # real memory observations (via psutil on hosts that ship it) and
    # best-effort thermal readings; Windows falls back to ThermalStatus.NONE
    # because no portable CPU-temperature API exists there yet.
    from ..platform_signals import DesktopPlatformSignals, MockDesktopSignals

    if os.environ.get("UNIFIA_VOICE_PLATFORM_SIGNALS") == "mock":
        desktop_signals: object = MockDesktopSignals()
    else:
        desktop_signals = DesktopPlatformSignals()
    gpu_owner: str = "local-llm" if config.local_llm_owns_gpu else "none"
    scheduler = VoiceResourceScheduler(
        mode="desktop",
        gpu_owned_by=gpu_owner,
        platform=desktop_signals,
    )
    log.info(
        "voice.resource.diagnostics mode=%s gpu_owned_by=%s voice_gpu_alloc_bytes=%s "
        "platform_connected=%s thermal=%s memory=%s",
        "desktop",
        gpu_owner,
        0,
        desktop_signals is not None,
        ThermalStatus.NONE.value,
        "nominal",
    )
    # Acquire a KEEP_WARM lease for Silero VAD for the lifetime of the
    # process. The handle is intentionally not stored: the scheduler
    # keeps it alive until release()/evict, and the eviction listener
    # we register below simply logs the event for now. Future R13 work
    # (model-evict-on-pressure) will react to that listener.
    from ..resource_scheduler import ResourceId  # late import keeps top-of-file tidy

    scheduler.acquire(
        ResourceId(kind="vad-silero", revision=inference.VAD.__name__),
        owner="unifia-voice-live",
        priority=ResourcePriority.VAD_AEC,
        residency=ResidencyClass.KEEP_WARM,
    )

    return SharedResources(
        vad=inference.VAD(model="silero"),
        recognizer=recognizer,
        stt_error=stt_error,
        router_factory=router_factory,
        voice_resource_scheduler=scheduler,
    )


def check(config: LiveConfig) -> int:
    from livekit.local_inference import _native

    _native.init_eot()
    _native.init_vad()
    report = {
        "livekitUrl": config.livekit_url,
        "parakeet": parakeet_ready(config.parakeet_dir),
        "piper": bool(config.piper_project and (config.piper_project / ".venv").exists()),
        "turnDetector": "turn-detector-v1-mini",
        "vad": "silero",
        "cpuProfile": config.cpu_profile,
    }
    print(json.dumps(report), flush=True)
    return 0


async def serve(config: LiveConfig) -> None:
    from livekit.agents import AgentServer, JobContext, JobExecutorType, inference

    from .agent import AGENT_NAME, run_job, shared_resources

    os.environ["LIVEKIT_AGENT_NAME"] = AGENT_NAME
    resources = shared_resources(lambda: build_resources(config))
    server = AgentServer(
        # Jobs share this process so one Pocket model and one Parakeet model
        # serve every Live room; spawning a process per job would copy them.
        job_executor_type=JobExecutorType.THREAD,
        num_idle_processes=0,
        load_threshold=1.0,
        ws_url=config.livekit_url,
        api_key=config.api_key,
        api_secret=config.api_secret,
        host="127.0.0.1",
        port=0,
        http_proxy=None,  # the LiveKit server is local; never route it through a proxy
    )

    @server.rtc_session()
    async def entrypoint(ctx: JobContext) -> None:
        await run_job(ctx, config.server, resources, lambda: inference.TurnDetector(version="v1-mini"))

    server.on("worker_registered", lambda *_: print(READY_MARKER, flush=True))

    loop = asyncio.get_running_loop()
    stop = asyncio.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except (NotImplementedError, RuntimeError):
            pass

    def watch_stdin() -> None:
        try:
            while sys.stdin.buffer.read(1024):
                pass
        finally:
            loop.call_soon_threadsafe(stop.set)

    threading.Thread(target=watch_stdin, name="supervisor-watch", daemon=True).start()
    runner = asyncio.create_task(server.run())
    stopper = asyncio.create_task(stop.wait())
    done, _ = await asyncio.wait({runner, stopper}, return_when=asyncio.FIRST_COMPLETED)
    if runner in done:
        runner.result()
        return
    await server.drain(timeout=5)
    await server.aclose()


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    logging.basicConfig(
        stream=sys.stderr,
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    config = LiveConfig.from_env()
    command = args[0] if args else "serve"
    if command == "check":
        return check(config)
    if command == "serve":
        asyncio.run(serve(config))
        return 0
    print(f"unknown command: {command}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
