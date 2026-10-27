<!-- SPDX-License-Identifier: MIT -->
# Android native libraries: provenance inventory

**Date:** 2026-10-23
**Scope:** the 16 entries of `MANUALLY_VENDORED` in `packages/mobile/scripts/check-android-runtime.mjs`, read on `dev` at `28d1925815`.
**Method:** each name was searched in the repository. A library counts as produced when a script, a CI step or a CMake target in the repo builds it, and as pinned when that producer fixes a source revision or a checksum.

## Summary

| Verdict | Count | Libraries |
|---|---|---|
| Already built from the repo, entry is stale | 1 | `librust_pty.so` |
| Producer exists, pinned | 1 | `libbusybox_exec.so` |
| Producer exists, not reproducible | 1 | `libggml-vulkan.so` |
| Source present, no build recipe | 1 | `libresolv_override.so` |
| No producer in the repo | 12 | the rest (see below) |

The list says 16 entries. `CLAUDE.md` says 17. The count was not reconciled, so the next run of this inventory should settle it.

## Per library

| Library | Producer in the repo | Pinned? | Status |
|---|---|---|---|
| `librust_pty.so` | CMake target `rust_pty` built from `jni/rust_pty.c` (`jni/CMakeLists.txt`) | by the repo | Built from source. The `MANUALLY_VENDORED` entry is stale. |
| `libbusybox_exec.so` | `scripts/fetch-busybox.sh`: Alpine `busybox-static` apk, URL and SHA-256 pinned | yes (checksum) | Opt-in: not run by the prepare or build scripts, nor by `android.yml`. |
| `libggml-vulkan.so` | `scripts/build-vulkan.sh`: llama.cpp tag `b8683` | tag, not a commit | Hard-coded machine paths (`/home/aes/…`, `/mnt/d/…`). Not reproducible elsewhere. |
| `libresolv_override.so` | source `jni/resolv_override.c` | n/a | `CMakeLists.txt` leaves it out ("NDK compiles against Bionic"). No recipe builds it. |
| `libggml-htp-v68.so`, `-v69`, `-v73`, `-v75`, `-v79`, `-v81` (6) | none | no | Hexagon DSP skels. Their origin and licence are not recorded. |
| `libggml-opencl.so` | none (`CMakeLists.txt` only checks that it exists) | no | No recipe. |
| `libllama_server_hexagon.so` | none | no | Variant of the llama server. |
| `libllama_server_modern.so` | none | no | Variant of the llama server. |
| `libllama_server_opencl.so` | none | no | Variant of the llama server. |
| `libllama_server_vulkan.so` | none | no | `build-llama-server.sh` produces `libllama_server.so`, not this variant. |
| `libmtmd.so` | none | no | `android.yml` builds `libllama`, `libggml*` and a static `llama-server` at `da296d6e`, not `libmtmd`. |

## Consequences

1. **Hexagon skels (6 files) cannot be reproduced from this repository.** Their licence and origin must be recorded before they ship. This is an ADR-027 question, not only a build question.
2. **The four `libllama_server_*` variants and `libmtmd` have no recipe.** The pinned llama.cpp commit in `android.yml` is the natural place to build them, with the same flags as the CI build.
3. **`libggml-vulkan.so` should be built by the CI from `da296d6e`,** not from a personal clone.
4. **The stale entry and the missing recipe are small, independent fixes**, each with its own PR.

## Next PRs (proposed, not opened)

- `fix(mobile): drop librust_pty from the vendored list`: it is built by CMake. Verify by building and checking the output.
- `build(mobile): reproducible libggml-vulkan from the pinned llama.cpp commit`.
- `build(mobile): a recipe for libresolv_override`.
- A licence record for the Hexagon skels, before any of them ship (ADR-027).
- Decide the status of the remaining variants: build them, or remove them from the APK and from `LlamaEngine.kt`.
