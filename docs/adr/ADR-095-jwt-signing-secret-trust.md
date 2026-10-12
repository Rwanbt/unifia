<!-- SPDX-License-Identifier: MIT -->
# ADR-095 — The token-signing secret comes from the operator's channel, never from a configuration file

Status: **Accepted** for the server. The desktop's secret store is a follow-up (see *Not yet*).
Date: 2026-10-12

## Context

Access tokens (15 minutes) and WebSocket tickets (60 seconds) are HMAC-SHA256 JWTs. Whoever holds the signing secret can mint a token with any role, including `admin`, and the server accepts it. The owner's basic credential is not needed.

Before this change the secret was read from `experimental.collaborative.jwt_secret` in the user's global configuration. That file is writable by every process of the same user, including the shell the agent's commands run in. A process that wrote a secret there, and then made the server start, could sign an administrator's token. Reproduced on `origin/dev`: with the secret written to the global configuration, a forged `admin` token got HTTP 200 on the session route, with no password. The same request was refused after the change.

## Decision

1. **The configured secret is `UNIFIA_JWT_SECRET`, on the operator's channel.** It is held like the other server credentials (ADR-094): withheld from the environment at start, and read from memory. A headless operator sets it in the environment of the start, and the start withholds it. A desktop start may send it on the credential line; no desktop path does so yet.
2. **A secret in a configuration file is not read.** The server logs a warning naming the key, once, without the value. The file is left as it is: nothing is deleted.
3. **A secret shorter than 32 characters stops the start**, with no value in the message. A short key is guessable offline.
4. **Without a configured secret the process generates one at start**, held in memory, and never changed while it runs. Its tokens do not survive a restart, and two processes do not accept each other's tokens. Several instances need the same `UNIFIA_JWT_SECRET`.
5. **Expiry is enforced on every verification**, and a WebSocket ticket never authenticates an HTTP request: the ticket carries `kind: "ws-ticket"`, and the access check refuses it. Both are as #490 left them.

## Not yet (and why it is stated, not hidden)

- **Revocation of access tokens.** An access token is valid until it expires (15 minutes). Refresh tokens are rotated and revocable; access tokens are not revoked before expiry. A deleted user keeps the access token until it expires. This is accepted for the lifetime, and listed as a residual.
- **The desktop's secret store.** The desktop does not yet provide the secret from the operating system's secret store, so the desktop process generates its own. Its tokens do not survive a restart. Providing the secret from the store is the next step of the desktop work (ADR to follow), on the same channel as the other credentials. No second secret store is introduced here.
- **The process's own memory.** A process of the same user that can read the server's memory can obtain the secret. ADR-094 states the boundary for the credentials; it applies here unchanged.
- **Legacy query-string authentication for WebSocket upgrades** (`?authorization=Bearer …`) is not part of this decision: it was removed separately (#514), so the server reads no credential from a URL.

## Tests

`packages/unifia/test/server/jwt-secret.test.ts`, each case in a child process that is a real restart:

- a secret given on the operator's channel is applied at start: a ticket issued before is refused after the start, and a new one verifies;
- a restarted process accepts the tickets of the one before when the operator's secret is the same;
- a secret written to the user's global configuration is **not** read: a restarted process refuses a ticket signed with it. On `origin/dev` this case fails;
- a secret in the project's own configuration does not choose the process secret;
- a secret shorter than 32 characters stops the start.

The forgery itself was replayed against the real server: `origin/dev` answers 200 to the forged `admin` token, this branch answers 401.
