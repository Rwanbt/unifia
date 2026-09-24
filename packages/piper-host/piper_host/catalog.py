"""Immutable Piper voice provenance and asset pins."""

from __future__ import annotations

from dataclasses import dataclass


VOICE_REPOSITORY = "rhasspy/piper-voices"
VOICE_REVISION = "c10ece1aade47bb51c153c893d14e5bf8e5b7117"
VOICE_REPOSITORY_URL = f"https://huggingface.co/{VOICE_REPOSITORY}"


@dataclass(frozen=True)
class VoiceAsset:
    filename: str
    relative_path: str
    sha256: str
    size_bytes: int

    @property
    def url(self) -> str:
        return f"{VOICE_REPOSITORY_URL}/resolve/{VOICE_REVISION}/{self.relative_path}"


@dataclass(frozen=True)
class PiperVoiceManifest:
    provider: str
    id: str
    language: str
    display_name: str
    model_version: str
    source: str
    license: str
    license_source: str
    model: VoiceAsset
    config: VoiceAsset
    redistributable: bool = True


def _voice(
    *,
    voice_id: str,
    language: str,
    display_name: str,
    folder: str,
    model_filename: str,
    model_sha256: str,
    model_size: int,
    config_sha256: str,
    config_size: int,
    license_text: str,
    card_path: str,
    license_url: str | None = None,
) -> PiperVoiceManifest:
    card_url = f"{VOICE_REPOSITORY_URL}/blob/{VOICE_REVISION}/{card_path}"
    prefix = f"{folder}/{model_filename}"
    return PiperVoiceManifest(
        provider="piper",
        id=voice_id,
        language=language,
        display_name=display_name,
        model_version=VOICE_REVISION,
        source=card_url,
        license=license_text,
        license_source=license_url or card_url,
        model=VoiceAsset(
            model_filename,
            prefix,
            model_sha256,
            model_size,
        ),
        config=VoiceAsset(
            f"{model_filename}.json",
            f"{prefix}.json",
            config_sha256,
            config_size,
        ),
    )


VOICES = {
    "en": _voice(
        voice_id="en_US-ljspeech-medium",
        language="en",
        display_name="English (United States) — LJSpeech",
        folder="en/en_US/ljspeech/medium",
        model_filename="en_US-ljspeech-medium.onnx",
        model_sha256="6f52a751e2349abe7a76735eb09dc1875298c77ea2342ffd2fef79ff81b87f22",
        model_size=63_531_379,
        config_sha256="141d612cc0a95ed7efc1ca936b845c2364967f2e9217c5dbfcf69fc4d6c65860",
        config_size=4_972,
        license_text="MIT (voice repository); Public Domain (LJ Speech dataset)",
        card_path="en/en_US/ljspeech/medium/MODEL_CARD",
    ),
    "fr": _voice(
        voice_id="fr_FR-mls-medium",
        language="fr",
        display_name="Français (France) — MLS",
        folder="fr/fr_FR/mls/medium",
        model_filename="fr_FR-mls-medium.onnx",
        model_sha256="0ed223f78466917f2bae05ee90096ce69ab1fdeb251f55590d0e7422d234e162",
        model_size=76_733_750,
        config_sha256="252b0b0a6e4cc4949e23eccb956f9c779986c32f934f2f7e2191e5fdc2edca61",
        config_size=7_036,
        license_text="MIT (voice repository); CC-BY-4.0 (MLS dataset; trained from scratch)",
        card_path="fr/fr_FR/mls/medium/MODEL_CARD",
    ),
    "es": _voice(
        voice_id="es_ES-carlfm-x_low",
        language="es",
        display_name="Español (España) — carlfm",
        folder="es/es_ES/carlfm/x_low",
        model_filename="es_ES-carlfm-x_low.onnx",
        model_sha256="d69677323a907cd4963f42b29c20a98b5d6bfa7f3e64df339915e4650c00d125",
        model_size=28_130_791,
        config_sha256="d9bdfa9ff01eb2bc9e62e7d2593939d1e4c4d8eb7cf75f972731539d12399966",
        config_size=4_159,
        license_text="MIT (voice repository); Public Domain dataset; trained from scratch",
        card_path="es/es_ES/carlfm/x_low/MODEL_CARD",
    ),
    "it": _voice(
        voice_id="it_IT-riccardo-x_low",
        language="it",
        display_name="Italiano (Italia) — riccardo",
        folder="it/it_IT/riccardo/x_low",
        model_filename="it_IT-riccardo-x_low.onnx",
        model_sha256="1368de15f123275a7ef951c9e5e30be0f58a032daa14a0da44037443c1d1d21b",
        model_size=28_130_791,
        config_sha256="146ab9c634afe524e9fb7530f2510df7a42fb1db56b52658ca1fb3d98001a62a",
        config_size=4_161,
        license_text=(
            "MIT (voice repository); M-AILABS dataset license permits commercial "
            "redistribution with attribution and no endorsement"
        ),
        card_path="it/it_IT/riccardo/x_low/MODEL_CARD",
        license_url="https://www.caito.de/2019/01/03/the-m-ailabs-speech-dataset/",
    ),
    "de": _voice(
        voice_id="de_DE-mls-medium",
        language="de",
        display_name="Deutsch (Deutschland) — MLS",
        folder="de/de_DE/mls/medium",
        model_filename="de_DE-mls-medium.onnx",
        model_sha256="69cd1d2aa5a35839a518966fcc4924b5f93e5f8c948ed0752b1a616ad53f65bf",
        model_size=76_961_079,
        config_sha256="b0af1c89ddfdc72d32e015729b0e89b99eec13c2c8caa1db7488d98e9e570b40",
        config_size=8_948,
        license_text="MIT (voice repository); CC-BY-4.0 (MLS dataset; trained from scratch)",
        card_path="de/de_DE/mls/medium/MODEL_CARD",
    ),
}


def resolve_voice(language: str, voice_id: str | None) -> PiperVoiceManifest:
    if language not in VOICES:
        raise ValueError(f"Unsupported Piper language: {language}")
    manifest = VOICES[language]
    if voice_id and voice_id in VOICES_BY_ID and VOICES_BY_ID[voice_id] != manifest:
        raise ValueError(f"Voice {voice_id} does not match language {language}")
    return manifest


VOICES_BY_ID = {manifest.id: manifest for manifest in VOICES.values()}
