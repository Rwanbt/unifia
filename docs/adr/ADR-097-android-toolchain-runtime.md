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

   **Phase 1 (2026-10-23).** Removed from the bundled rootfs, installed on demand instead: `gdb`, `lldb`, `php83` with its PDO and mbstring modules, `composer`, `postgresql17-client`, `mariadb-client`, `go`, `ruby`, `ruby-dev`, `cmake`, `ninja-build`, `meson`. Kept in the APK: `openjdk21-jdk` (replaced the same day by `openjdk17-jdk`, see Embedded below), `gradle`, `maven`, `strace`, `ltrace`, `sqlite`, and everything in the base list, gcc and Rust included.

   The Java chain stays because it is not proven to run. On a Mi 10 Pro, `openjdk17-jdk` installed on demand (exit 0, files in `usr/lib/jvm/java-17-openjdk`), but `bin/java -version` failed through `libmusl_linker.so` in three variants (`--library-path`, `LD_LIBRARY_PATH`, `JAVA_HOME`) with `cannot load -version`. Diagnosis (same day). Two JDKs, two results under PRoot, same rootfs:

- **JDK 17** (installed on demand): `java -version` prints `openjdk version "17.0.18"`. It runs.
- **JDK 21** (bundled in the APK, the one the product ships): the VM fails to start with `Failed to mark memory page as executable`. It fails the same way with each of these: `-Xint` (no JIT), a 32 MB reserved code cache, `-Xshare:off` (no CDS archive), `-XX:-UseCompressedClassPointers`, `-XX:-UseCompressedOops`, `-XX:+UseSerialGC`, and `-Xmx256m`. None of these components is the cause. The VM dies before it can log, so the failing `mprotect` is not identified. The working hypothesis, not verified, is that JDK 21 makes its executable memory with a `PROT_NONE` reservation followed by `mprotect(PROT_EXEC)`, which this device refuses for app processes.

The direct launch through `libmusl_linker.so` fails for both: the linker resolves every `DT_NEEDED` of `bin/java` (`--list`), but a plain `busybox echo` launched that way dies with `Bad system call` (SIGSYS) and no output, while the same busybox runs under PRoot. The SIGSYS tracer in the APK (`libsigsys_trace.so`) is built for Bionic and cannot be preloaded into a musl process, so the failing syscall is not identified.

So the Java path that works is PRoot with JDK 17. Removing the JDK 21, Gradle and Maven from the APK waits for a JDK that runs under PRoot on the phone, and the product must choose which JDK its `java` wrapper launches.

The product chose JDK 17 (2026-10-23, `fix/jdk17-proot-wrappers`). Two findings from the phone shape how the wrappers can run:

- The agent shell's `java`, `javac` and `jar` are shell functions that call `libbash_exec.so <wrapper>`. That route runs. A wrapper launched by its shebang, or any PATH lookup that reaches it, dies with SIGSYS: the seccomp filter refuses the kernel's exec of a script in app data, and it refuses `access(X_OK)`, so `[ -x ]` kills the shell. The existing `git` and `cargo` wrappers die the same way when run by path.
- The app shell reports the home through the `/data/data` symlink (`pwd -P` gives it, `$PWD` gives the canonical `/data/user/0` path). PRoot binds the canonical path, so the wrapper maps the prefix before passing the working directory.

Fixed for `mvn` and `gradle` in #894: they run under PRoot with JDK 17. Still open: any `java` run by PATH from outside the agent shell's functions.

**Embedded (2026-10-23, owner decision).** The APK ships `openjdk17-jdk` in place of `openjdk21-jdk`, so the JDK that `java`, `javac`, `jar`, `mvn` and `gradle` run under PRoot is the one in the APK, not one installed on demand. Side effect: JDTLS, the Java language server, refuses to start below Java 21 (`packages/unifia/src/lsp/server-defs-b.ts`), so it is unavailable on the phone until a JVM 21 runs under PRoot there.

5. **Licences.** Packages installed on demand are fetched by the user's device from Alpine; Unifia does not convey them, so ADR-027 §8 exceptions are not needed for them. The rootfs bundled in the APK does convey GPL components (git, gcc, bash, busybox); that remains an open ADR-027 defect until the rootfs is reduced or an exception ADR is written, with source offers.
6. **The bundled rootfs is adopted as a pinned base** (amended 2026-10-23, after the first phone run). Its packages were installed by apk at build time, so with an empty database the first install refused to overwrite musl, an unmanaged file. On first use the manager imports `lib/apk/db/installed`. Base packages:
   - satisfy dependencies as they are, without being upgraded from the index;
   - are never removed by a change;
   - do not count against the quota.

   A newer version of a base package therefore arrives only with the next APK.
