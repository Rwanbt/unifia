<!-- SPDX-License-Identifier: MIT -->
# RC-1 platform qualification evidence — 2026-10-15

Scope: #575, #117, and epic #581. This is a dated evidence snapshot, not a release certificate. `dev` was `c40052c06465f6d4c90b92bad67770121da10858` when checked. Re-evaluate all entries on the eventual immutable RC head; a successful run on a different SHA does not qualify that candidate.

## Required targets and evidence

| Target | GitHub/build evidence | Native acceptance evidence | Current disposition |
| --- | --- | --- | --- |
| Windows desktop (Tauri/NSIS + matching CLI sidecar) | `unit (windows)` on `dev` push run `38631781319`; no verified native distributable build on this SHA | Clean install/start, sidecar identity, sessions/Code/Work/Design/Memory, local GPU, Voice Live, update and rollback, signature check | `PHYSICAL_TEST_REQUIRED` |
| Linux desktop | `test`, `typecheck`, `nix-eval`, `CodeQL`, `unifia-conformance` on `dev` push at `c40052c`; browser E2E on same-head sync PR #698 contains an uncorrected Team failure | Native AppImage/deb build and launch, runtime libraries, local GPU, critical flows, update/rollback | `PHYSICAL_TEST_REQUIRED` |
| Android (arm64) | [Build run 38631781221](https://github.com/Rwanbt/unifia/actions/runs/38631781221) success, head `c40052c`; Android Rust tests **compile** but were not executed on a device | Install, signature identity, native libraries, permission refusal/regrant, local LLM/GPU, offline Voice, persistence, update using same certificate | `PHYSICAL_TEST_REQUIRED` |
| macOS, iOS/iPadOS, Web/PWA | No RC-1 platform claim | None required for RC-1 | `NOT_IN_RC1` |

The `dev` push workflow can pass while a `pull_request` workflow fails: PR #698's `test` run `38631814657` failed an E2E Team locator check at the same SHA. A correction is separately proposed in PR #699 and must first be integrated and rerun. No candidate SHA is frozen.

## Android artifact identities

- Android workflow: [run 38631781221](https://github.com/Rwanbt/unifia/actions/runs/38631781221), job `116084952448`, commit `c40052c06465f6d4c90b92bad67770121da10858`, `success`.
- GitHub artifact **archive**, ID `11927624780`, name `unifia-mobile-apk`, size `914042744` bytes; API archive digest: `sha256:37ee9f82115c9a4e8676dfd2c0b1f601fcb4e29e7cda7094e9132f5632f4976c`; expires `2026-11-13T20:58:12Z`.
- The workflow log reports the **APK file** checksum `f78bb0811c78d10c48f6c62aecfc931b25ccbb95037dec1c8cb23ec78c1bddaa`. It has **not** been independently recalculated from downloaded APK bytes in this audit.
- The archive digest is **not** an APK checksum, and neither checksum establishes the signing certificate's identity or proves the APK was installed.
- The development Android workflow may use a CI-generated test keystore. PR #702 (head `b6c54a306000c1edf0863791e73ed5012312b1ef`) proposes mandatory real signing credentials and a pinned certificate check for *non-dry-run* release; the PR's CI alone does not prove actual official signing. The owner must configure the four release signing secrets and public `UNIFIA_ANDROID_CERT_SHA256` variable.

## Voice evidence and unverified journeys

[Voice CI run 38603445263](https://github.com/Rwanbt/unifia/actions/runs/38603445263), head `618736e5300cf8abca7a6d26fc0c03b2b685ae90`, passed all seven contract/host/app/Rust/docs jobs. **No corresponding Voice CI run was found on Android APK head `c40052c`.** Device tests and native microphone frames are not exercised by these host tests. The owner reports Android Voice working in recent builds; the observed capability remains distinct from RC-1 certification.

On an APK built from the eventual RC head, collect a privacy-reviewed logcat/video and record device model, Android version, APK checksum, `apksigner verify --print-certs` fingerprint, model names and hashes, and the observed result for each of these cases:

1. Microphone allow/deny/revoke, native PCM capture, VAD/end-of-turn, STT transcript, Unifia session response and audible TTS output.
2. Airplane mode with all claimed local speech and language models previously cached; confirm the full conversation works without remote inference or audio disclosure.
3. App background/foreground, screen lock, audio interruption and graceful recovery without orphaned microphone or runtime state.
4. Repeated turns with latency/resource observation and correct model/provider/fallback selection. Exercise only the Voice features actually included in RC-1; deferred duplex/Bluetooth/AEC/endurance enhancements are not release gates.

Qualify Windows Voice separately using a Windows native build and microphone/speaker. Do not transfer Android Voice or Linux host-test results to Windows.

## Release-owner evidence to attach before a GO decision

Record for each claimed platform: immutable `dev` candidate SHA, exact binary/APK checksum, distributable type and signature identity, clean install/start, update/rollback, functional journey results, linked native logs, and approver. Attach SBOM/license reports, full artifact checksums, provenance and a terminal CI matrix for that exact SHA. Missing evidence stays `PHYSICAL_TEST_REQUIRED` or `NON_VERIFIED`; it is never counted as `CI_VERIFIED` or `DONE`.

At this snapshot: **NO-GO**. Merge and requalify required PRs, reconcile `dev → dev_auto` through owner-managed #698, then select a candidate and execute the platform evidence matrix. No release, tag, signature using production identity or publication was run during this audit.
