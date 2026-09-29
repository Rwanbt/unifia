<!-- SPDX-License-Identifier: MIT -->
# Unifia Voice v2 — Model Update Procedure

> Companion to `docs/voice-production-runbook.md`. Implements the
> ADR-066 (Model Artifact Registry) contract end-to-end so model updates
> are reproducible, SHA-verified, and never executed in a partially
> downloaded state.

## 1. Source-of-truth hierarchy

1. **`packages/voice-host/models/registry.json`** — authoritative registry. Every model artifact the runtime expects to load is listed there. Modify ONLY through the workflow in §4.
2. **Voice v2 ADR chain `ADR-066`** — the protocol; this procedure is its operationalization.
3. **Upstream sources** — official repositories / model cards. Locked by `upstream_revision` + `upstream_url` fields.
4. **Lockfiles** — `bun.lock`, `pyproject.toml` (uv-managed), `Cargo.lock`. These pin language-runtime toolchains; if a model upgrade requires a runtime bump, the lockfile update goes through the same review process.

## 2. Registry schema (canonical)

Each entry in `registry.json`:

```jsonc
{
  "<artifact-id>": {
    "provider":            "vad|tts|stt|turn|fastdecision",
    "model_id":            "silero-vad-v6.2.2",
    "model_version":       "6.2.2",
    "upstream_revision":   "vad-onnx-v6.2.2",
    "upstream_url":        "https://github.com/snakers4/silero-vad/raw/<sha>/src/silero_vad/data/vad.onnx",
    "sha256":              "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3",
    "size_bytes":          2327524,
    "licence":             "MIT",
    "languages":           ["multi"],
    "architecture":        "rnn-vad",
    "quantization":        "fp32",
    "redistributable":     true,
    "minimum_runtime":     "ort>=1.30.0",
    "compatibility_block": { "ort_versions": ["1.30.0"] },
    "download_path":       "${VOICE_MODELS_DIR}/vad/silero-vad-v6.2.2.onnx"
  }
}
```

Fields are STRICT. Missing a field blocks the artefact from being
promoted to active status. The downloader enforces:

- `redistributable: true` for any artefact that ships in the MIT mobile APK.
- `sha256` non-empty (download protocol fails if blank).
- `upstream_revision` non-empty.
- `licence` matches the SPDX-ID list.

## 3. Update workflow

### Step 1 — Pull upstream

```bash
# Example: bump Silero VAD from v6.2.2 to v6.3.0
curl -Lfo /tmp/silero-vad-v6.3.0.onnx \
  https://github.com/snakers4/silero-vad/raw/v6.3.0/src/silero_vad/data/vad.onnx
```

### Step 2 — Hash, size, license

```bash
sha=$(sha256sum /tmp/silero-vad-v6.3.0.onnx | awk '{print $1}')
size=$(stat -c '%s' /tmp/silero-vad-v6.3.0.onnx)
echo "$sha $size"
```

The `licence` MUST come from `models/<provider>/<model_id>/LICENSE` in
the upstream repo (do not trust installer metadata alone).

### Step 3 — Dry-run promotion

Use the dry-run helper to confirm the new artefact validates:

```bash
python scripts/voice/model-update.py --artifact silero-vad-v6.3.0 \
    --source /tmp/silero-vad-v6.3.0.onnx --dry-run
# Output: ✓ SH256 matches expected upload checksum
#         ✓ Size: 2400000 bytes
#         ✓ License MIT (consistent with registry[redistributable] rule)
```

Dry-run must print 3 ✓ lines BEFORE we commit + promote.

### Step 4 — Atomic promote

```bash
# Promote:  registry.json update → SHA-256 verify → atomic copy
python scripts/voice/model-update.py --artifact silero-vad-v6.3.0 \
    --source /tmp/silero-vad-v6.3.0.onnx --promote
# 1. registry.json entry "sha256" + "model_version" updated to new values
# 2. local file moved atomically (download -> .tmp -> rename)
# 3. partial downloads never become executable
```

If step 2 fails, the previous artefact remains in place (no broken
state).

### Step 5 — Roll out

| Surface | Mechanism | Verification |
|---|---|---|
| Desktop voice-host | restart worker; `load_parakeet` / Silero load reads the new artefact on next boot | `diagnostics()` `model_version` reflects new value |
| Android Tauri runtime | APK rebuild + install | `registry.sha256` matches downloaded at runtime startup |

The runtime NEVER fetches from a network on startup. All artefacts
must be pre-installed (per ADR-072 / Offline & Network Policy).

## 4. Forbidden shortcuts

These are explicitly blocked by the protocol:

| Shortcut | Why banned |
|---|---|
| Skip SHA-256 verification | Partial download could be a malicious injection |
| Use `redistributable: false` + ship in MIT APK | GPL leak into mobile build (ADR-058 §15.5) |
| Edit registry.json by hand | Field typos silently break the runtime; the update helper is the only path |
| `git mv` an existing artefact to a new path | Loses SHA-256 history; downstream rollback becomes impossible |
| Re-download after a failed download without re-verifying SHA | Cached partial download could become active without re-validation |
| Bump the model during an active Live session without restart | Active leases were taken under the OLD artefact; mid-session swap is unsafe |

## 5. Multi-language voice asset bundles

Piper voice tarballs (one per language) follow the same protocol — they
are individual artefacts with their own SHA-256 in the registry.

For Pocket multilingual weights, the same applies but the artefact
is a directory of ONNX/JSON files. SHA-256 covers the **archive** (a
deterministic tarball); runtime expansion verifies the directory
hierarchy matches the expected layout.

## 6. Registry integrity checks

```bash
# Validate every entry has the required fields and SHAs are well-formed
python scripts/voice/registry-validate.py
# OK: 14 / 14 artefacts valid
#   silero-vad-v6.2.2  : MIT, sha=1a153a22..., redistributable=true
#   piper-en_US-...   : MIT-0, sha=<...>
#   piper-fr_FR-...   : MIT-0, sha=<...>
#   ...
# ERRORS: 0
```

Run this check as a CI job alongside `cargo test`, `bun test`, and
`pytest`.

## 7. Audit trail

Every update writes a one-line summary to `models/.update-log.jsonl`:

```jsonl
{"ts": "...", "artifact": "silero-vad-v6.2.2", "old_sha": "1a153a22...", "new_sha": "...", "operator": "Erwan"}
```

This log is what subsequent sessions will use to reconstruct the
model-state history (matches plan §40 "model update procedure"
requirement).

## 8. CI gate

Until the v2 release, registry-update PRs must be reviewed by a human
(per repo workflow). After the v2 release, the gate becomes automated
and reads from the same script.

## 9. Cross-references

- ADR-066 (Model Artifact Registry) — `docs/adr/ADR-066-*.md`
- ADR-072 (Offline & Network Policy) — `docs/adr/ADR-072-*.md`
- ADR-058 §15.5 (MIT/GPL legal boundary) — `docs/adr/ADR-058-*.md`
- Rollback — `docs/voice-rollback-procedure.md`
- Pre-flight diagnostics — `docs/voice-production-runbook.md` §4
