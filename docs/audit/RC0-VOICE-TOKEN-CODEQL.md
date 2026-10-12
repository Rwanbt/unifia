<!-- SPDX-License-Identifier: MIT -->
# RC-0 LiveKit room token: CodeQL 555 disposition

Alert 555: `js/insufficient-password-hash` (security_severity_level `high`,
CWE-916) at `packages/unifia/src/server/routes/voice-live.ts:95`, open in the
`dev` inventory read on 2026-10-03. Source reviewed at `a77f47773ea`.

The alert text is `Password from an access to apiKey is hashed insecurely`,
repeated for each taint path. Read against the source, the flow is not a
password hash, and the value the rule calls a password is not even the key.

## What the code does

`mintLiveKitToken` builds a LiveKit access token: a JWT whose header declares
`{ alg: "HS256", typ: "JWT" }`, whose claims carry `iss`, `sub`, `nbf`, `exp`,
`video` and `roomConfig`, and whose signature is
`createHmac("sha256", input.apiSecret)` over `header.body`. The function's own
doc comment states the format: "HS256 LiveKit access token (the format LiveKit
servers verify)".

The two credentials are distinct values, passed separately at the only call site
(`voice-live.ts:220`):

- `apiSecret` is the HMAC **key**.
- `apiKey` is placed in the `iss` claim, i.e. it is **signed data**, never a key.
  LiveKit's API key is a public identifier, not a secret.

## Why the rule does not apply

`js/insufficient-password-hash` exists to catch a stored credential protected by
a fast, unsalted digest that an attacker can crack offline if the digest leaks.
Its recommendation is bcrypt/scrypt/PBKDF2/Argon2. None of that applies here:

- Nothing is stored. `apiSecret` is read from the Voice Host state file and used
  to sign; it is never persisted as a digest by this code path.
- The construction is a **keyed MAC**, not a digest. A MAC's security does not
  come from being slow, so a password KDF would not be an improvement; HMAC-SHA256
  is what the verifier on the other side requires.
- The rule's own taint premise is wrong here: it flags `apiKey`, which is not
  hashed at all and is not the key.

## Proof

From `packages/unifia`, on this branch:

```
bun test test/server/voice-live-routes.test.ts
 11 pass
 0 fail
 53 expect() calls
Ran 11 tests across 1 file. [2.26s]
exit 0
```

The new test, "the room token is a keyed HS256 MAC over its claims, not a stored
password hash", pins the four properties the disposition rests on, each of which
a regression would break:

1. The header declares `HS256` and never `alg: none`.
2. The MAC reproduces only under the exact secret: a one-character suffix or
   removal yields a different signature. This is the property that separates a
   MAC from an unsalted digest.
3. The secret never appears in the token, and the public `apiKey` appears only as
   the encoded `iss` claim.
4. Editing any claim invalidates the signature, so the claims are covered by the
   MAC rather than merely transported.

Log: `rc0-agent/.build-temp/rc0-voice-token-hmac-20261003.log`.

## Limits

This is a rule-specific disposition, not a suppression: no alert was dismissed,
no `paths-ignore` entry and no scanner exclusion was added, and no production
behaviour changed. It does not qualify the Voice Host key provisioning or
rotation, LiveKit server-side verification, the encrypted-file backend, the
`insufficient-password-hash` alerts that do not exist elsewhere in the inventory,
or any security-clean / QA12R status. The other 21 open `dev` alerts are
unaddressed by this lot.
