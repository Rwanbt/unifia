<!-- SPDX-License-Identifier: MIT -->

# RC-0 Start Run browser diagnosis

Date: 2026-10-01. Base: dev b264598b4b; no physical qualification.

## Three attempts, then stop

1. Unchanged `work-start-run.spec.ts` fails waiting for
   `data-workbench-connection=unsupported`. Its bridge detector only checks
   injected native/mock bridges and overlooks the shipped web adapter
   (ADR-041). It returns before submitting any Team run, so the previous
   scenario did not qualify its advertised POST 202 journey.
2. A local candidate installs the existing Workbench availability mock while
   retaining real Team HTTP/SQLite and model selection. Opening the Runs
   destination fails strict-mode selection: desktop and mobile sidebars both
   render `data-work-view=runs`. The contract must require exactly one visible
   interactive control, rather than choose the first DOM match.
3. The visible-control candidate then fails a real pointer click because the
   editor overlay (`absolute ... z-20`, with the Project update card) intercepts
   the sidebar control. No force click, DOM click or extra retry was applied.

The candidate has not reached submission and is not qualified. Its patch is
retained locally, not published as a passing fix. Logs are in
rc0-agent/.build-temp: `rc0-other-bridge-baseline-20261001.log`,
`rc0-start-run-corrected-20261001.log`, and
`rc0-start-run-visible-rail-20261001.log`. Baseline and hidden-rail screenshots,
videos and page snapshots are archived in corresponding results directories.
The local harness also remains open after some browser failure summaries;
only these task-owned exec sessions were interrupted. This is a separate
shutdown finding, not a successful process exit.

## Next measured paths

- Measure sidebar and editor bounding boxes, computed stacking contexts and
  `elementFromPoint()` at the Runs button center. Trace the actual desktop
  breakpoint and rail/sidebar collapsed state before changing shell layout.
- Exercise Runs through the intended expanded sidebar state and real pointer
  click; retain exact visible cardinality and POST 202 / persisted task / new
  run-ID assertions. Do not bypass hit testing.
- Investigate the isolated harness shutdown separately: phase witnesses for
  runner exit, server stop, instance disposal and sandbox removal identify the
  pending resource before any lifecycle fix.

## Adjacent Design finding

The unchanged Design terminal-state test also fails: DesignSurface no longer
renders ConnectionBanner after its canvas/shared-session migration. This is
different from the web adapter's intentional HTTP 404 refusal. The 932-line
surface and its connection-dependent export guards need a separate scoped
extraction and browser qualification; the missing banner was not hidden by
deleting its assertion. Other responsive/selectors in the same spec are stale
and remain unqualified.
