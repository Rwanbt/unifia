<!-- SPDX-License-Identifier: MIT -->
# RC-0 dependency security measurement

Measured 2026-10-01 against dev `139f8e37a3c1dabb229972814df517b290eb1416`.
The default-branch Dependabot count does not qualify this lockfile.

## Baseline and targeted corrections

`bun audit --json` returned 25 advisories: 14 high, 8 moderate, 3 low.
The historical four-advisory handoff was stale.

| Dependency | Baseline | Corrected | Consumer and evidence |
| --- | --- | --- | --- |
| axios | 1.19.0 | 1.20.0 | Slack transport, outside the shipped roots; 12 advisories removed. [Upstream advisory](https://github.com/advisories/GHSA-m8m8-qj5v-23w3). |
| brace-expansion | 5.0.9 | 5.0.12 | minimatch, including the CLI and packaging; three advisories removed. Existing minimatch override already resolves this major. [Upstream advisory](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr). |
| DOMPurify | 3.4.13 | 3.4.16 | UI Markdown sanitizer and documentation; one advisory removed. Both direct manifests and root override agree. Current sanitizer does not use IN_PLACE; no shipped exploit claimed. [Upstream advisory](https://github.com/advisories/GHSA-p98j-92pf-mc4p). |
| Electron | 42.5.1 | 42.10.0 | Shipped Electron root; five advisories removed within the same release series. [Upstream advisory](https://github.com/advisories/GHSA-qmv3-fv6v-rmhq). |

All four exact versions were verified in the npm registry before installation.
The lockfile changes only these four package entries, their manifests and overrides.
`bun install --frozen-lockfile` succeeds without changing the lockfile.

## Corrected audit

`bun audit --json` still exits 1: four advisories remain, no critical or high.

- `@ai-sdk/provider-utils`: one low, shipped runtime, separately patched dependency requiring patch requalification.
- `aws-sdk`: one low, SST deployment tooling, outside shipped roots.
- `react-router`: two moderate, console-mail build tooling, outside shipped roots; root pins major 6 while the advisory fixes major 7.

These remaining advisories are open findings, not an approved deferral.
RB06 license qualification and QA12R remain open.

## Validation

- UI `bun run test:ci`: 162 passed, 0 failed, 473 assertions, 16 files, 1.138s.
- Electron `bun test`: 19 passed, 0 failed, 50 assertions, four files, 141ms; `bun run typecheck` passed.
- App `bun run test:ci`: 2106 passed, one existing live skip, 0 failed, 151445 assertions, 252 files, 7.88s.
- Root `bun turbo typecheck --concurrency=1`: 47/47 passed, zero cached, 53.458s.
- CLI glob, wildcard and permission tests: 99 passed, 0 failed, 155 assertions, three files, 11.67s.
- Exact old-version search finds no other manifests for these packages; an unrelated PlanetScale version 1.19.0 is unchanged.

Logs and audit JSON are preserved under `rc0-agent/.build-temp/rc0-dependenc*20261001*`.
No packaging, signing, publishing or physical qualification was performed.
