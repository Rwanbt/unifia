<!-- SPDX-License-Identifier: MIT -->
# RC-0 Android C compiler diagnosis

## Observed failure

Dev84d4030c59 Android run36917457107 fails in ring0.17.14's C build script.
The log explicitly reports CC_aarch64_linux_android=None, then tries
aarch64-linux-android-clang and fails ToolNotFound. The NDK installation
is present; Tauri's Gradle command supplies the absolute API24 Rust linker,
but that linker variable does not configure cc-rs's C compiler.
The failed build output is retained in rc0-android-dev-failed-20261002.log.

## Correction and same-pattern search

The Android NDK setup now verifies the API24 compiler and llvm-ar and
exports CC_aarch64_linux_android, AR_aarch64_linux_android and the target
Rust linker through GITHUB_ENV. These are target-specific, so they do not
replace the host C compiler used by other build tools.

The release Android job has the same missing setup and receives the same
correction as preparation only. The Android test-compile step and
mobile-runtime-tests already supply these variables explicitly. The local
build-bun-pty script also supplies the target compiler and archive tool.
No workflow is enabled, no signing identity or secret is changed.

## Evidence and boundary

Both YAML documents parse. Extracted setup blocks pass bash syntax checks.
A controlled fake NDK witness confirms all three variables reach GITHUB_ENV;
removing the compiler rejects setup before any variable is exported.
Command: bun rc0-agent/.build-temp/rc0-android-env-witness-20261002.mjs
Result: both workflows PASS all four configuration checks, exit0.
This witness does not compile ring or build an APK. The corrected real
Android build must still run on dev after the required PR checks and merge.
No release workflow, signing operation, publication or physical test was
invoked as part of this qualification. QA12R remains open.
