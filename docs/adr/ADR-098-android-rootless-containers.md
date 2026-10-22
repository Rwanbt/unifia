<!-- SPDX-License-Identifier: MIT -->
# ADR-098 — Android containers: OCI images run under PRoot, without root

**Status:** DECIDED on the owner's request: containers must run on the phone itself, not only through a remote Docker client (2026-10-22).
**Date:** 2026-10-22
**Scope:** pulling, storing and running OCI/Docker images on Unifia Android. Complements ADR-097 (toolchains), ADR-023 (egress) and ADR-027 (supply chain, licences).

## Context

A Docker or Podman engine needs kernel namespaces and cgroups. An unprivileged Android app gets neither: unprivileged user namespaces are not available to `untrusted_app`, and the SELinux policy denies the related operations. A rootful daemon is out of scope, since Unifia never requires root (ADR-097).

What an app can do without root is trace its own children with `ptrace`. PRoot uses that to give a process a different root directory and to translate paths in system calls. That is how proot-distro and udocker run Linux distributions and container images on Android.

Execution follows the same rule as ADR-097. With targetSdk 36, files under app data cannot be `execve`d. So the `proot` binary and its loader ship in `nativeLibraryDir`, as `libmusl_linker.so` already does.

## Decision

1. **Containers are OCI images run under PRoot.** Unifia pulls an image, verifies it, unpacks it into its own rootfs and runs commands in it through PRoot. The interface follows Docker vocabulary where it fits (`pull`, `run`, `ps`, `rm`, `images`, `rmi`). It is never called Docker Engine.
2. **Images are verified by digest.** Unifia resolves the manifest, choosing `linux/arm64` on the phone, then checks every blob against the SHA-256 in its descriptor before using it. A tag is resolved once and recorded as a digest.
3. **Registries go through the Network Authority.** That covers Docker Hub (`registry-1.docker.io`, `auth.docker.io` and its blob CDN) and GHCR. Each redirect is authorized as a new destination (ADR-023 §112), from an explicit list of allowed origins.
4. **Layers are applied with OCI whiteouts.** `.wh.<name>` deletes an entry and `.wh..wh..opq` empties a directory. Every write goes through the same path checks as `toolchain/archive.ts`: no absolute paths, no `..`, and no write through a symlink.
5. **PRoot is built from source in CI,** from Termux's maintained fork at a pinned commit, for arm64 (APK) and Linux aarch64 (e2e). It ships as `libproot_exec.so` (the name the runtime already links as `proot`, previously a hand-vendored binary of unknown origin) and `libproot-loader.so`.

## Licences (ADR-027 §8 exception)

PRoot is GPL-2.0-or-later, and the talloc library linked into it is LGPL-3.0-or-later. Shipping them in the APK conveys them. This ADR is the documented exception ADR-027 §8 requires. Conditions:

- PRoot runs as a separate program. No Unifia code links against it, so Unifia's MIT code stays MIT.
- Full corresponding source: pinned upstream commits and the exact build script, both in this repository. Their licence texts ship in the APK notices.
- Nothing is modified beyond what the build script records.

Images pulled by the user come from their registry. Unifia does not convey them.

## Limits (to be stated in the product)

- No kernel isolation: there are no cgroups and no network namespace. A container shares the app's network, so a port opened inside it is opened by the app. Every container runs as the app's uid, and "root" inside is emulated (`-0`).
- System-call overhead from `ptrace`: the 2026-10-22 measurement is pending.
- Images built for another architecture do not run, because there is no emulation.

## Rejected alternatives

- **Remote Docker client only.** It runs nothing on the phone.
- **Rootless Podman or runc.** It needs unprivileged user namespaces, which are not available to Android apps.
- **Requiring root.** It contradicts ADR-097 and excludes most users.

## Consequences

The phone can run containers from public images with integrity checks, but without the isolation guarantees of a real container engine. The UI and the agent tool must say so. This ADR changes nothing in the toolchain manager.
