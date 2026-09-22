<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-041 — Web Workbench bridge, gated by server authentication

- Status: accepted (owner decision 2026-09-22)
- Date: 2026-09-22
- Related: ADR-1041, ADR-1042, ADR-040

## Context

The Workbench surfaces (Work, Design, Automate, Memory) need a scoped lease
(Secret C in ADR-1042) minted by the sidecar's Workbench server. Until now the
only way to obtain one was `POST /workbench/native/token`, authenticated by the
desktop keychain IPC bearer (Secret A), which by design never enters a WebView.
A browser (web runtime) therefore had no `platform.workbench` and every
Workbench surface showed "Disponible dans l'application desktop". The owner
asked for the web runtime to work too.

## Decision

1. The sidecar exposes `POST /workbench-web/token` (actions `open`, `issue`,
   `rotate`, `revoke`, same body as the native route). The path is outside
   `/workbench/*`, so the server's normal authentication middleware applies to
   it (JWT Bearer or Basic with `UNIFIA_SERVER_PASSWORD`). A lease carries
   write capabilities, so the route also refuses the read-only collaborative
   role `viewer` (403); Basic auth counts as admin. This is enforced on the
   route itself because `RBAC.can()` is not applied anywhere else yet.
2. The Workbench bridge, and therefore this route, exists only when
   `UNIFIA_SERVER_PASSWORD` is set. Without a password the middleware lets any
   local caller through, so minting leases would be unauthenticated; the route
   answers 404 instead and the web runtime keeps its fail-closed banner.
3. The keychain IPC bearer is no longer required to build the bridge: it only
   gates the native route, which answers 404 when it is absent. The two routes
   share one token-action implementation; the web route mints for the distinct
   principal `unifia-web-workbench`, so the audit trail separates the callers.
4. The signing key never leaves the sidecar. Like the desktop path, the
   browser receives the scoped lease only.
5. The Workbench server's origin allowlist (Tauri-only by default, FUNC-002)
   is extended by the sidecar with `http://localhost:*` and
   `http://127.0.0.1:*`, the same loopback rule as the sidecar's own CORS
   policy. A `:*` entry matches that exact scheme and host on a numeric port
   only (`security.ts`); every Workbench route still requires a lease.
6. The app provides a web `platform.workbench` adapter that calls the route
   with the same credentials as its SDK (Basic from the selected server,
   overridden by the collaborative JWT when present). In a Vite dev build,
   `VITE_OPENCODE_SERVER_USERNAME` / `VITE_OPENCODE_SERVER_PASSWORD` seed the
   default server's credentials; production builds never read them.

## Rejected alternatives

- Exposing the IPC bearer to the browser: breaks ADR-1042 (Secret A must not
  enter a WebView).
- A dev-only switch: the owner wants the web runtime to work, not only tests.
- Minting without a password: any process on the machine could obtain leases.

## Consequences

- Anyone holding the server credentials can obtain a Workbench lease. They can
  already drive the whole server API (sessions, shell), and the lease stays
  capability-scoped by workbench-server's allowlist, so no authority is added.
- Revocation is per workspace (`revokeNativeScopedToken`): if the desktop and a
  browser open the same workspace, revoking from one ends the other's lease.
- Running the web app now requires a password-protected sidecar to use the
  Workbench surfaces; without one they keep showing the desktop-only banner.
