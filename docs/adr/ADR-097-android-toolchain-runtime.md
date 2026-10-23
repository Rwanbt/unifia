<!-- SPDX-License-Identifier: MIT -->
# ADR-097 — Android toolchains: Alpine rootfs plus a verified on-device manager

**Status:** DECIDED by the implementing session on the owner's instruction not to ask for this choice (2026-10-22). The owner may revisit it.
**Date:** 2026-10-22
**Scope:** how Unifia Android obtains, installs, updates and removes developer toolchains. Complements ADR-023 (egress), ADR-024 (untrusted components) and ADR-027 (supply chain).

## Context

The owner asked for real toolchains on the phone itself, with no PC, no Termux and no root, taking Deepseek-Harness-Local-Android (DSH) as the reference. Three options were open (see [ANDROID-DSH-PARITY-PLAN](../production/ANDROID-DSH-PARITY-PLAN.md)): keep Alpine musl, move to Bionic/Termux packages as DSH does, or a hybrid.

Facts measured for this decision (SHAs in [ANDROID-DSH-EXECUTION-STATE](../production/ANDROID-DSH-EXECUTION-STATE.md)):

| Fact | Evidence |
|---|---|
| DSH runs Termux binaries by targeting SDK 28, a sideload-only exemption from W^X that lets it `execve` files in `filesDir`. | DSH `app/build.gradle.kts:20-22`, `RuntimeInstaller.kt:24`, `dsh_pty.c:8` |
| Unifia targets SDK 36, where that `execve` is denied. It already runs dynamic musl ELFs by handing them to `libmusl_linker.so` from `nativeLibraryDir`, Code comments record device runs of this path for git helpers and the C/C++ drivers (Mi 10 Pro, D-13). | `packages/mobile/src-tauri/gen/android/app/build.gradle.kts:32`; `runtime/toolchain.rs:146-172`; `src/git/android-launcher.ts` |
| DSH does not authenticate the Termux index: no `InRelease`/GPG check, and the per-package SHA-256 is skipped when the index omits it. Its mirrors are third parties. | DSH `ExtensionManager.kt:517` (`p.sha256.isEmpty() \|\|`), `:770-789`; `catalog.json` mirrors |
| Alpine's chain can be verified without apk-tools: RSA signature of `APKINDEX` by a pinned key, index `C:` = SHA-1 of the control member, control member signed again, `datahash` = SHA-256 of the data member. | Checked by hand with `openssl` on the live v3.21 aarch64 index and on `zlib-1.3.2-r1`; encoded in `packages/unifia/src/toolchain/repository.ts` |
| Alpine deletes superseded package files from a stable branch: `zlib-1.3.1-r2.apk` returned 404 once `-1.3.2-r1` shipped. A frozen list of URLs breaks within weeks. | `curl` on dl-cdn.alpinelinux.org, 2026-10-22 |
| The P1 set (Python+pip, Node+npm, Git, SSH, curl, Clang, gcc/g++/make, Rust/Cargo, Go) resolves to 77 Alpine v3.21 aarch64 packages: 350 MB to download, about 1 GB installed. | resolver run on the live indexes |
| Alpine's `go` is a static ELF: `libmusl_linker.so` cannot start it, so `toolchain.rs` skips its wrapper. | `runtime/toolchain.rs:638-682` |
| The APK ships `rootfs.tgz` with 64 packages built at release time, unpinned and without a tarball checksum, including copyleft components conveyed by Unifia. | `packages/mobile/scripts/build-alpine-rootfs.sh:57-59`, `:82-101`; matrix rows A |

## Decision

1. **Keep Alpine musl as the on-device userland and its execution path** (`libmusl_linker.so`, shebang wrappers, git dispatcher). Do not adopt Termux/Bionic packages: running them needs targetSdk 28, which Unifia cannot ship, or a second exec path with no evidence it works.
2. **Add an on-device manager** (`packages/unifia/src/toolchain/`) that installs on demand from the official Alpine repositories and verifies the full signed chain itself:
   - pinned Alpine keys per architecture, copied from alpinelinux.org and checked identical to aports;
   - resolution from the live signed index, not from a frozen URL list;
   - every byte extracted is bound by the signed SHA-256 `datahash`;
   - downloads through the Network Authority, Alpine CDN origin only, redirects refused (ADR-023);
   - journaled transactions, offline rollback from the verified cache, quota and free-space checks before download, autoremove.
