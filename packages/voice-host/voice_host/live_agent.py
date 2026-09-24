"""LiveKit's STT-only worker; Unifia remains the sole conversation agent."""

from __future__ import annotations

import os
from typing import Any

os.environ["CUDA_VISIBLE_DEVICES"] = ""
os.environ.setdefault("OMP_NUM_THREADS", "2")
os.environ.setdefault("MKL_NUM_THREADS", "2")

from livekit import agents
from livekit.agents import Agent, AgentSession, JobContext, JobProcess, inference
from livekit.plugins import silero

from .parakeet_stt import ParakeetSTT, load_parakeet_model

AGENT_NAME = "unifia-voice-transcriber"


def _required_secret(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Required LiveKit worker setting is missing: {name}")
    return value


def prewarm(process: JobProcess) -> None:
    """Load speech inference with explicit CPU execution before accepting jobs."""
    process.userdata["vad"] = silero.VAD.load(force_cpu=True, sample_rate=16_000)
    process.userdata["stt"] = ParakeetSTT(load_parakeet_model())


def create_transcription_session(
    *,
    stt_adapter: ParakeetSTT,
    vad_model: Any,
    turn_detector: Any,
) -> AgentSession:
    """Build a transport session with no LLM, TTS, memory, or tools."""
    return AgentSession(
        stt=stt_adapter,
        vad=vad_model,
        turn_handling={"turn_detection": turn_detector},
        user_away_timeout=None,
    )


async def entrypoint(context: JobContext) -> None:
    await context.connect(auto_subscribe=agents.AutoSubscribe.AUDIO_ONLY)
    session = create_transcription_session(
        stt_adapter=context.proc.userdata["stt"],
        vad_model=context.proc.userdata["vad"],
        turn_detector=inference.TurnDetector(version="v1-mini"),
    )
    await session.start(
        agent=Agent(instructions="Transcribe user audio only. Unifia handles all responses and actions."),
        room=context.room,
    )


def main() -> None:
    worker_options = agents.WorkerOptions(
        entrypoint_fnc=entrypoint,
        prewarm_fnc=prewarm,
        agent_name=AGENT_NAME,
        ws_url=_required_secret("LIVEKIT_URL"),
        api_key=_required_secret("LIVEKIT_API_KEY"),
        api_secret=_required_secret("LIVEKIT_API_SECRET"),
        log_level="INFO",
        num_idle_processes=0,
        port=0,
        job_memory_warn_mb=2_000,
        job_memory_limit_mb=0,
    )
    agents.cli.run_app(worker_options)


if __name__ == "__main__":
    main()
