<!-- SPDX-License-Identifier: MIT -->

---
id: 1049
title: RC-1 remote and device control — shipped roles, deferred engines
status: ACCEPTED
date: 2026-10-17
ratified: 2026-10-16
related: [1027, 1034]
---

# ADR-1049: RC-1 remote and device control — shipped roles, deferred engines

## Context

RC-1 lot PW10 (#574). The owner ratified **9A now, 9B after RC-1**
(2026-10-16, PR #747): keep the remote/desktop/mobile paths the product
actually ships and secure their roles and actions (#716) with role-denial,
authority, provenance and no-side-effect tests; `@unifia/remote-bridge` and
`@unifia/desktop-runtime` stay deferred. The 9B phase — full integration of
those engines — starts only after RC-1, under its own ADR, and never as a
parallel control plane.

#716 (merged 2026-10-16) hardened the shipped surface and wrote it down:

- `docs/production/REMOTE-CONTROL-RC1.md` records the reachable entry points
  by platform: the Windows desktop Tauri host launching the `unifia serve`
  sidecar (disabled by default; generated password + Basic username guard LAN
  access), the Linux CLI HTTP server (a non-loopback listener refuses to start
  without `UNIFIA_SERVER_PASSWORD`), and the Android local sidecar with
  remote selection/pairing (TLS fingerprint via pairing link). macOS, iOS and
  Web/PWA are `NOT_IN_RC1` under D5 — source or an unqualified UI entry does
  not imply support.
- The access boundary is the role matrix enforced by
  `packages/unifia/src/server/route-authority.ts`: `classify()` applies the
  single declared table of `route-classes.ts`, `permitted()` decides
  (viewer: reads only; member: content writes; admin: everything except
  owner-only remote Workbench bridges; operator Basic: the remote Workbench
  owner per ADR-091). `server.ts` consults the policy before route handlers;
  unknown non-GET mutations are denied; every registered route has exactly one
  class, verified by `test/server/route-registry.test.ts`.
- The behavioral proof is `test/server/remote-control-authority.test.ts`
  against the real HTTP server (viewer/member refusals on execute-class
  routes, operator/admin permits, remote peer and passwordless-loopback
  cases), on top of the RED reproduction the #574 candidate recorded (a
  signed viewer bearer POST to `/tui/execute-command` returned 200 on the
  base SHA).

Both engines carry the generic manifest reason and `trackingIssue: 574`.
`REMOTE-CONTROL-RC1.md` already states the future-activation requirement;
this ADR makes it the recorded decision and pins it structurally.

## Decision

**1. The RC-1 remote authority is the shipped HTTP surface under the
route-role policy.** Every entry named in `REMOTE-CONTROL-RC1.md` is served
by the same server and the same policy; the policy is applied before
handlers; the route registry keeps additions classified. No other remote
control plane exists in RC-1.

**2. `@unifia/remote-bridge` and `@unifia/desktop-runtime` stay
`deferred-runtime`.** No shipped importer, no listener, no consumer; their
manifest entries state the 9A disposition. Active desktop controls remain the
Tauri host and the server routes.

**3. The 9B program is post-RC-1 and gated.** Adopting either engine requires
its own ADR establishing a single authority, a pairing/auth/transport/
revocation contract, migration with rollback, platform qualification with
physical-device tests (#575 and the later global program #598), and an
external security review — and integration that reports to that authority,
never a parallel control plane.

**4. The invariants are pinned.**
`packages/unifia/test/server/single-remote-authority.test.ts` reads the
shipped sources and asserts: no `src` file mentions either deferred engine;
the role policy (`classify`/`permitted`) has exactly one definition module
under `src/server` (`route-authority.ts`) and `server.ts` imports it. Each
assertion was validated RED (a planted import and a planted second
classifier failed the expected way) before the GREEN run.

## Rejected alternatives

- **Wire an engine during RC-1**: 9B explicitly does not start in RC-1;
  the engines have no runtime contract or qualification yet.
- **A second role-decision module beside `route-authority.ts`**: two
  policies that drift is how a route ends up enforced differently than it is
  declared; the guard fails on the second definition.
- **Treat source or unqualified UI entries as platform support**: contradicted
  by D5 (`NOT_IN_RC1`) and by `REMOTE-CONTROL-RC1.md`.

## Consequences

- The RC-1 claim is precise: shipped paths, one policy, behavioral proof
  against the real server, and the exclusions written down where operators
  read them.
- The manifest no longer reads as unfinished work: both entries name the
  disposition and the conditions their successors must meet.
- The guard fails loudly if a dormant engine or a second policy returns.

## References

- #574 (PW10), #716 (role enforcement and REMOTE-CONTROL-RC1.md), PR #747
  (ratified 9A/9B), ADR-091 (remote Workbench owner gate), ADR-1027
  (local-install secret), ADR-1034 (capability scope vs approval broker),
  #575 / #598 (qualification and the later global program).

## Amendment — 2026-10-17 (owner decision 8B supersedes the desktop-runtime deferral)

Owner decision 8B makes Computer Use REQUIRED for RC-1. `@unifia/desktop-runtime`
therefore leaves the deferred set: `packages/unifia/src/server/desktop-surface.ts`
composes `DesktopAutomationBroker` + `WindowsDesktopDriver` at the distributed
sidecar entry, opt-in only (Windows + `UNIFIA_DESKTOP_ALLOWED_APPS` allowlist;
`UNIFIA_COMPUTER_USE_DISABLED` kill switch; process emergency stop). With no
allowlist the `/v1/desktop/*` routes keep answering 503 and no driver is
constructed. Decision 2 above still holds for `@unifia/remote-bridge`, which
remains deferred. Physical platform qualification, receipts hardening
(computer-use-safety) and the §6 security checklist stay tracked by #571; no
RC-1 GO claim follows from this amendment.
