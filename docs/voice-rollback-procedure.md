<!-- SPDX-License-Identifier: MIT -->
# Unifia Voice v2 — Rollback Procedure

> Companion to `docs/voice-production-runbook.md` + `docs/voice-model-update-procedure.md`.
> Voice component versioning is pinned by **two** lockfiles
> (language-runtime + model-registry). Rolling back requires
> reverting BOTH atomically.

## 1. What counts as "voice component" for rollback purposes

| Concern | Pinned by | Revert via |
|---|---|---|
| Provider contracts (TS) | `@unifia/contracts` package version + `voice-*` exports | `git revert` a contract commit; downstream consumers must rebuild |
| Desktop Python worker (TtsRouter, ResourceScheduler, PlatformSignals) | `pyproject.toml` `unifia-voice-host` version | `uv pip install` a pinned version |
| Android Rust scheduler | `packages/mobile/src-tauri/Cargo.toml` `unifia-mobile` version | revert Cargo.lock entry |
| Bundled Silero VAD ONNX | `registry.json` SHA-256 + `sha256` on disk (ADR-066) | re-promote prior artefact |
| Bundled 5 Piper voices | per-voice SHA-256 in `registry.json` | re-promote prior artefact |
| Bundled Parakeet TDT v3 INT8 | `registry.json` SHA-256 (when adopted) | re-promote prior artefact |

**OS audio is not a voice component**: it depends on the host OS
audio drivers and hardware. OS-level audio driver regressions are
out of scope; document them in `KNOWN_FAILURE_PATTERNS.md` instead.

## 2. Triggers (when to roll back)

| Trigger | Severity | Action |
|---|---|---|
| New release causes regression in `voice-host-test-runner.py --full` | HIGH | roll back voice-host package + registry to last green |
| New STT contract release breaks App TS voice suite (`bun test src/voice`) | HIGH | roll back `@unifia/contracts/streaming-stt` to last green |
| Model SHA mismatch on startup (`registry_diff`) | HIGH | re-promote prior artefact OR fix the registry entry that lost the previous SHA |
| Regressed xrun count > 0 in nominal qualification | MEDIUM | roll back desktop Live + ResourceScheduler + AudioRingBuffer chain |
| Barge-in p95 > 150 ms after release | MEDIUM | roll back VAD + turn endpointing |
| TTS TTFA > 250 ms warm after release | LOW-MED | roll back TtsRouter + active Pocket weights |

When in doubt, roll back. Recovering from a regression is cheaper
than diagnosing + patching mid-incident.

## 3. Pre-flight snapshot

Before touching anything, capture:

```bash
# 1. Commit SHA + lockfile SHAs
git rev-parse HEAD > /tmp/voice-rollback.snapshot
git rev-parse HEAD:packages/voice-host/Cargo.lock > /tmp/voice-rollback.cargolock || true  # not always present
cp packages/voice-host/models/registry.json /tmp/voice-rollback.registry.json

# 2. Scheduler diagnostics (if the worker can still run)
# (use the python diagnostic call from runbook §4)
```

These three artefacts are what you roll back TO.

## 4. Rollback by surface

### 4.1 Desktop voice-host Python

```bash
# 1. Revert the campaign commit
git revert --no-commit <bad-sha>          # or `git reset --hard <good-sha>` if no shared-branch policy conflict

# 2. Or pin to a known-good version
uv pip install --python 3.12 unifia-voice-host==<good-version>

# 3. Restart the worker
systemctl restart voice-host   # or your deployment unit
```

### 4.2 App TS contracts / implementations

```bash
git revert --no-commit <bad-sha>
cd packages/contracts && bun install --frozen-lockfile
cd packages/app && bun install --frozen-lockfile
bun run typecheck && bun test src/voice  # regression gate
```

### 4.3 Android Rust scheduler

```bash
cd packages/mobile/src-tauri

# Revert Cargo.lock to a prior committed version
git checkout <good-sha> -- Cargo.lock

# Rebuild
cargo check --target aarch64-linux-android     # or host build for the voice:: scheduler tests
cargo test --lib voice::                       # regression gate

# Rebuild + sign + install the APK
# (the keystore credentials must be available for this step — see follow-ups)
```

### 4.4 Model artefact re-promotion

When the regression was caused by a model update, the prior artefact
is the recovery. Use `docs/voice-model-update-procedure.md` §4 step 3
in reverse:

```bash
# Revert registry entry to the prior version + SHA
python scripts/voice/model-update.py --artifact silero-vad-v6.2.2 \
    --source /archives/vad/silero-vad-v6.2.2.onnx --promote

# Restart the worker to pick up the change
systemctl restart voice-host
```

The audit log (`models/.update-log.jsonl`) records the rollback so
the next audit / compliance review can see what happened.

## 5. Verify the rollback

After ANY of the above:

```bash
# Desktop
python scripts/voice/voice-host-test-runner.py --full
# expected: green, with the same counts as the pre-release state

# App
cd packages/app
bun test src/voice/
cd ../..
node node_modules/@typescript/native-preview/bin/tsgo.js -b

# Android (host-compiled; aarch64 cross-compile is hardware-dependent)
cd packages/mobile/src-tauri
cargo test --lib voice::

# Pre-push typecheck is the final gate
pnpm turbo typecheck
```

If any suite turns red, **the rollback is incomplete**. Don't undo
your changes — examine which artefact didn't actually revert and
redo that step.

## 6. Communication channels

For a production rollback:

1. Post to the on-call channel:
   - "Voice <component> rollback in progress: <short-sha> → <old-sha>. Reason: <symptoms>. ETA: <time>."
2. Stamp the rollback in the voice-incident channel with:
   - Commit SHA reverted from
   - Commit SHA rolled back to
   - Link to `models/.update-log.jsonl` entry if it was a model rollback
3. Open a post-incident ticket under `voice/runtime-rollbacks/<date>` with:
   - Symptoms that triggered the rollback
   - Diagnostic snapshots before / after
   - Test count comparison
   - Update-log JSONL entry

## 7. What the rollback does NOT do

- It does NOT revert model registry artefacts to a licence-incompatible
  state (e.g. GPL artefact promoted into MIT mobile). If the prior
  state was GPL-tainted, the rollback has to keep that artefact
  marked `redistributable: false` AND the mobile path must already
  be using a different artefact.
- It does NOT rewrite `models/.update-log.jsonl`. Each entry is
  append-only; falsifying audit history is a hard rule per ADR-067
  (no content telemetry) spirit and the security failure model.
- It does NOT touch OS audio drivers / hardware. Those follow the
  host OS upgrade channel.

## 8. Cross-references

- `docs/voice-production-runbook.md` §3 (start/stop/restart)
- `docs/voice-model-update-procedure.md` §4 (atomic promote)
- `docs/voice-troubleshooting.md` §14 (rollback escalation)
- ADR-066 (Model Artifact Registry)
- ADR-072 (Offline & Network Policy)
- plan §43 (true external blockers don't get rolled back; blockers
  are recorded, not converted into PASS)
