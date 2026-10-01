#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Compare host inference with identical pinned Smart Turn input features."""

import hashlib
import json
import platform
import wave

import numpy as np
import onnxruntime as ort

from eot_bakeoff_smart_turn import (
    CORPUS_JSON,
    REPO_ROOT,
    compute_whisper_log_mel_features,
    verify_pin,
)


def main() -> None:
    if ort.__version__ != "1.28.0" or np.__version__ != "2.5.3":
        raise RuntimeError("Probe requires the reference ORT 1.28.0 and numpy 2.5.3")
    reference = json.loads(
        (REPO_ROOT / "packages/voice-core/fixtures/smart-turn-gate.json").read_text()
    )
    decision = next(item for item in reference["decisions"] if item["fixture"] == "de-incompl-01")
    corpus = json.loads(CORPUS_JSON.read_text())
    fixture = next(item for item in corpus["fixtures"] if item["id"] == decision["fixture"])
    model = REPO_ROOT / "packages/mobile/src-tauri/resources/smart-turn-v3.2-cpu.onnx"
    verify_pin("smart-turn-v3.2-cpu-onnx", model)
    with wave.open(str(CORPUS_JSON.parent / fixture["audio"]["path"]), "rb") as audio_file:
        if (audio_file.getnchannels(), audio_file.getsampwidth(), audio_file.getframerate()) != (1, 2, 16000):
            raise RuntimeError("Corpus window must be mono int16 PCM at 16 kHz")
        pcm = np.frombuffer(audio_file.readframes(decision["trigger_ms"] * 16), dtype="<i2").copy()
    audio = pcm.astype(np.float32) / 32768.0
    audio = audio[-128000:] if audio.size > 128000 else np.pad(audio, (128000 - audio.size, 0))
    features = compute_whisper_log_mel_features(audio)
    for precision in ("0", "1"):
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        options.add_session_config_entry("session.x64quantprecision", precision)
        session = ort.InferenceSession(str(model), sess_options=options, providers=["CPUExecutionProvider"])
        probability = float(session.run(None, {"input_features": features[None]})[0][0][0])
        print(json.dumps({
            "platform": platform.platform(), "processor": platform.processor(),
            "ort": ort.__version__, "numpy": np.__version__, "precision": precision,
            "fixture": decision["fixture"], "samples": pcm.size,
            "pcm_sha256": hashlib.sha256(pcm.tobytes()).hexdigest(),
            "feature_sha256": hashlib.sha256(features.tobytes()).hexdigest(),
            "model_sha256": hashlib.sha256(model.read_bytes()).hexdigest(),
            "probability": probability, "reference_probability": decision["probability"],
        }))


if __name__ == "__main__":
    main()
