<!-- SPDX-License-Identifier: MIT -->
# RC-0 provider response bounds qualification

Qualified after dependency lot #188 merged on dev `3abfd1a342f81e34572714a9720e76fcbdf0ac01`.

## Cause and correction

Provider-utils 4.0.21 reads success, JSON-error and status-error response bodies
without bounding them first. [Upstream advisory](https://github.com/advisories/GHSA-866g-f22w-33x8)
fixes this from 4.0.33. The dependency graph already contains 4.0.41 and 4.0.56;
pinning all consumers to 4.0.56 avoids downgrading either branch.

Provider 3.0.18 aligns the nominal API error types already used by 4.0.56.
The old 4.0.21 patch only enables inline data URLs, now supported upstream;
it is removed after verifying inline decoding and explicit download limits.
The default response limit remains 2 GiB; this change does not reduce that budget.

## Measured evidence

- Finite-stream witness on 4.0.21: 3 passed, 4 failed, 10 assertions, 2.23s.
  Three handlers accept an oversized declared body; trailing-dot localhost is accepted.
- Same witness on 4.0.56: 7 passed, 0 failed, 14 assertions, 2.16s.
  Repeated after reconciling dev and a frozen force install: 7 passed,
  0 failed, 14 assertions, 19.15s; package typecheck also passed.
  Oversized bodies reject and cancel their streams; ordinary bodies remain accepted.
  Inline data downloads retain their explicit size bound; private/file URLs reject.
- Package `bun run typecheck` passes after `bun install --force --frozen-lockfile`.
  An earlier root `bun --cwd ... run typecheck` printed help and is not evidence.
  A normal install left stale nested nominal types; the frozen force install repaired it.
- Root `bun turbo typecheck --concurrency=1`: 47/47 passed, 44 cached, 6.454s.
- Package `bun test ./test/provider`: 333 passed, 3 failed, 691 assertions, 38.49s.
  All three failures reproduce on unchanged dependency lot c66d129b6a:
  0 passed, 3 failed, 3 assertions, 2.58s with the same test-name filter.
  Two small-model cases load a local Qwen model; one custom provider case sees
  a local loopback base URL. These are confirmed pre-existing local failures.
- `bun audit --json` retains exit 1 with three findings: AWS SDK low and two
  React Router moderate. No critical/high or provider-utils finding remains.

Lockfile package entries resolve one provider-utils 4.0.56 and provider 3.0.18.
Old version strings retained in upstream dependency declarations are metadata,
not resolved package copies. Logs are preserved under
`rc0-agent/.build-temp/rc0-provider-*20261001*`.

PR #192 merged on dev `c65792845d569ff3dab6ca72d48077a86cd4d5ff` after seven
required checks and CodeQL passed. Linux job 110529789678 confirms all seven
response-bound tests pass; Windows also passed (32m19s).
Native Node download transport, packaging and physical qualification remain
unproven. These results do not close QA12R or the remaining audit findings.
