<!-- SPDX-License-Identifier: MIT -->
# RC-0 control inventory and behavioral review

RB05 is incomplete. This manifest is a structural starting point for the
journey truth table, not proof that every candidate is visible or functional.

## Reproduce the source manifest

From `packages/app`:

```sh
bun run scripts/parity/control-census-run.ts > /path/to/control-census.json
bun test ./scripts/parity/control-census.test.ts
```

The runner enumerates tracked `packages/app/src` TS/TSX files before reading.
It declares test/spec/story/declaration exclusions, then parses every remaining
file with the TypeScript AST. Syntax/read failures abort. The output records
HEAD, source dirty state, each file hash, byte count, candidates, line numbers,
attribute expressions and spreads. It writes only stdout.

Baseline `223d200d30e966f017b1bdcbf8b3396a1806ad65`: 797 tracked TS/TSX files,
254 excluded, 543 parsed, 6,846,477 bytes, 3,070 structural candidates. Custom
wrappers, including lowercase namespace components, are deliberately included.
This is 543/543 structural coverage, **not 543/543 behavioral source review**.
The first local baseline was dirty because the draft test initially lived in
`src`; the hook required moving it into the harness. Re-run on the committed
SHA before freezing an artifact. Generated artifacts
remain outside the source tree. No candidate is automatically classified REAL.

## Work cockpit: first source findings

Full reads: `work-cockpit.tsx`, `work-surface.tsx`, `work-team.ts`,
`work-inspector-cards.ts` and their focused tests. Team context and transition
policy were traced for the readiness change; that does not audit all Team APIs.

| Control | Current source behavior | RC action |
| --- | --- | --- |
| Auto-safe selector | Soon: aria-disabled, no handler | Scope/implementation decision required |
| Plan AI | Soon: aria-disabled, no handler | Scope/implementation decision required |
| Undo | Soon: aria-disabled, no handler | FX01 remains open |
| New task | Calls Team dialog opener | Existing dialog browser proof; verify task/run semantics |
| Plan row Run | Soon: aria-disabled, no handler | FX01 remains open |
| Policy | Soon: aria-disabled, no handler | FX01 remains open |
| Next action Inspect | Opens execution inspector | Verify selected run and live facts |
| Next action Run | Soon: aria-disabled, no handler | FX01 remains open |
| Approval Inspect | Opens execution inspector | Verify selected gate and live facts |
| Approve | Soon: aria-disabled, no handler | FX01 remains open |
| Generate update | Soon: aria-disabled, no handler | FX01 remains open |

PR #181 corrects the shared next-action derivation: pending task, open run and
completed dependencies. Its 27 focused tests prove the derivation and inspector
model, not a real Team run or browser journey. The cockpit's constant zero-agent
count and "No agent registered" fallback lack roster authority and need review.

## Remaining coverage

All emitted candidates remain UNREVIEWED until contract, implementation,
transport, shipped consumer and journey evidence support a disposition.
Shared UI internals and desktop/mobile shells are outside this first manifest;
they must be added to the behavioral audit. Dynamic rendering, visibility,
authorization, persistence and keyboard/pointer behavior need direct tracing
and runtime checks. RB05, RB07, FX00 and FX01 cannot close from this census.
