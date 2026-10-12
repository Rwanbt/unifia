<!-- SPDX-License-Identifier: MIT -->
# RC-0 Start Run modal qualification

## New evidence after the stopped diagnosis

The three earlier failures remain in RC0-START-RUN-E2E-DIAGNOSIS.md.
New browser hit-testing measures the Runs button at x94/y464, 180x30:
sidebar aria-expanded=false, pointer reaches the central workspace.
Ctrl+B pins the sidebar; the button becomes x102/y464, 210x30 and the
pointer reaches its Runs label. A real click changes the Work view.
No layout patch, forced click or DOM click is needed.

The next real journey reaches the dialog but cannot select an agent.
The measurement observes 14 DOM options receiving pointers, zero accessible
options, and an aria-hidden=true ancestor on the body portal. The parent
modal hides this non-modal Select portal. Kobalte 0.13.11 defaults Select
modal to false; both consumers use the same pinned version.

## Correction and proofs

The four form Selects use Kobalte's documented modal mode. The same witness
then observes 14 accessible options and no hidden ancestor. Production change
is scoped to this form. No shared Select or dialog policy changes.

The journey seeds the isolated backend, pins the context panel, checks exactly
one visible Runs control, and retains real Team HTTP/SQLite. Each of the four
Selects opens with Enter, exposes accessible options, closes with Escape and
restores trigger focus. Agent build is selected by accessible name.

The route returns HTTP202 after creating the run, before the asynchronous
runner persists tasks. The first immediate-task assertion failed with an empty
list; the corrected test polls exact task IDs within the existing expect budget.
Two real journeys pass in 27.3s and 29.0s, including HTTP202, returned run ID
visible in Runs and persisted t1. Fourteen form unit tests/assertions and App
typecheck pass. The unused native-only fixture detector is removed after a
repository-wide caller search; the separate real web-denial contract remains.

## Remaining boundary

Some redirected Windows commands remain open after the browser result.
A phase witness reports runner-exit:0, cleanup-start and cleanup-complete;
process inventory then finds only the calling pwsh and its conhost child.
This does not establish a Bun lifecycle failure. Interrupted command exit1
is retained. The same journey without PowerShell file redirection passes in
28.2s, reports runner-exit:0 and cleanup-complete, and exits normally with 0.
Raw rc0-start-run-* and rc0-agent-select-* observations remain in rc0-agent/.build-temp.
Full CI, native transport, physical tests and QA12R are not qualified here.
After reconciling dev4dc518bf3b, the unchanged one-worker/no-retry journey
passes again in 41.0s and the complete command exits with 0.

Kobalte contract: https://kobalte.dev/docs/core/components/select/
