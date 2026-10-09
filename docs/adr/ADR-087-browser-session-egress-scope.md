<!-- SPDX-License-Identifier: MIT -->
# ADR-087: Browser session egress scope

**Date**: 2026-09-28 | **Status**: Accepted

## Context

The Browser runtime already routes HTTP and HTTPS through Network Authority, which resolves destinations, denies non-public addresses, and pins the approved IP. A process-wide `allowedOrigins: ["*"]` still let an AI-controlled page reach any public origin without a session-level grant. Established HTTPS CONNECT tunnels also outlived Browser controller changes.

## Decision

- Keep the configured egress policy for manual user control. The desktop profile permits public HTTP(S) browsing while Network Authority rejects private, loopback, link-local, and metadata destinations.
- Under AI control, intersect that policy with origins visited or explicitly approved in the Browser session. A new top-level origin requires the existing approval flow before it enters the session grant set.
- Under paused control, deny all origins.
- Resolve the policy dynamically at each proxy request. Revoke all established proxy sockets whenever control changes so an existing CONNECT tunnel cannot outlive the new policy.
- Keep DNS resolution, public-address validation, and IP pinning in Network Authority for every newly opened connection.
- Record Network Authority denials in the session Activity stream using only the denial code; never add the requested URL to this event.

## Alternatives rejected

- Keep one wildcard policy for user and AI control: this leaves public cross-origin fetches available to untrusted page content while the agent controls the session.
- Recreate the Browser context on every controller transition: this would discard page and form state when the user takes over.

## Consequences

- Manual browsing remains unrestricted to public HTTP(S) origins within the configured policy.
- AI-controlled pages can use origins visited or approved in that session. Third-party resources from origins outside that set fail closed and may make some sites partially render.
- Paused Browser sessions stop existing network tunnels as well as new connections.
- `browserEgressPolicyForController`, `PlaywrightSessionPages`, and `BrowserEgressProxy` implement the decision; policy, tunnel revocation, and redacted Activity behavior have focused unit coverage.
