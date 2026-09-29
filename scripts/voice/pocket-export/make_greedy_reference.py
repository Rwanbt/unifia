"""Generate a DETERMINISTIC eager PyTorch reference for the section 24 gate.

The stock `pocket_tts generate` CLI samples at the config's temperature (0.3),
so repeated runs of the same text against the same weights produced reference
durations of 5.960s, 7.400s and 8.520s for the same Spanish sentence. Comparing
a candidate render against a moving target makes a +/-25% duration limit
unreliable in both directions: it can fail a good render or pass a broken one.

This runs the same eager code path at temperature 0, so the reference is
reproducible and both sides of the comparison are deterministic. It is
deliberately not the CLI, because the CLI does not expose temperature.
"""

import sys
import wave
from array import array
from pathlib import Path

import torch

sys.path.insert(0, r"D:\App\unifia\voice-runtime\.build-temp\pocket-export\pylibs")

BASE = Path(r"D:\App\unifia\voice-runtime\.build-temp\pocket-export")
CONFIG_DIR = Path(r"D:\App\unifia\voice-runtime\packages\voice-host\.venv\Lib"
                  r"\site-packages\pocket_tts\config")
VOICE = BASE / "audio" / "seed-voice-alba.wav"
THRESHOLD = -4.0

from pocket_tts.models.tts_model import TTSModel  # noqa: E402
from pocket_tts.utils.config import load_config  # noqa: E402

# config stem -> (pack dir, human label, sample text)
JOBS = [
    ("spanish", "models-es", "ES",
     "Hola mundo. Soy el TTS de bolsillo de Kyutai. "
     "Soy lo suficientemente rápido para funcionar en pequeños CPU."),
    ("italian", "models-it", "IT",
     "Ciao mondo. Sono il TTS tascabile di Kyutai. "
     "Sono abbastanza veloce da funzionare su piccoli CPU."),
    ("german", "models-de", "DE",
     "Hallo Welt. Ich bin Pocket TTS von Kyutai. "
     "Ich bin schnell genug, um auch auf kleinen CPUs zu laufen."),
    ("english", "models-cloning", "EN",
     "Hello world. I am Kyutai's Pocket TTS. "
     "I'm fast enough to run on small CPUs."),
]


def write_wav(path: Path, samples, rate: int) -> None:
    # pocket returns normalised float audio in roughly [-1, 1]. It must be
    # scaled into int16 range before casting; `int(v)` alone truncates every
    # sample to zero and silently writes a silent file.
    clipped = array("h", (
        max(-32768, min(32767, int(round(v * 32767.0)))) for v in samples
    ))
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(clipped.tobytes())
    peak = max((abs(v) for v in clipped), default=0)
    if peak < 1000:
        raise ValueError(
            f"{path.name}: written audio is effectively silent (peak={peak}). "
            "Refusing to record a silent reference."
        )


def main() -> int:
    for stem, pack, label, text in JOBS:
        weights = BASE / pack / ".cache" / "tts_b6369a24.safetensors"
        if not weights.exists():
            print(f"[{label}] SKIP - no staged weights in {pack}")
            continue

        config = load_config(str(CONFIG_DIR / f"{stem}.yaml"))
        config.weights_path = str(weights)
        # temperature 0 is what makes the reference reproducible.
        model = TTSModel._from_pydantic_config_with_weights(
            config, temp=0.0, sampler_decode_steps=1,
            noise_clamp=None, eos_threshold=THRESHOLD,
        ).eval()

        trace = []
        hook = model.flow_lm.out_eos.register_forward_hook(
            lambda _m, _i, out: trace.append(float(out.detach().reshape(-1)[-1]))
        )
        with torch.no_grad():
            state = model.get_state_for_audio_prompt(str(VOICE))
            audio = model.generate_audio(model_state=state, text_to_generate=text)
        hook.remove()

        rate = model.sample_rate
        dest = BASE / "audio" / f"ref-{label.lower()}-greedy.wav"
        write_wav(dest, audio.detach().reshape(-1).tolist(), rate)

        fired = next((i for i, v in enumerate(trace) if v > THRESHOLD), None)
        print(f"[{label}] greedy reference: "
              f"{int(audio.shape[-1]) / rate:.3f}s  "
              f"AR frames={len(trace)}  EOS at frame={fired}  -> {dest.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