7. **Go runs in the agent shell through PRoot** (owner decision, 2026-10-23, option B below). Alpine's `go` is a static ELF, which the linker route cannot run, so `go` and `gofmt` are wrappers that run `usr/lib/go/bin/<tool>` under PRoot, as the JDK tools do. Installed on demand with the toolchain manager, not carried in the APK.

## Rejected alternatives

- **Bionic/Termux as DSH does.** Needs targetSdk 28 (not shippable) and relocation of the `/data/data/com.termux` prefix; DSH's own index is unauthenticated.
- **A frozen lockfile of package URLs and SHA-256.** Alpine removes old files, so pinned URLs break; mirroring them would mean publishing artefacts, which needs owner approval (D9).
- **Running `apk` under PRoot on the phone.** An earlier attempt failed under PRoot, adds a ptrace layer to every syscall, and would put a second package database next to ours.
- **Keep everything bundled at build time.** No update, no removal, a large APK, and Unifia keeps conveying copyleft binaries.

## Consequences

- One package authority on the phone: the manager's database. Files from the bundled rootfs are adopted only when identical and never overwritten.
- SHA-1 remains inside Alpine's signature scheme (apk-tools v2). A forgery would need Alpine's builders to sign attacker-chosen content; the data itself is bound by SHA-256.
- Proof so far: unit tests on a real Alpine-signed package and on a signed repository, a real install from the CDN on Windows, and the arm64 e2e workflow (`android-toolchain-e2e.yml`). Nothing yet on a phone: the SELinux exec path, DNS through the app proxy and storage budgets stay NON_VÉRIFIABLE until a device run.

## Go on the phone: three options (2026-10-23)

Decision 7 blocked Go until a path existed. Alpine's `go` is a static ELF, and `libmusl_linker.so` only starts dynamic musl ELFs, so the phone cannot exec it directly. Option B below shows that it runs under PRoot. This section compares the ways out. The owner picked B for the agent shell too (decision 7).

- **A. Dynamic Go build against musl.** Build the Go distribution for linux/aarch64 musl with `CGO_ENABLED=1` and external linking, so the result has a musl interpreter and `libmusl_linker.so` can start it, as it already starts lua5.4 and git. User programs would also need `gcc` on the phone for external linking; `gcc` is already in the P1 set. Costs: a pinned Go source build in CI with provenance (ADR-027), and a larger toolchain artifact. **Unverified:** whether the Go distribution's own binaries work this way on Android.
- **B. Run Go under PRoot**, as containers already do (ADR-098). **Works on the phone** (2026-10-23, result below): a static Go ELF runs under PRoot. The agent shell reaches it through PRoot wrappers (`go`, `gofmt`), decision 7.
- **C. Leave Go blocked.** Go stays out of the on-device toolchain set, and users reach Go through a container or a remote host. No cost, no build work.

**Result of test B (2026-10-23, Mi 10 Pro, Android 13, debug build of `ai.unifia.mobile` 1.5.0).** Using a copy of the pulled `alpine:3.21` rootfs in the app cache, driven through the app's own server shell, PRoot (`libproot_exec.so` from the native library directory) ran Alpine's `go` (`go1.23.9 linux/arm64`). `go build` then compiled a hello program. The resulting ELF has no musl interpreter, so it is static, and PRoot ran it and printed its output.

**Product path, same day.** The bundled CLI, launched the way the server launches Bun, ran `unifia container pull golang:1.23-alpine`, then `unifia container run golang:1.23-alpine go version` (`go1.23.12 linux/arm64`), then compiled and ran a hello program in one container. The program printed its output and the run exited 0. This is the path the product uses.

What this does not show:

- `binutils-gold` failed to install (`Failed to create usr/bin/ld.gold: Permission denied`). That matters for option A, which needs external linking, and for any `go build` that links externally.
- Inside the Alpine rootfs, HTTPS to the package mirror failed with `certificate verify failed`, even after the runtime CA bundle was copied in. Pulling `golang:1.23-alpine` from Docker Hub worked through the app's proxy, so the failure is specific to apk's TLS inside the rootfs. Its root cause is unknown, and the product would have to fix it before containers can install packages.
- Whether Go in the agent shell, outside a container, can take the same path. Decision 7 takes it, through wrappers.

**Recommendation:** take B for Go inside containers. Then decide whether the agent shell also needs Go, which means a PRoot wrapper and its own series of PRs. Keep A only for external linking, once the `ld.gold` failure is understood. C stays the fallback.

**Owner decision (2026-10-23):** Go runs from the agent shell through PRoot wrappers (option B). The P1 set in this ADR lists Go, so it stays in the on-demand catalogue; the wrappers are in `feat/go-agent-shell`.
