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

## Go on the phone: three options (2026-10-23, study only)

Decision 7 blocks Go. Alpine's `go` is a static ELF, and `libmusl_linker.so` only starts dynamic musl ELFs, so the phone cannot run it today. This section compares the ways out. Nothing here is implemented: the owner picks the option.

- **A. Dynamic Go build against musl.** Build the Go distribution for linux/aarch64 musl with `CGO_ENABLED=1` and external linking, so the result has a musl interpreter and `libmusl_linker.so` can start it, as it already starts lua5.4 and git. User programs would also need `gcc` on the phone for external linking; `gcc` is already in the P1 set. Costs: a pinned Go source build in CI with provenance (ADR-027), and a larger toolchain artifact. **Unverified:** whether the Go distribution's own binaries work this way on Android.
- **B. Run Go under PRoot**, as containers already do (ADR-098). Hypothesis: PRoot's loader runs the target ELF in user space, which would avoid the exec restriction for a static binary. **Unverified.** It is the cheapest test to run first: inside an Alpine container, `apk add go` then `go version` answers it, since `apk add` inside a container is already validated. If it works, the toolchain can expose Go through a PRoot wrapper; it would not reach the agent shell without that wrapper.
- **C. Leave Go blocked.** Go stays out of the on-device toolchain set, and users reach Go through a container or a remote host. No cost, no build work.

**Recommendation:** run test B first. It needs no build change and takes about an hour on a connected phone. If B fails, A is the path, as its own series of PRs. C stays the fallback.

**Owner decision needed:** whether Go is required for release 1. The P1 set in this ADR lists it.
