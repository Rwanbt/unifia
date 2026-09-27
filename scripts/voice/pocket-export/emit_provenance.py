"""Emit the certified-artifact provenance record required by campaign §38.

For every converted artifact: canonical source, source revision, conversion
tool + version, conversion command, SHA-256, runtime ABI, and the measured
numerical validation result. This is the §38 obligation for a converted model
artifact, and the §46 evidence record for the export step.
"""

import hashlib
import json
import os
import sys
from pathlib import Path

OUT = Path(r"D:\App\unifia\voice-runtime\.build-temp\pocket-export\models-en2")
SRC_REPO = "VolgaGerm/PocketTTS.cpp"
SRC_COMMIT = "e801e7d6c2692121a39e80ae525cb5265174a495"
SRC_DATE = "2026-03-29"
HF_REPO = "kyutai/pocket-tts-without-voice-cloning"
HF_REV = "d29db7978e464fb90cb3359ee0c69a273b9142cc"

# Measured by the exporter's own PyTorch-vs-ONNX harness on 2026-09-27.
# `None` means the harness did not report a check for that graph.
VALIDATION = {
    "text_conditioner.onnx": {"status": "pass", "abs": 0.0, "rel": 0.0},
    "mimi_encoder.onnx": {"status": "pass", "abs": 0.0, "rel": 0.0},
    "flow_lm_flow.onnx": {"status": "pass", "abs": 9.54e-07, "rel": 4.80e-07},
    "flow_lm_main.onnx": {
        "status": "FAIL",
        "worst": {"tensor": "eos_logit", "abs": 2.85e-02, "rel": 6.53e-03},
        "tolerance": {"atol": 1e-4, "rtol": 1e-4},
    },
    "mimi_decoder.onnx": {
        "status": "pass",
        "worst": {"tensor": "frame_4", "abs": 4.49e-06, "rel": 2.04e-05},
    },
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> int:
    if not OUT.is_dir():
        print(f"missing export directory: {OUT}")
        return 1

    artifacts = []
    for path in sorted(OUT.iterdir()):
        if not path.is_file() or path.name == "tokenizer.model":
            continue
        entry = {
            "file": path.name,
            "bytes": path.stat().st_size,
            "sha256": sha256(path),
        }
        if path.name in VALIDATION:
            entry["fp32_validation"] = VALIDATION[path.name]
        artifacts.append(entry)

    record = {
        "artifact_kind": "pocket-tts-onnx-pack",
        "language": "en",
        "canonical_source": {
            "weights_repo": HF_REPO,
            "weights_revision": HF_REV,
            "weights_license": "CC-BY-4.0",
            "weights_gated": False,
            "weights_variant": "without-voice-cloning",
            "weights_bytes": 219_029_196,
            "config": "pocket_tts/config/english.yaml (pocket-tts 3.1.0, product lock)",
        },
        "conversion_tool": {
            "name": f"{SRC_REPO}/export_onnx.py",
            "repo": f"https://github.com/{SRC_REPO}",
            "upstream_commit": SRC_COMMIT,
            "upstream_date": SRC_DATE,
            "license": "MIT",
            "local_delta": [
                "TokenizedText shim (torch.Tensor subclass) for the wrapper removed in pocket-tts 3.x",
                "DEFAULT_LSD_DECODE_STEPS -> DEFAULT_SAMPLER_DECODE_STEPS rename",
                "_from_pydantic_config_with_weights(sampler_decode_steps=...) keyword rename",
                "_LinearKVCacheBackend import path transformer -> attention",
                "_unwrap_prepared: prepare() returns a tensor in 3.x, not a wrapper",
                "mimi_decoder validation: pass pre-quantizer latent to decode_from_latent (3.x quantizes internally)",
            ],
        },
        "conversion_command": (
            "python export_onnx.py "
            "--config <site-packages>/pocket_tts/config/english.yaml "
            "--output-dir models-en2"
        ),
        "runtime_abi": {
            "target": "onnxruntime",
            "opset": 17,
            "host_validation_runtime": "onnxruntime 1.30.0 (CPU)",
            "mobile_target_runtime": "ONNX Runtime Android arm64 (not yet built)",
        },
        "totals": {
            "fp32_bytes": sum(a["bytes"] for a in artifacts if not a["file"].endswith("_int8.onnx")),
            "int8_bytes": sum(a["bytes"] for a in artifacts if a["file"].endswith("_int8.onnx")),
        },
        "validation_summary": {
            "graphs_total": 5,
            "graphs_passing_fp32": 4,
            "graphs_failing_fp32": ["flow_lm_main.onnx"],
            "int8_all_passed": True,
            "int8_caveat": (
                "INT8 'pass' uses the harness's looser int8 tolerance. Measured int8 "
                "errors (abs up to 4.31e-01) exceed the fp32 errors, so the int8 run "
                "does NOT clear the flow_lm_main divergence; it masks it."
            ),
        },
        "qualification_status": "NOT QUALIFIED - see flow_lm_main divergence",
        "artifacts": artifacts,
    }

    dest = Path(r"D:\App\unifia\voice-runtime\.build-temp\pocket-export\en-onnx-provenance.json")
    dest.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")

    print(f"fp32 total : {record['totals']['fp32_bytes'] / 1e6:8.2f} MB")
    print(f"int8 total : {record['totals']['int8_bytes'] / 1e6:8.2f} MB")
    for a in artifacts:
        mark = a.get("fp32_validation", {}).get("status", "-")
        print(f"  {a['file']:28s} {a['bytes'] / 1e6:8.2f} MB  {mark:5s} {a['sha256'][:16]}")
    print(f"\nwritten: {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