3. **The manager runs inside the existing Bun engine**, so the same code serves the CLI (`unifia toolchain`), the agent and the UI, and writes into the rootfs the native runtime already extracted (`OPENCODE_MOBILE_ROOTFS_DIR`). After an install the native runtime must regenerate its wrappers (next lot).
4. **Shrink the shipped rootfs later**, once on-device installs are proven on a phone: the APK then carries a minimal base and the toolchains come from Alpine on demand. Until then the bundled rootfs stays as is (no feature is removed, gcc included).

   **Phase 1 (2026-10-23).** Removed from the bundled rootfs, installed on demand instead: `gdb`, `lldb`, `php83` with its PDO and mbstring modules, `composer`, `postgresql17-client`, `mariadb-client`, `go`, `ruby`, `ruby-dev`, `cmake`, `ninja-build`, `meson`. Kept in the APK: `openjdk21-jdk`, `gradle`, `maven`, `strace`, `ltrace`, `sqlite`, and everything in the base list, gcc and Rust included.

   The Java chain stays because it is not proven to run. On a Mi 10 Pro, `openjdk17-jdk` installed on demand (exit 0, files in `usr/lib/jvm/java-17-openjdk`), but `bin/java -version` failed through `libmusl_linker.so` in three variants (`--library-path`, `LD_LIBRARY_PATH`, `JAVA_HOME`) with `cannot load -version`. Diagnosis (same day). The JDK itself works: under PRoot, against the bundled rootfs, `java -version` prints `openjdk version "17.0.18"`. The failure is in the direct launch through `libmusl_linker.so`, not in the JDK. Evidence: the linker resolves every `DT_NEEDED` of `bin/java` (`--list`), so library lookup is fine; a plain `busybox echo` launched the same way dies with `Bad system call` (SIGSYS), with no output, while the same busybox runs under PRoot. The SIGSYS tracer in the APK (`libsigsys_trace.so`) is built for Bionic and cannot be preloaded into a musl process, so the failing syscall is not yet identified. Removing the JDK, Gradle and Maven from the APK waits for a JVM that runs on the phone through a path that works.
5. **Licences.** Packages installed on demand are fetched by the user's device from Alpine; Unifia does not convey them, so ADR-027 §8 exceptions are not needed for them. The rootfs bundled in the APK does convey GPL components (git, gcc, bash, busybox); that remains an open ADR-027 defect until the rootfs is reduced or an exception ADR is written, with source offers.
6. **The bundled rootfs is adopted as a pinned base** (amended 2026-10-23, after the first phone run). Its packages were installed by apk at build time, so with an empty database the first install refused to overwrite musl, an unmanaged file. On first use the manager imports `lib/apk/db/installed`. Base packages:
   - satisfy dependencies as they are, without being upgraded from the index;
   - are never removed by a change;
   - do not count against the quota.

   A newer version of a base package therefore arrives only with the next APK.
7. **Go is BLOCKED on the phone** until a separate path exists (for example a dynamically linked Go build or Go from source with an external linker). It works in the arm64 CI chroot only.

## Rejected alternatives

- **Bionic/Termux as DSH does.** Needs targetSdk 28 (not shippable) and relocation of the `/data/data/com.termux` prefix; DSH's own index is unauthenticated.
- **A frozen lockfile of package URLs and SHA-256.** Alpine removes old files, so pinned URLs break; mirroring them would mean publishing artefacts, which needs owner approval (D9).
- **Running `apk` under PRoot on the phone.** An earlier attempt failed under PRoot, adds a ptrace layer to every syscall, and would put a second package database next to ours.
- **Keep everything bundled at build time.** No update, no removal, a large APK, and Unifia keeps conveying copyleft binaries.

## Consequences

- One package authority on the phone: the manager's database. Files from the bundled rootfs are adopted only when identical and never overwritten.
- SHA-1 remains inside Alpine's signature scheme (apk-tools v2). A forgery would need Alpine's builders to sign attacker-chosen content; the data itself is bound by SHA-256.
- Proof so far: unit tests on a real Alpine-signed package and on a signed repository, a real install from the CDN on Windows, and the arm64 e2e workflow (`android-toolchain-e2e.yml`). Nothing yet on a phone: the SELinux exec path, DNS through the app proxy and storage budgets stay NON_VÉRIFIABLE until a device run.
