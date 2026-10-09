<!-- SPDX-License-Identifier: MIT -->
# Mobile local startup qualification

Date: 2026-10-04. Canonical scope: [issue #253](https://github.com/Rwanbt/unifia/issues/253).

## Product contract

Android cold launches prepare and start the embedded local runtime automatically. The existing Device/Compute server dialog switches to configured or paired remote devices and back to local after the application opens. Saved remote definitions and credentials remain available; a saved default never changes Android cold-start policy.

Local startup does not download or start an LLM model. An error is visible with local retry and an explicit remote escape. iOS retains remote bootstrap because its embedded runtime is not implemented. Native remote Workbench capability, discovery and SSH are not introduced by this correction.

## Delivery trace

| Layer | Implementation | Proof |
| --- | --- | --- |
| Startup | mobile/startup.ts, entry.tsx, ExtractionProgress | Readiness matrix tests; frontend cold launch |
| Native transport | Existing startLocalServer / Rust commands | Official IPC mocks and real isolated HTTP backend; physical qualification pending |
| Device and SDK | Existing server dialog; ServerKey scopes GlobalSDKProvider | Chromium observes SDK requests after both switches |
| Consumers | MobileConnectionEffects; active model-manager credentials | Notification unsubscribe tests; embedded-only model-load guard |
| Local recovery | EmbeddedRuntimeGuardian outside the selected-server health gate | Keeps local available without selecting a target |
| Pairing | parsePairingLink / MobilePairingDialog | Cold/warm existing form; bounded URL, credentials and fingerprint guards |
| Navigation | Deferred MobileNavigationLinks | Cold README.md editor tab; warm exact session route after SDK lookup |

PRs: #254 startup; #256 SDK/consumers/recovery; #257 pairing; #258 navigation. #254 merged at `e5cd30fc3ea45eeee8d024d3835ba3d9eeeea21b`; #257 merged at `6500a33e0bda222ac48d98f2a5b6cd93ca4b3474`. Remaining merge and final evidence are appended below.

## Software evidence

Package-local commands: `bun typecheck`, `bun run test`, `bun run build` in packages/mobile; `bun run test:e2e:local -- app/server-switch.spec.ts app/server-default.spec.ts --workers=1` in packages/app. TEMP/TMP: `.worktrees/rc0-agent/.build-temp`.

Combined local proof: 96 pass / 0 fail / 161 assertions. P1: 87 tests; P2: 82; P3: 84; P4: 90. Build before the recovery adjustment passed in 28.82 seconds. Final integrated evidence follows below.

Browser viewport 390x844; official Tauri IPC mocks simulate Android commands and SDK requests reach a real isolated backend. Fresh state extracts once and installs advanced tools once; ready state skips both. A saved remote default remains stored while cold launch renders local. QR cold/warm forms require confirmation, remote selection succeeds, and local remains in the same dialog. No start_llm/download_model calls observed. Startup error and local retry were exercised.

Screenshots: `evidence/mobile-local-startup-20261004.png`, `evidence/mobile-pairing-20261004.png`, `evidence/mobile-open-file-20261004.png`. Disposable native harness: `.worktrees/mobile-local-startup/packages/mobile/.build-temp/native-browser-probe.{ts,html}`. Logs: `.worktrees/rc0-agent/.build-temp/mobile-*.log` and `server-switch-p2-e2e-2.log`.

## Failure classification and limits

- Direct `bun test` omitted HappyDOM; the configured `bun run test` passed.
- First server-switch E2E expected Home although the workspace route rendered. Final test checks transport and existing Status UI; no skip or timeout relaxation.
- Sandbox esbuild spawn failed EPERM; permitted build passed without source changes.
- Combined E2E attempt stopped during seed with code 9, before Playwright. Cause unproven; not a product PASS or confirmed flake. Next attempt failed waiting for the initial route / dynamically imported module. Final isolated rerun is recorded separately.
- Initial navigation probe exposed Windows canonical-path spelling and unowned reactive readers. Final implementation uses the server's /path result and the component owner.
- Open-file links require an absolute project context and remain inside it. Previous file-only events had no consumers. Unsafe/unscoped inputs are rejected; paths are decoded once.
- No APK or physical PASS is claimed. Software evidence does not qualify native extraction, Android intent delivery, process survival or signing on a device.
- Initial captures showed a blank central surface although the DOM contained Home/editor. The disposable probe omitted the actual mobile index.html root classes (`flex flex-col h-dvh`): shell-frame was 48px and shell-clip 0px at 390x844. Restoring those classes in the probe makes them 844px/796px. Captures were regenerated and visually inspected; no product regression or product CSS fix was inferred from this harness error.

## Owner qualification

Record source SHA, APK SHA-256, phone/OS and observed startup/selection behavior on a freshly built artifact through the existing signing pipeline.

- [ ] Clean install: preparation, progress, opens locally without selector.
- [ ] Prepared runtime / previous remote: cold launch local, no repeated extraction, remote entries preserved.
- [ ] Device menu: local -> authenticated remote / supported configured device -> local.
- [ ] Unreachable remote: explicit error, working local retained.
- [ ] Local dies while remote is active: recovery keeps remote selected; return local succeeds.
- [ ] Cold/warm QR and open/session Android intents; background/resume; rapid switching.
- [ ] No local model: application opens without downloading a model.

Physical Android/Windows tests, signing identities, RL03-RL07, main promotion, tags and publication remain with Erwan. This note grants no release GO or QA12R PASS.

## Final combined software probe

Proof branch source: `3ebc1379823c5001ac426cb821794549a4ce34f1` (four source lots assembled locally, including EmbeddedRuntimeGuardian). Mobile typecheck and configured tests pass: 96 tests, 161 assertions. Final permitted mobile build passes in 17.91 seconds; existing large-chunk warnings remain.

With remote `localhost:55258` selected, the native health mock is forced down. Embedded starts increase from one to two while the remote remains selected. Returning through the same server dialog restores `127.0.0.1:55258`, with two starts total and no start_llm/download_model calls. Screenshot: `evidence/mobile-recovery-20261004.png`. This proves frontend ownership and recovery scheduling with mocked native health, not Android process recovery.

The final isolated Device-switch/default E2E rerun passes both tests in 44.3 seconds (`mobile-switch-default-e2e-final.log`). Published source heads at recording: #256 `3709f67d15`; #258 `10ecaba127`. Their new CI checks are pending; this document does not claim their merge or a final dev qualification.

## Integration update

#258 merged on dev at `3a9befbfa0daa154ead4e967c44e9afdb346b2f9` after all seven protected checks passed. #256 was integrated with that dev through normal merges, latest head `e84a9f232aca68169c295bc24d5068a66f21becf`: 271 changed lines, mobile typecheck and 96 tests / 161 assertions pass, exact-head mobile build passes in 15.13 seconds. The assembled E2E rerun passes both tests in 28.2 seconds (`mobile-integrated-final-e2e.log`); its mobile/app source trees match this latest head.

`node scripts/check-workbench-security.mjs` passes, including packaged CSP policy. Native preflight `bun scripts/check-android-runtime.mjs` fails because this fresh worktree lacks rootfs.tgz and the generated Android version file. This is an unprovisioned native worktree, not a frontend PASS or a demonstrated regression; run the repository provisioning pipeline before an APK build.

The previous #256 Windows job (run 37182667465, job 111378201542) reports 5305 pass, 65 skip, 0 fail, 1 unhandled error: ERR_STREAM_DESTROYED in vscode-jsonrpc/lib/node/ril.js:88 / messageWriter.js:99. Raw log is retained in mobile-pr256-windows-failed.log. This matches the category documented in RC0-WINDOWS-UNIT-BUILD-FAILURES.md; a transitory cause is not proven until rerun. The new integrated head has a fresh CI run; no failed head was merged.
