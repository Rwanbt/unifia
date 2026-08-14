# Work/Design blockers and unlock path

This register separates missing implementation from evidence that requires a real desktop, device, or human decision. It is intentionally fail-closed: a static model or green unit suite does not close a runtime gate.

| Gate | Root cause verified in code | Minimal unlock | Owner/status |
|---|---|---|---|
| M1c / MV-01 | The versioned handshake, server issuer boundary, and shell `NativeTokenBridge` adapter now exist; `packages/app/src/pages/workbench-mode.tsx` still does not construct `WorkbenchClient`, and desktop/mobile expose no concrete implementation of the bridge. | Connect one platform bridge to the internal issue/rotate/revoke methods, keep signing material native/server-side, then prove scope, expiry, rotation and close-time revocation through the real desktop/mobile path. | Contracts/adapters complete; platform implementation open |
| MV-02 | `WorkbenchClient` now validates `TokenRotation` and serializes requests behind the native provider handoff, but no server rotation route/event is wired. | Connect native rotation to `TokenRotation`, pause mutant requests while rotating, accept the previous token only for the configured grace period, then prove rejection. | Client serialization complete; native/server trace open |
| MV-03 | Android runtime health is proven on `b7163823`, but the full current Work → Design and lifecycle flow was not exercised; MIUI rejected `adb shell input`. | Build/sign/install the current APK, use an authorized interactive device path such as scrcpy UHID or human taps, capture one runtime PID before/after backgrounding and both mode screens. | Device interaction; blocked by input policy |
| MV-04 | Renderer and CSP are static-safe, but packaged Android WebView behavior and external-request absence are unproven. | Load a hostile SVG through the real `<img src="data:…">` path, inspect WebView/network logs, and archive a redacted capture. | Device/WebView interaction; open |
| MV-05 | `projectReadOnly()` is proven headless, but the UI has no live Workbench client/approval flow. | Wire the native client, attempt a write, verify default refusal, approve the exact request, then inspect the redacted audit event. | Code + device; blocked behind M1c |
| MV-06 | Mode routes and persistence are implemented; no complete UI/deep-link/reopen matrix has been recorded. | Run desktop E2E/manual matrix across two directories and four modes, including reload and deep links. | Desktop interaction; open |
| MV-07 | Server shutdown closes file sessions, but cross-process instance identity/restart contamination is not exposed as a completed proof. | Add/verify persisted instance identity and restart assertions, then stop/restart the actual local service and compare workspace generations. | Code + desktop process control; open |
| MV-08 | Occupied-port behavior is tested, but the full single-writer ownership proof across two running instances is not. | Add an explicit owner/lock identity if required by the chosen topology, then run two-process configured/automatic-port tests and capture both results. | Architecture + process test; open |
| MV-09 | Static Tauri CSP checks pass; packaged-bundle extraction and allow/deny URL checks are missing. | Extract CSP from desktop and Android bundles, assert exact directives, then test allowed loopback/IPC and forbidden external/frame/object cases. | Build/package check; open |
| MV-10 | This is an intentional human publication gate. | Human reviews diff, license/SPDX, rollback and confirms no merge/publication; no automation can sign this gate. | Human decision; open |
| G6 | No authoritative Design System catalog source was selected; inventing one would violate the plan. | Decide one source and format (workspace manifest, global config, registry, or bundle), then implement M20a/b against that authority. | Human architecture decision; open |

## Current safe order

1. Decide the native token bridge contract and G6.
2. Implement and test issuer injection/rotation before live client calls; the protocol handshake is now available as the first interoperable step.
3. Add the instance/single-writer proof required by the selected topology.
4. Build the current Android candidate and perform the authorized device checks.
5. Run the desktop E2E/deep-link/CSP matrix.
6. Perform MV-10 only after the preceding evidence is archived.

No gate in this register is marked complete by compilation alone.
