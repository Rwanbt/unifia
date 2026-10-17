# OpenCode Android Remote — upstream contribution plan

## Design gate (pending maintainer approval)

Upstream issue: https://github.com/anomalyco/opencode/issues/10288

Specific technical proposal: https://github.com/anomalyco/opencode/issues/10288#issuecomment-6233003922

OpenCode's `CONTRIBUTING.md` asks contributors to wait for design approval
before opening a feature implementation PR. Do **not** create implementation
PRs from this plan until maintainers confirm whether they want a first-party
Android companion, where it should live, and what technical stack it should use.

## Product contract

- Android is **only a remote client** of the running PC service.
- The shared upstream `packages/app` owns the UX and sessions; the phone does
  not run agents, models, terminals or the OpenCode backend.
- Authentication and one-time pairing remain upstream mechanisms.
- Internet connections must use an authenticated HTTPS endpoint; HTTP is
  allowed only on device loopback for USB debugging via `adb reverse`.
- The fork's independently branded Unifia features are outside every PR.

## Proposed review sequence

1. **PR 1 — `feat(app): allow native WebViews to opt out of PWA service worker`**
   - Candidate branch: `contrib/android-remote-01-native-webview`
   - Commit: `19727cb6fcc8c0eb238595cf68b796d78f9055d9`
   - One-line shared-app change only; no mobile feature bundle.
   - Local typecheck passed with Windows symlink workaround. No upstream PR yet.
2. **PR 2 — `feat(mobile): add remote-only Android Tauri shell`**
   - Reuse `@opencode/app` with an Android WebView and no sidecar/local runtime.
   - Limit to native app entry point, platform configuration and Gradle/Cargo
     scaffolding; isolate generated Gradle files and Cargo lockfile in review.
   - Depends on PR 1 (or maintainer-preferred alternative for service workers).
3. **PR 3 — `feat(mobile): route authenticated API over secure native HTTP`**
   - Transport, scoped HTTPS/USB loopback, strict redirect refusal at Rust
     transport boundary, no caller bypass of certificate verification or proxy.
   - Pairing, token persistence and event streaming must use existing upstream
     APIs; include tests for auth, SSE, cancellation, revocation and reconnect.
4. **PR 4 — `fix(mobile): correct Android adaptive launcher assets`**
   - Reuse official `packages/desktop/icons/prod` artwork.
   - Include the 12dp Android-specific inset, five density variants and
     deterministic asset tests; include screenshots of real Android launchers.
5. **PR 5 — `test(mobile): add Android arm64 CI and release instructions`**
   - Pin CI actions, verify tests and TypeScript, build debug APK; provide
     signing/release process accepted by maintainers before official packaging.

Every proposed PR should be a small independently reviewable diff against the
accepted previous layer, not a single 6,000-line feature PR. Generated Android
and Rust lockfiles are the main unavoidable large files. Do not mistake a
passing static asset test for validation of runtime pairing or tool effects.

## Existing implementation and evidence (fork only)

- Complete working prototype: `feat/upstream-android-remote`
- Device-tested source: `e614972a95fa0279b5ce83ffbf4706eae27a7f9f`
- Android arm64 CI: https://github.com/Rwanbt/unifia/actions/runs/39025747021
- Unofficial downloadable preview:
  https://github.com/Rwanbt/unifia/releases/tag/android-remote-v0.1.0-preview.20261017
- The final icon inset was selected after previews of nine dimensions, rather
  than repeatedly guessing Android mask behavior.
- Mi 10 Pro (Android 13): launcher icon, remote sessions/project list observed.
- Xiaomi 14 Ultra (Android 16): fresh APK installed, app launched, official
  pairing screen observed; second phone is not yet paired.
- Mobile transport/icon unit tests pass; upstream pairing/server unit tests
  pass; CI build passes exact SHA. There is **no demonstrated** complete
  off-Wi-Fi mobile-data session, streamed tool run, revocation race proof or
  permission effect E2E on both phones.

## Release distinction

The artifact under `Rwanbt/unifia` is an **unofficial development preview**,
not an official OpenCode publication and not part of the independent Unifia
product. Do not copy private signing keys, pairing codes or account tokens into
the upstream discussion, PR diffs or release artifacts.
