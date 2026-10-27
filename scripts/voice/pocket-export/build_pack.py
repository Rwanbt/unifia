"""Build a publishable Pocket voice pack from pinned inputs (#937).

Usage (needs `hf auth login` with access to the gated kyutai/pocket-tts):

    python build_pack.py --language fr --work D:/tmp/pocket-fr \
        --exporter D:/tmp/PocketTTS.cpp/export_onnx.py

The French pack has failed silently twice, and both failures are refused here
instead of being heard on a phone:

- The ungated `pocket-tts-without-voice-cloning` checkpoint ships a Mimi
  encoder whose transformer weights are all zero. The Android engine encodes
  `voices/voice.wav` with that encoder, so the voice comes out garbled with
  mixed accents. Only the cloning checkpoint is accepted.
- The tokenizer must come from the same revision as the weights. A newer
  public tokenizer reads the same text as other token ids, so the audio no
  longer matches the text. Both files are downloaded here from one revision.

The output is the zip to attach to a `voice-pack-pocket-<lang>-<version>`
release and the registry entry fields to paste into
packages/voice-host/models/registry.json.
"""

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

import huggingface_hub as hf
import soundfile
from safetensors import safe_open
from scipy.signal import resample_poly

REPO = "kyutai/pocket-tts"
VOICE_REPO = "kyutai/tts-voices"
PACKS = {
    "fr": {
        "revision": "39592ff23c9ef80098bb74895d104c26275fe2c9",
        "language_dir": "french_24l",
        "voice": "cml-tts/fr/2154_2576_000020-0003_enhanced.wav",
    },
}
GRAPHS = [
    "text_conditioner.onnx",
    "mimi_encoder.onnx",
    "bos_before_voice.onnx",
    "flow_lm_main_int8.onnx",
    "flow_lm_flow_int8.onnx",
    "mimi_decoder_int8.onnx",
]
VOICE_FILE = "voices/voice.wav"
PACK_SAMPLE_RATE_HZ = 24_000
# The zip timestamp is fixed so the same inputs give the same archive digest.
ZIP_TIMESTAMP = (2026, 1, 1, 0, 0, 0)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def download_pinned(pack: dict, pack_dir: Path) -> Path:
    weights = pack_dir / ".cache" / "tts_b6369a24.safetensors"
    weights.parent.mkdir(parents=True, exist_ok=True)
    for name, target in [("model.safetensors", weights), ("tokenizer.model", pack_dir / "tokenizer.model")]:
        fetched = hf.hf_hub_download(
            REPO, f"languages/{pack['language_dir']}/{name}", revision=pack["revision"]
        )
        shutil.copyfile(fetched, target)
    return weights


def refuse_zeroed_encoder(weights: Path) -> None:
    with safe_open(str(weights), "pt") as tensors:
        names = [n for n in tensors.keys() if n.startswith("mimi.encoder_transformer") and n.endswith("weight")]
        if not names or all(float(tensors.get_tensor(n).abs().sum()) == 0.0 for n in names):
            sys.exit(f"{weights}: Mimi encoder transformer is zero; this is not the voice-cloning checkpoint")


def stage_voice(pack: dict, pack_dir: Path) -> None:
    source = hf.hf_hub_download(VOICE_REPO, pack["voice"])
    samples, rate = soundfile.read(source, dtype="float32")
    if samples.ndim > 1:
        samples = samples.mean(axis=1)
    if rate != PACK_SAMPLE_RATE_HZ:
        samples = resample_poly(samples, PACK_SAMPLE_RATE_HZ, rate)
    target = pack_dir / VOICE_FILE
    target.parent.mkdir(parents=True, exist_ok=True)
    soundfile.write(target, samples, PACK_SAMPLE_RATE_HZ, subtype="PCM_16")


def export_graphs(exporter: Path, config: Path, pack_dir: Path) -> None:
    # --no-validate: the exporter's validation feeds 6-layer states and cannot
    # run a 24-layer graph. The pack is qualified by listening instead.
    subprocess.run(
        [sys.executable, str(exporter), "--config", str(config), "--output-dir", str(pack_dir),
         "--export", "all", "--no-validate"],
        check=True,
    )
    bos = Path(__file__).with_name("export_bos_asset.py")
    subprocess.run([sys.executable, str(bos), str(pack_dir)], check=True)


def write_archive(pack_dir: Path, archive: Path, files: list[str]) -> None:
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zipped:
        for name in files:
            info = zipfile.ZipInfo(name, ZIP_TIMESTAMP)
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            zipped.writestr(info, (pack_dir / name).read_bytes())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--language", choices=sorted(PACKS), required=True)
    parser.add_argument("--version", default="1.0.0")
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--exporter", type=Path, required=True, help="patched PocketTTS.cpp export_onnx.py")
    args = parser.parse_args()

    pack = PACKS[args.language]
    import pocket_tts

    config = Path(pocket_tts.__file__).parent / "config" / f"{pack['language_dir']}.yaml"
    # export_bos_asset.py reads <work>/config/<pack dir suffix>.yaml.
    pack_dir = args.work / f"models-{args.language}"
    (args.work / "config").mkdir(parents=True, exist_ok=True)
    shutil.copyfile(config, args.work / "config" / f"{args.language}.yaml")

    weights = download_pinned(pack, pack_dir)
    refuse_zeroed_encoder(weights)
    stage_voice(pack, pack_dir)
    export_graphs(args.exporter, config, pack_dir)

    files = ["tokenizer.model", *GRAPHS, VOICE_FILE]
    model_id = f"pocket-tts-{args.language}-{pack['language_dir'].split('_')[-1]}-int8"
    archive = args.work / f"{model_id}-{args.version}.zip"
    write_archive(pack_dir, archive, files)
    print(json.dumps({
        "model_id": model_id,
        "version": args.version,
        "upstream_revision": f"huggingface.co/{REPO}@{pack['revision']}",
        "sha256": sha256(archive),
        "size_bytes": archive.stat().st_size,
        "required_files": files,
        "file_sha256": {name: sha256(pack_dir / name) for name in files},
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
