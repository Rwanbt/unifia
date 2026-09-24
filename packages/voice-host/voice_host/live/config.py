"""Live Voice Host configuration, read from the environment set by the supervisor."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from .bridge import ServerEndpoint

CPU_PROFILES: dict[str, dict[str, int]] = {
    # Speech stays on the CPU so the GPU remains available to the local LLM.
    "eco": {"pocket": 1, "stt": 2, "piper": 1},
    "balanced": {"pocket": 2, "stt": 2, "piper": 1},
    "fast": {"pocket": 4, "stt": 4, "piper": 2},
}


@dataclass(frozen=True)
class LiveConfig:
    livekit_url: str
    api_key: str
    api_secret: str
    server: ServerEndpoint
    parakeet_dir: Path | None
    piper_project: Path | None
    piper_assets: Path | None
    tts_provider: str
    cpu_profile: str

    @property
    def threads(self) -> dict[str, int]:
        return CPU_PROFILES.get(self.cpu_profile, CPU_PROFILES["balanced"])

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "LiveConfig":
        env = dict(os.environ if env is None else env)
        missing = [
            key
            for key in (
                "LIVEKIT_URL",
                "LIVEKIT_API_KEY",
                "LIVEKIT_API_SECRET",
                "UNIFIA_SERVER_URL",
                "UNIFIA_SERVER_PASSWORD",
            )
            if not env.get(key)
        ]
        if missing:
            raise RuntimeError(f"Live Voice Host is missing configuration: {', '.join(missing)}")

        def optional_path(key: str) -> Path | None:
            value = env.get(key)
            return Path(value) if value else None

        return cls(
            livekit_url=env["LIVEKIT_URL"],
            api_key=env["LIVEKIT_API_KEY"],
            api_secret=env["LIVEKIT_API_SECRET"],
            server=ServerEndpoint(
                url=env["UNIFIA_SERVER_URL"].rstrip("/"),
                username=env.get("UNIFIA_SERVER_USERNAME") or "unifia",
                password=env["UNIFIA_SERVER_PASSWORD"],
            ),
            parakeet_dir=optional_path("UNIFIA_PARAKEET_DIR"),
            piper_project=optional_path("UNIFIA_PIPER_PROJECT"),
            piper_assets=optional_path("UNIFIA_PIPER_ASSET_DIR"),
            tts_provider=env.get("UNIFIA_TTS_PROVIDER", "auto"),
            cpu_profile=env.get("UNIFIA_VOICE_CPU_PROFILE", "balanced"),
        )
