# Contribution plan: OpenCode Remote for Android

This working branch intentionally implements the complete Android client first. It is **not**
intended to be proposed upstream as one large pull request before architecture approval.

## Product contract

- Android is a remote client of a running OpenCode V2 service on another machine.
- The interface is imported from upstream `@opencode/app`; no UI fork.
- Pairing, server inventory, events, session operations and permissions reuse upstream clients.
- No on-device OpenCode server, agent, file tools, models or local runtime.
- Out-of-network access requires a user-enabled authenticated HTTPS endpoint, for example
  `opencode pair --remote` on the PC. Android does not expose the PC to the internet.
- USB development may use `adb reverse` and loopback HTTP, but arbitrary unencrypted
  remote servers are rejected.

## Candidate incremental PRs (subject to maintainer feedback)

1. **Native HTTP transport and tests** — isolated network adapter and tests, with
   authentication/streaming/redirect security review.
2. **Android packaging** — add `packages/mobile` with Tauri, official Web UI entrypoint,
   minimal capabilities, camera permission and generated Android project.
3. **Native lifecycle/mobile polish** — keyboard resize, camera QR redemption, back
   navigation, external links, reconnection and persisted authentication, proven on device.
4. **CI and distribution** — deterministic Android debug/release builds, dependency
   licenses, signing instructions and maintainer-approved releases.

Do not publish the Android application as official until upstream accepts the ownership,
support and release plan. This branch is a personal-use development branch until then.

## Acceptance matrix

| Scenario | Verification |
|---|---|
| App starts on a fresh Android install | Native APK launch and screenshot via ADB |
| Same OpenCode interface | Compare native client views with same upstream `packages/app` |
| Pairing using one-time QR or pasted URL | Exercise `opencode pair --remote` against live service |
| Sessions, streaming, permissions and abort | Test on a live OpenCode V2 agent on PC |
| USB test without Wi-Fi | `adb reverse` loopback server |
| Internet access | HTTPS tunnel on mobile data, with authorization preserved |
| No local execution | Inspect Android APK dependencies/processes and repository imports |
| Network safety | Reject non-loopback HTTP, preserve certificate checks and check redirects |

The checks above are acceptance goals; they are **not** automatically satisfied by a
successful frontend build or network routing unit tests.
