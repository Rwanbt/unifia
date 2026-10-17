<!-- SPDX-License-Identifier: MIT -->
# Remote and device control — RC-1 evidence for #574

Reviewed against `origin/dev@c40052c06465f6d4c90b92bad67770121da10858` on 2026-10-15.
This records reachable code paths and the policy asserted in the #574 candidate;
it is not a physical-device qualification or approval to publish.

## Shipped entry points by platform

| Platform | Real entry point | Authority and limits |
| --- | --- | --- |
| Windows desktop | Tauri remote settings in `packages/desktop/src-tauri/src/server.rs` launch the `unifia serve` sidecar, optionally bound to all interfaces | Disabled by default. A generated password and configured Basic username protect LAN access; TLS/fingerprint is optional for Internet mode. Native Workbench IPC requires its own token and, beyond loopback, operator Basic identity (ADR-091). |
| Linux | `unifia serve` / `unifia web` CLI HTTP server from `packages/unifia/src/cli/cmd/` | A non-loopback listener refuses to start without `UNIFIA_SERVER_PASSWORD`. The same HTTP route authority applies; this does not claim an exercised Linux desktop build. |
| Android | Local sidecar via `packages/mobile/src-tauri/src/runtime/server.rs`; remote selection and pairing in `packages/mobile/src/entry.tsx` | Local runtime uses its generated credentials. Remote mode connects to the chosen sidecar URL with Basic credentials; a pairing link may carry a TLS certificate fingerprint. A client can call only the server's authorized API routes. |
| macOS / iOS / Web/PWA | No RC-1 platform qualification | `NOT_IN_RC1` under D5; source code or an unqualified UI entry does not imply support. |

The common shipped surface is the HTTP API under `packages/unifia/src/server/`,
including sessions, terminals, TUI control and git. It is not the separate remote-bridge
library. The HTTP server's central auth middleware authenticates JWT/Basic credentials;
`route-authority.ts` now applies the declared `route-classes.ts` policy *before* these
handlers are reached. The Workbench lease/token bridges retain their own scoped-token
checks and the more restrictive remote owner gate from ADR-091.

## Access boundary

| Authenticated principal | Read metadata/content | Chat and content writes | Terminal, TUI commands, git push, credentials, configuration, administration |
| --- | --- | --- | --- |
| Viewer JWT | Allowed | Denied | Denied |
| Member JWT | Allowed | Allowed | Denied |
| Admin JWT | Allowed | Allowed | Allowed, except owner-only remote Workbench bridges |
| Operator Basic | Allowed | Allowed | Allowed; only this principal is the remote Workbench owner |

Every registered route has one class under `route-classes.ts`, verified by
`test/server/route-registry.test.ts`. Unknown non-GET mutations are denied. Unknown
GET paths continue to the embedded SPA fallback. CORS preflight is handled separately.
The deliberately unauthenticated **loopback-only** CLI mode remains available when no
server password is configured; network listening is rejected in that configuration.
This is a host trust boundary, not a safe multiuser network configuration.

## Explicitly excluded engines

- `@unifia/remote-bridge`: deferred runtime, with no shipped importer or listener;
  its test/release-hardening implementation does not provide Slack or Feishu control.
  The external Feishu support endpoint was intentionally removed (BD-10).
- `@unifia/desktop-runtime`: exportable and composed by the shipped sidecar since
  decision 8B (Computer Use is REQUIRED for RC-1): `desktop-surface.ts` builds the
  Windows broker only when an operator allowlists applications (opt-in), with the
  emergency stop and kill switch; without that configuration `/v1/desktop/*` stays
  fail-closed with 503. Real OS effects remain physically unqualified.

`@unifia/remote-bridge` remains tracked as `deferred-runtime` by
`scripts/package-wiring.json` with `trackingIssue: 574`; its activation still requires
a dedicated runtime contract, platform qualification and security review under #574 /
the later global program #598. Desktop-runtime leaves that manifest because the
composition makes it reachable from a shipped root (see the ADR-1049 amendment).

## Evidence and remaining gates

- On the base SHA, a signed `viewer` bearer POST to `/tui/execute-command` returned
  HTTP 200 even though the route is classified as `execute` (RED reproduction).
- With the #574 change, role-matrix integration tests exercise the real HTTP server:
  viewer/member commands and terminal access are refused, while operator Basic and
  admin bearer keep permitted behavior; a remote peer and passwordless loopback are
  covered. The route inventory test protects additions against an unclassified route.
- `node scripts/check-package-wiring.mjs` confirms the packages' deferred status.
- Android/Windows physical remote pairing, Linux packaged runtime, TLS trust chain and
  external security review have **not** been requalified here; #575 and RC-1 release
  gates remain separate. No release assertion follows from this source-level proof.
