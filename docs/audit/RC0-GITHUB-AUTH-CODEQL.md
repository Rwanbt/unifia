<!-- SPDX-License-Identifier: MIT -->
# RC-0 GitHub OAuth storage CodeQL disposition

Alert493: js/http-to-file-access, packages/unifia/src/github/auth.ts:112,
open in the dev inventory read on2026-10-03. Source reviewed atc8af8709db.

## Contract and flow

GitHub Device Flow returns an OAuth credential that the connection service
must persist. The HTTP response controls session content: login, public
identity, tokens, scopes and expiration. It does not control the destination.
The destination is Global.Path.data plus the literal github-auth.json;
the plaintext temporary name adds only process.pid and crypto.randomUUID.
writePlain creates it with wx/mode0600, then renames it to the fixed file.
The encrypted backend likewise uses a fixed github-auth.enc.json path.

pollDeviceFlow is called by the real GitHub HTTP route and Workbench
github.devicePoll adapter. Its success result contains the public identity.
getIdentity returns login/name/avatarUrl/profileUrl only. getAccessToken is
internal to the Git credential bridge and live connection probe. The latter
returns capabilities, not the token. The credential bridge intentionally
passes an authenticated extraheader scoped to https://github.com/.

The proposed disposition is a rule-specific false positive for remote path
selection, not removal of stored credentials or universal auth qualification.
No alert has been dismissed, no suppression added, and production storage
behavior is unchanged.

## Proof

From packages/unifia, bun test test/github/auth.test.ts
test/github/credentials.test.ts:18 pass/0 fail/38 assertions,6.15s.

The new real-filesystem witness supplies traversal-looking login and token
fields via stubbed Device Flow HTTP Responses. After the actual service
poll, the only newly created data-directory entry is github-auth.json;
reading it returns the supplied fields as JSON content. The success result
and public getIdentity projection omit the token. Existing tests prove
pending/slow_down/expiry/denial/cancel, storage reload, stale temporary-file
isolation, Git host scoping and manual credential precedence.

Log:rc0-agent/.build-temp/rc0-github-auth-codeql-20261003.log.
Repository search traced the writer and public/internal consumers; it does
not classify generic Filesystem sinks or Log as safe.

## Limits

Responses are stubbed, not live GitHub OAuth. POSIX0600 evidence is not
claimed on Windows; the existing mode assertion runs only on POSIX.
This does not qualify malicious local directory/symlink replacement, native
keychain availability, encrypted-file behavior, or identity-schema validation.
Plaintext storage and the documented mobile Git-config credential trade-off
remain separate security concerns. Exact-head CI and a reviewed rule-specific
disposition remain required; QA04 and QA12R are not globally green.
