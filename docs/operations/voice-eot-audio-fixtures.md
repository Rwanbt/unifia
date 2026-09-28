<!-- SPDX-License-Identifier: MIT -->
# UNIFIA-EOT-BENCH audio fixtures

The v2 corpus pairs the project-authored transcript metadata with 91 generated mono PCM WAV fixtures at 16 kHz. These are reproducible model-generated fixtures for VAD and turn-detector development; they are not recordings of representative human speech, and their results cannot qualify natural-speaker accuracy by themselves.

## Reproduction

The generator pins Python 3.12.13, `piper-tts` 1.8.0, ONNX Runtime 1.30.0 and NumPy 2.5.3. It runs each voice on `CPUExecutionProvider`, sets Piper's stochastic noise scales to zero, and derives the seeded background-noise stream from the fixture ID. It rejects a runtime version mismatch instead of producing mislabeled fixtures.

```powershell
packages/piper-host/.venv/Scripts/python.exe scripts/voice/generate_eot_audio_fixtures.py --models-dir .build-temp
packages/piper-host/.venv/Scripts/python.exe scripts/voice/generate_eot_audio_fixtures.py --models-dir .build-temp --check
```

The five `.onnx` and `.onnx.json` files must be placed in the model directory. The generator validates both SHA-256 values before inference. It writes WAVs under `packages/contracts/corpus/audio/` and updates their annotations in `unifia-eot-bench.json`. The model weights are not checked into this repository.

## Pinned voices and source terms

| Language | Piper voice / model revision | Model SHA-256 | Source and dataset terms |
|---|---|---|---|
| English | `en_US-ljspeech-medium`, `bae641d` | `6f52a751e2349abe7a76735eb09dc1875298c77ea2342ffd2fef79ff81b87f22` | [LJSpeech model card](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/ljspeech/medium/MODEL_CARD) identifies the source dataset as public domain. |
| French | `fr_FR-mls-medium`, `7e8200c` | `0ed223f78466917f2bae05ee90096ce69ab1fdeb251f55590d0e7422d234e162` | [MLS model card](https://huggingface.co/rhasspy/piper-voices/blob/main/fr/fr_FR/mls/medium/MODEL_CARD) identifies CC-BY 4.0. |
| Spanish | `es_ES-carlfm-x_low`, `2f8dbe0` | `d69677323a907cd4963f42b29c20a98b5d6bfa7f3e64df339915e4650c00d125` | The [voice model card](https://huggingface.co/rhasspy/piper-voices/blob/main/es/es_ES/carlfm/x_low/MODEL_CARD) points to the [author's speech-dataset repository](https://github.com/carlfm01/my-speech-datasets), which states public-domain terms. |
| Italian | `it_IT-riccardo-x_low`, `2f8dbe0` | `1368de15f123275a7ef951c9e5e30be0f58a032daa14a0da44037443c1d1d21b` | The [voice model card](https://huggingface.co/rhasspy/piper-voices/blob/main/it/it_IT/riccardo/x_low/MODEL_CARD) points to M-AILABS. Its [published terms](https://github.com/i-celeste-aurora/m-ailabs-dataset) permit redistribution and use with the listed copyright, attribution, no-endorsement and disclaimer conditions. |
| German | `de_DE-mls-medium`, `7e8200c` | `69cd1d2aa5a35839a518966fcc4924b5f93e5f8c948ed0752b1a616ad53f65bf` | [MLS model card](https://huggingface.co/rhasspy/piper-voices/blob/main/de/de_DE/mls/medium/MODEL_CARD) identifies CC-BY 4.0. |

Voice cards carry the dataset-specific terms; the [Piper project guidance](https://github.com/Passw/rhasspy-piper) explicitly asks users to review each card. This repository distributes generated test PCM and attribution metadata, not the models or source recordings.

## Annotation semantics

- `speechIntervalsMs` marks foreground Piper activity. Activity is found in 10 ms frames above the greater of 250 PCM units or 2% of the fixture's peak frame RMS; gaps of 120 ms or less are merged.
- `silenceIntervalsMs` is the complement of those foreground intervals within the WAV. For noisy and overlap fixtures this means no foreground user speech; background/assistant audio may remain.
- `expectedEotMs` is the end of the final foreground activity plus the deterministic 650 ms trailing-silence policy. A `null` value means no EOT is allowed within the recorded fixture; `expectedTurnComplete` remains the semantic label.
- `forbiddenEotIntervalsMs` covers the recording before the expected EOT, or the entire recording for an incomplete/clipped utterance.
- Pause, false-ending, conjunction, enumeration and correction cases synthesize separate transcript parts with annotated gaps. Rapid interruption repeats the reference utterance three times. Multilingual-switch clips synthesize the foreign phrase with the corresponding pinned voice. Speech-over-assistant clips overlay a generated assistant phrase. Background noise is deterministic white noise at 15 dB SNR; whisper is attenuated to 8%; clipping saturates the signal at ±12,000 and truncates the recorded speech 40 ms before its last detected activity.

All WAVs include a SHA-256 in the corpus. The TypeScript loader validates metadata and the app test checks every WAV's format, duration and digest. This corpus is a first reproducible audio input for the G4 candidate bake-off; it does not yet contain Smart Turn results or physical-device measurements.
