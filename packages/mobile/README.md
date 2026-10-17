# OpenCode Remote for Android

Native Android WebView shell around the **upstream OpenCode V2 interface** (`@opencode/app`). The phone never runs a local OpenCode server, LLM or terminal process: every session and tool executes on the paired PC.

The built-in **Connect to server** screen accepts a one-use link or QR from `opencode pair --remote`. A secure HTTPS tunnel is required when away from the PC; for USB development, `adb reverse tcp:<PC_PORT> tcp:<PC_PORT>` enables `http://127.0.0.1:<PC_PORT>`.

## Development

Requirements: Bun, Rust with `aarch64-linux-android` target, Android SDK/NDK, Java 17, Android device with USB debugging.

```sh
bun install
bun run --cwd packages/mobile test
bun run --cwd packages/mobile build
cd packages/mobile
bunx tauri android init
bunx tauri android build --target aarch64
```

The Android package ID is `ai.opencode.remote`, so an existing `ai.opencode.mobile` installation is not replaced.

If native Rust compilation on Windows runs out of memory, the development branch also has a
GitHub Actions Android build (`.github/workflows/android-remote.yml`). It uploads a temporary,
unsigned-for-distribution **debug APK** artifact; this is not an official OpenCode release.

## Scope

- Single UI implementation: upstream `packages/app` including its built-in pairing and server management.
- HTTPS remote calls go through the native HTTP plugin; non-loopback HTTP is deliberately rejected.
- No local runtime, files, models, shell commands or sidecar.
- The PC must stay running and its OpenCode service must remain reachable. Tunnels are enabled explicitly on the PC, not from this APK.
