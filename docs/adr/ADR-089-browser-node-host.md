<!-- SPDX-License-Identifier: MIT -->
# ADR-089: Run the Browser runtime in a Node host process

**Date**: 2026-10-05 | **Status**: Accepted (owner decision D1-A, 2026-10-05)

## Context

The Browser runtime (#118) drives Chromium with Playwright. The Unifia server and the desktop sidecar run on Bun. Under Bun on Windows, Playwright never settles: `chromium.launch()` and `connectOverCDP()` both hang, while `launch()` takes 71 ms under Node. Bun's native WebSocket gets an immediate CDP reply from the same Chromium (#279). Upstream closed the matching report as "not planned" (oven-sh/bun#10120). Claude Code and Codex have the same arrangement: their Playwright browser tools (`@playwright/mcp`) run as a separate Node process, never inside the agent's runtime.

## Decision

1. **The whole Browser authority runs in a Node child process**: `BrowserSessionService`, `PlaywrightSessionPages`, the egress proxy and the download store. The Bun server talks to it through the existing `BrowserSessionManager` contract. Cutting at the page port instead was rejected: its popup handler must answer synchronously and `downloads()` is read synchronously, which cannot cross a process boundary.
2. **Protocol**: newline-delimited JSON over the child's stdin/stdout, which Bun supports.
   - Requests `{id, method, params}` → `{id, result}` or `{id, error: {name, message}}`.
   - Host events `{event, ...}`: session snapshots, activity, downloads, storage saves.
   - Host-to-server requests: `{id, request: "approve", reason}`, used for sensitive-action approval, are answered by the server.
   - Byte payloads (screenshots, uploads) travel as base64. stderr is diagnostics only.
3. **Bun keeps the synchronous reads local.** `get`, `forChatSession`, `downloads` and `activity` are served from a mirror that host events keep current. `create` becomes asynchronous in the contract; it has a single call site.
4. **Persistence stays on the Bun side.** The encrypted SQLite store (`bun:sqlite`) receives session and storage-state events, and on start it seeds the host with the persisted sessions and their storage. The host never opens the database.
5. **Lifecycle.** The host is started lazily on first use. If it exits unexpectedly, every in-flight request rejects with a typed error, the mirror marks sessions as `error`, and the next call starts a new host. It stops with the server.
6. **Which Node.** Development uses `UNIFIA_NODE_PATH` or `node` on `PATH`. The desktop ships a pinned official Node LTS binary next to the sidecar, verified by SHA-256 like the LiveKit download, plus the host bundled as one file. Android is out of scope (D7-B, WebView adapter).

## Alternatives rejected

- **CDP client on Bun's native WebSocket**: no new runtime, but it means rewriting the 767-line adapter and its guards.
- **Pinning a Bun version**: no compatible version is known, and upstream will not fix it.
- **Driving the user's own Chrome through an extension**: no isolation, which contradicts ADR-013.

## Consequences

- The desktop installer grows by the size of one Node binary.
- The Browser runtime e2e must also run with the server on Bun (acceptance of #279), so this cannot regress unseen again.
- A host crash loses live pages but not persisted sessions or storage.
