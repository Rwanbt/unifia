<!-- SPDX-License-Identifier: MIT -->
# RC-0 shell witness portability

Date: 2026-10-03. Baseline: dev `9f69f9c670`.

## Reproduction and root cause

On this Windows host, SHELL selects Windows PowerShell. The unchanged
HTTP permission witness runs printf, then expects a marker. The selected
shell has no printf: native Node spawn reports CommandNotFoundException,
status 1. The same Process helper executes Write-Output rc0 successfully
(status 0, stdout rc0).

cross-spawn/lib/enoent.js:verifyENOENT turns an unresolved command exiting
with status 1 into ENOENT on Windows. That explains the misleading
spawn printf ENOENT; interpreter launch is not the demonstrated fault.
The initial suite had 14 pass/1 fail/58 assertions; the allow marker was
absent, while deny returned HTTP 403 and all 10 Voice JWT tests passed.

## Correction and matching fixtures

A shared test-only witness uses Set-Content for PowerShell/pwsh, echo for
cmd, and printf with a normalized, quoted path for POSIX shells. Both the
HTTP witness and the service permission suite consume it. Authorization,
transport and production process code are unchanged.

The service suite was 1519 lines. Its command configuration, permission
poll and witness helpers were extracted before editing the affected tests;
the file is now 1499 lines. Further splitting the service suite remains
appropriate because it exceeds the 800-line maintenance threshold.

Search: `rg -n 'printf rc0-harmless|shellArgs|shellCommand' packages/unifia/test`.
The partial-execution test now uses the same valid first command, so a
broken first directive cannot accidentally prove no partial execution.

## Proof

From packages/unifia, Bun 1.3.14, selected Windows PowerShell:

- command-template + prompt-effect + HTTP witness: 41 pass, 0 fail,
  147 assertions, 117.52 s. Covers deny, allow, later-denied/no partial
  execution, persisted ask/reject, ask/once and the real Hono 403 boundary.
- witness generation + command-template + HTTP witness: 8 pass,
  17 assertions, 11.38 s. Includes three shell/quoting cases.
- package typecheck: exit 0.
- temporary repository Biome rules applied to all four touched tests:
  exit 0; ten unused-parameter warnings in untouched service-test callbacks
  remain pre-existing. No lint-clean claim for that entire legacy suite.

This is software qualification, not a physical Windows application test.
Linux and Windows CI must still qualify the exact PR head before merge.
