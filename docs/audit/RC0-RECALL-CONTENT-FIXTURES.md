<!-- SPDX-License-Identifier: MIT -->
# RC-0 recall-content fixture qualification

## Root cause

Windows job 110519828305 on #191 fails the next-turn cache content assertion.
The two calls take 2968ms and the second returns undefined. They use the default
1500ms retrieval deadline, while content/count fixtures already explicitly allow
30000ms. The router bounds source.list and degrades an expired search to no pack;
the prompt consumer then returns undefined as designed.

Injecting a 1750ms delay before the real VaultSource.list deterministically
reproduces this mismatch: unchanged next-turn test 0 passed, 1 failed, exit 1,
3052.78ms test duration. This separates timing from the cache content contract.

## Correction

Apply the existing test-only content deadline to the remaining positive content,
remote opt-in and cache assertions. Production code and its deadline stay unchanged.
Keep disabled, absent, denied and explicit deadline cases on their original paths.
The dedicated default-deadline witness still asserts 1500ms and verifies a slow
source degrades before completion.

## Proof

- Same delayed real-source witness: 1 passed, 2 assertions, exit 0, 3568.53ms.
- Complete package fixture suite: 15 passed, 29 assertions, 4.19s; the default
  deadline test passes in 1779.63ms and retains all four assertions.
- Same-pattern review covers every positive content assertion in this file.
  Separate production performance, real Windows disk latency, CI and device
  qualification are not established by these fixture tests.

Baseline, corrected and original Windows logs remain in rc0-agent/.build-temp.
This lot does not repair or qualify the full browser suite or QA12R.
