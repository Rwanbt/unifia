<!-- SPDX-License-Identifier: MIT -->

# RC-0 Voice JWT CodeQL trace

Date: 2026-10-01. Reviewed source: dev bdeb12814a.
Alert #555 targets `js/insufficient-password-hash` at
`packages/unifia/src/server/routes/voice-live.ts:95`.

## Rule-specific disposition

The expression signs a JWT using HMAC-SHA256. It does not derive or store a
user password hash. A password KDF here would change the LiveKit wire signature
and break verification. Recommended disposition for this specific rule:
false positive, with this trace as its justification. No query exclusion,
suppression or production cryptography change is introduced.

LiveKit's [token contract](https://docs.livekit.io/home/server/generating-tokens)
requires JWT access tokens signed with the API secret. Its
[reference implementation](https://docs.livekit.io/reference/python/livekit/api/access_token.html)
uses HS256. These sources were checked on 2026-10-01.

## Source to consumer

1. `packages/desktop/src-tauri/src/voice_live.rs`, LiveKitCredentials::generate:
   a per-start secret combines two UUID-v4 values and is zeroized on Drop;
   this is not a user-selected password. `publish_state` writes it into the
   supervisor state file used by the sidecar.
2. `readVoiceHostState` validates the state is ready and the secret is at least
   32 characters. The session route passes only that internal secret to
   `mintLiveKitToken`.
3. The signer emits HS256, issuer/identity, room-scoped grants, microphone-only
   publishing, no data publishing, ten-minute initial access and opaque IDs.
4. The route returns URL, scoped token, expiry and binding, not the API secret.
   It is mounted after JwtAuth middleware and refuses the collaborative viewer
   role. Passwordless loopback deployment policy is separate from this rule.
5. `packages/app/src/voice/livekit-room.ts` passes the scoped grant token to
   `Room.connect(grant.url, grant.token)`. Client rendering does not receive the
   signing secret.

## Evidence and limits

From packages/unifia, `bun test test/server/voice-live-routes.test.ts`:
10 pass, 0 fail, 45 assertions, 2.15s. Tests verify the HMAC, issuer, bounded
grant, absence of secret disclosure, viewer refusal, rate limit, expired binding
and host-state validation. Log: rc0-agent/.build-temp/
rc0-voice-signature-trace-20261001.log.

This qualifies the signing-rule diagnosis, not a physical Voice session or
the whole credential lifecycle. The Rust private writer specifies 0600 on
Unix; Windows ACL and filesystem-race qualification remain separate findings.
The GitHub alert API returned a null state at inspection despite a dev
instance, so no remote dismissal is claimed or applied.
