"""Validate and export the same generated/played PCM, without synthesizing again."""
import argparse
import hashlib
import json
import re
import wave
from pathlib import Path

PCM = re.compile(r"(?:pocket-\d+-24000|accepted-48000|rendered-48000)\.pcm\Z")
MAX_BYTES = 24 * 1024 * 1024
MAX_MANIFEST_BYTES = 2 * 1024 * 1024


def inspect(root: Path) -> dict:
    manifest = root / "trace.tsv"
    if manifest.is_symlink() or manifest.stat().st_size > MAX_MANIFEST_BYTES:
        raise ValueError("Invalid or oversized trace manifest")
    lines = manifest.read_text(encoding="utf-8").splitlines()
    if len(lines) < 2 or not lines[0].startswith("voice-trace-v1\t") or not lines[1].startswith("mic-recording=false\t"):
        raise ValueError("Unsupported or incomplete trace header")
    totals, metrics, summary = {}, {}, {}
    for line in lines[2:]:
        timestamp, name, value = line.split("\t")
        if timestamp == "summary":
            if name in summary:
                raise ValueError("Duplicate trace summary")
            summary[name] = value
            continue
        if int(timestamp) < 0:
            raise ValueError("Negative trace timestamp")
        count = int(value)
        if count < 0:
            raise ValueError("Negative trace value")
        if name.endswith(".pcm"):
            if not PCM.fullmatch(name) or count % 2:
                raise ValueError("Invalid PCM stage or sample alignment")
            totals[name] = totals.get(name, 0) + count
            if sum(totals.values()) > MAX_BYTES:
                raise ValueError("Trace exceeds the capture byte budget")
        else:
            metrics[name] = max(metrics.get(name, 0), count)
    if summary.get("dropped-events") != "0" or summary.get("limit-reached") != "false":
        raise ValueError("Trace incomplete: missing finalization, queue drops, or capture limit reached")
    if metrics.get("native-trace-dropped-samples", 0) or metrics.get("invalid-native-trace-count", 0):
        raise ValueError("Native output trace lost samples; do not attribute noise from this capture")
    recordings = []
    for name, size in totals.items():
        path = root / name
        if not path.is_file() or path.is_symlink() or path.stat().st_size != size:
            raise ValueError(f"PCM size/integrity mismatch: {name}")
        rate = 24000 if name.startswith("pocket-") else 48000
        recordings.append({"file": name, "sample_rate": rate, "frames": size // 2,
                           "seconds": size / (2 * rate), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
    if not recordings:
        raise ValueError("Trace contains no speech/output PCM")
    return {"schema_version": 1, "microphone_recorded": False,
            "recordings": recordings, "maximum_metrics": metrics,
            "note": "Integrity is not an acoustic quality verdict. Idle empty-sample counts are not active-speech underruns."}


def export(root: Path, report: dict) -> None:
    for recording in report["recordings"]:
        source = root / recording["file"]
        # Never overwrite another diagnostic artifact. PCM is copied exactly;
        # this is a replay asset, not a new stochastic Pocket synthesis.
        with source.with_suffix(".wav").open("xb") as file:
            with wave.open(file, "wb") as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(recording["sample_rate"])
                output.writeframes(source.read_bytes())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--export-wav", action="store_true")
    args = parser.parse_args()
    result = inspect(args.directory)
    if args.export_wav:
        export(args.directory, result)
    print(json.dumps(result, indent=2))
