"""Trace the eager PyTorch EOS-logit trajectory for one text.

The C++ runtime was instrumented last session and its logit was found to rise
too slowly to ever cross -4.0. To tell a *lagged* autoregressive state from a
*wrong* one, this captures the same signal on the eager reference, so the two
curves can be compared frame by frame.

A forward hook on `flow_lm.out_eos` records the raw logit the model produces at
every AR step, independent of how the comparison against the threshold is
wired, so the comparison itself is not what is being measured.
"""

import sys
from pathlib import Path

import torch

sys.path.insert(0, r"D:\App\unifia\voice-runtime\.build-temp\pocket-export\pylibs")

MODEL_DIR = Path(r"D:\App\unifia\voice-runtime\.build-temp\pocket-export\models-en2")
CONFIG = Path(r"D:\App\unifia\voice-runtime\packages\voice-host\.venv\Lib"
              r"\site-packages\pocket_tts\config\english.yaml")
VOICE = Path(r"D:\App\unifia\voice-runtime\.build-temp\pocket-export\audio\seed-voice-alba.wav")
THRESHOLD = -4.0

from pocket_tts.models.tts_model import TTSModel  # noqa: E402
from pocket_tts.utils.config import load_config  # noqa: E402

text = sys.argv[1] if len(sys.argv) > 1 else "Hi."


def main() -> int:
    config = load_config(str(CONFIG))
    config.weights_path = str(MODEL_DIR / ".cache" / "tts_b6369a24.safetensors")
    model = TTSModel._from_pydantic_config_with_weights(
        config,
        temp=0.0,  # deterministic: we compare state evolution, not sampling
        sampler_decode_steps=1,
        noise_clamp=None,
        eos_threshold=THRESHOLD,
    )
    model.eval()

    trace = []
    hook = model.flow_lm.out_eos.register_forward_hook(
        lambda _m, _i, out: trace.append(float(out.detach().reshape(-1)[-1]))
    )

    with torch.no_grad():
        state = model.get_state_for_audio_prompt(str(VOICE))
        # `generate_audio` is the path the CLI uses. It applies the model's own
        # text preparation (capitalisation, punctuation, short-input padding),
        # which `generate_audio_stream` does NOT. Comparing the C++ runtime
        # against the unprepared stream path would be comparing two different
        # text pipelines, not two runtimes.
        audio = model.generate_audio(model_state=state, text_to_generate=text)
        total = int(audio.shape[-1])

    hook.remove()

    print(f"text            : {text!r}")
    print(f"rendered audio  : {total / model.sample_rate:.3f}s @ {model.sample_rate}Hz")
    print(f"eos steps traced: {len(trace)}")
    print(f"threshold       : {THRESHOLD}")
    print()
    fired = next((i for i, v in enumerate(trace) if v > THRESHOLD), None)
    print(f"{'frame':>5} {'logit':>10}   state")
    for i, value in enumerate(trace[:24]):
        mark = "EOS FIRES" if value > THRESHOLD else ""
        print(f"{i:>5} {value:>10.4f}   {mark}")
    if len(trace) > 24:
        print(f"  ... {len(trace) - 24} more steps")
    print()
    if fired is None:
        print("RESULT: eager reference NEVER crosses the threshold "
              f"({len(trace)} steps, {len(trace) / 12.5:.2f}s of AR)")
    else:
        print(f"RESULT: eager reference crosses at frame {fired} "
              f"(~{fired / 12.5:.2f}s of AR)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
