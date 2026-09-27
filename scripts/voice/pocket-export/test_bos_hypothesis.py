"""Prove (or refute) that the missing `bos_before_voice` prefix causes early EOS.

pocket-tts 3.1.0 builds the voice conditioning as (tts_model.py:972):

    if self.flow_lm.insert_bos_before_voice:
        prompt = torch.cat([self.flow_lm.bos_before_voice, prompt], dim=1)

and `english.yaml` sets `insert_bos_before_voice: true`. The C++ runtime feeds
the raw `mimi_encoder` output with no such prefix, and the model itself warns
that out-of-distribution conditioning "typically never emits EOS".

This replays the model's own state construction twice on the same voice and
text - once with the documented prefix and once without - using the identical
`_run_flow_lm_and_increment_step` call the stock path uses, so the ONLY
difference between the two runs is the prefix. It reports, for each, the frame
at which EOS fires and the resulting duration.
"""

import sys
from pathlib import Path

import torch

sys.path.insert(0, r"D:\App\unifia\voice-runtime\.build-temp\pocket-export\pylibs")

MODEL_DIR = Path(r"D:\App\unifia\voice-runtime\.build-temp\pocket-export\models-cloning")
CONFIG = Path(r"D:\App\unifia\voice-runtime\packages\voice-host\.venv\Lib"
              r"\site-packages\pocket_tts\config\english.yaml")
VOICE = Path(r"D:\App\unifia\voice-runtime\.build-temp\pocket-export\audio\seed-voice-alba.wav")
THRESHOLD = -4.0
TEXT = ("Hello world. I am Kyutai's Pocket TTS. "
        "I'm fast enough to run on small CPUs.")

from pocket_tts.data.audio import audio_read  # noqa: E402
from pocket_tts.data.audio_utils import convert_audio  # noqa: E402
from pocket_tts.models.tts_model import TTSModel  # noqa: E402
from pocket_tts.modules.stateful_module import init_states  # noqa: E402
from pocket_tts.utils.config import load_config  # noqa: E402


def build_model():
    config = load_config(str(CONFIG))
    config.weights_path = str(MODEL_DIR / ".cache" / "tts_b6369a24.safetensors")
    model = TTSModel._from_pydantic_config_with_weights(
        config, temp=0.0, sampler_decode_steps=1,
        noise_clamp=None, eos_threshold=THRESHOLD,
    )
    return model.eval()


def state_from_prompt(model, prompt):
    """Identical to get_state_for_audio_prompt's body, minus BOS handling."""
    state = init_states(model.flow_lm, batch_size=1, sequence_length=prompt.shape[1])
    with torch.no_grad():
        model._run_flow_lm_and_increment_step(
            model_state=state, audio_conditioning=prompt
        )
    return state


def run(model, state, text):
    trace = []
    hook = model.flow_lm.out_eos.register_forward_hook(
        lambda _m, _i, out: trace.append(float(out.detach().reshape(-1)[-1]))
    )
    with torch.no_grad():
        audio = model.generate_audio(model_state=state, text_to_generate=text)
    hook.remove()
    fired = next((i for i, v in enumerate(trace) if v > THRESHOLD), None)
    return {
        "frames": len(trace),
        "eos_frame": fired,
        "duration_s": int(audio.shape[-1]) / model.sample_rate,
        "trace": trace,
    }


def main() -> int:
    model = build_model()
    print(f"insert_bos_before_voice = {model.flow_lm.insert_bos_before_voice}")
    print(f"bos_before_voice shape  = {tuple(model.flow_lm.bos_before_voice.shape)}")
    print()

    audio, sr = audio_read(VOICE)
    audio = convert_audio(audio, sr, model.config.mimi.sample_rate, 1)
    with torch.no_grad():
        prompt = model._encode_audio(audio.unsqueeze(0).to(model.device))

    with_bos_prompt = torch.cat(
        [model.flow_lm.bos_before_voice, prompt], dim=1
    ) if model.flow_lm.insert_bos_before_voice else prompt

    results = {}
    for label, cond in (("WITH bos_before_voice (stock eager)", with_bos_prompt),
                        ("WITHOUT bos_before_voice (C++ path)", prompt)):
        result = run(model, state_from_prompt(model, cond), TEXT)
        results[label] = result
        print(f"=== {label} ===")
        print(f"  conditioning length : {cond.shape[1]} steps")
        print(f"  AR frames           : {result['frames']}")
        print(f"  EOS fires at frame  : {result['eos_frame']}")
        print(f"  duration            : {result['duration_s']:.3f}s")
        head = ", ".join(f"{v:.2f}" for v in result["trace"][:8])
        print(f"  first 8 eos logits  : {head}")
        print()

    a = results["WITH bos_before_voice (stock eager)"]
    b = results["WITHOUT bos_before_voice (C++ path)"]
    if b["eos_frame"] is not None and (a["eos_frame"] is None or b["eos_frame"] < a["eos_frame"]):
        print("CONFIRMED: dropping the BOS prefix makes EOS fire earlier.")
    else:
        print("NOT CONFIRMED by this experiment; the prefix is not the differentiator.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
