<!-- SPDX-License-Identifier: MIT -->
# RC-0 complete browser baseline, 2026-10-03

## Fixed source and environment

Source SHA: `9f69f9c670d958a6443452c53fb5ffb632dbb29a`, detached in a
normal temporary clone. The primary checkout was not used to execute tests.
Node modules were linked to the installed Windows dependencies at this source
SHA; no ghostty stub, source copy or browser alias was substituted.
Bun 1.3.14, Windows Chromium, two workers, zero retries. Terminal specs were
enabled and LSP was not disabled. Other targeted work ran concurrently on the
host, so elapsed time and latency assertions are not isolated benchmarks.

```text
cd packages/app
PLAYWRIGHT_WORKERS=2 PLAYWRIGHT_RETRIES=0 PLAYWRIGHT_JUNIT_OUTPUT=<absolute output>
bun run test:e2e:local
```

Runner result: **203 passed, 98 failed, 7 skipped, 4 did not run, 312 total;
53.5 minutes**. JUnit encodes the seven skipped plus four not-run as eleven
skips. Counts are not added across retries (none). Source stayed frozen during
the run. This replaces the invalid worktree suite as the functional baseline.
It does not qualify the subsequent dev SHA or QA12R.

Local clone: rc0-agent/.build-temp/rc0-baseline-9f69f9c.
Log/JUnit: rc0-agent/.build-temp/rc0-e2e-baseline-9f69f9c-20261003.log/.xml.
JUnit SHA256: `1484bacd837c568fa8a22b42b5dd950dba0294bd6d987d39c00f4d8320598451`.
Per-case screenshots, video and error-context files are in the clone's
packages/app/e2e/test-results; the HTML report is in e2e/playwright-report.
These artifacts are local; they have not been uploaded as release evidence.

## Critical journeys which passed

- app/titlebar-history (3) and sidebar/sidebar-session-links (1).
- v110/automate-branch-run: configured branch execution in the browser.
- v110/work-board-reload: board mutation survives reload.
- v110/work-start-run: real Team submission reaches the Runs view.
- modes/design-journey (2), design/design-approval-journey (3),
  modes/mode-navigation (4), project switch (2) and active project close (1).

These are software/browser proofs, not native transport, physical Android,
physical Windows or Voice-device qualification. A successful branch-run spec
alone does not close every CR04/CR10 acceptance criterion.

## Failure inventory

Every failure below is present on the fixed dev SHA before the local #225/#226
lots. This establishes a baseline, not that every failure is harmless or a
flake. Unknown means its producer/call chain has not been diagnosed; no
regression or flake disposition is inferred from a timeout. No skip, timeout,
policy exemption or screenshot reference was changed to produce these counts.

| Spec file under e2e | Failures | Disposition |
| --- | ---: | --- |
| design/design-a11y.spec.ts | 1 | Automate hidden assertion conflicts with visible rail; policy disposition unresolved |
| design/design-visual.spec.ts | 9 | 8 strict image mismatches + 1 reload mismatch; see Design diagnosis |
| modes/design-mode.spec.ts | 4 | Removed split/switcher selectors; route/layout contract also stale |
| modes/mock-bridge-smoke.spec.ts | 1 | Present on frozen dev; cause unknown |
| modes/mode-reload-stability.spec.ts | 1 | Present on frozen dev; cause unknown |
| modes/mode-switch-latency.spec.ts | 1 | Measured 534ms vs budget; concurrent host work prevents isolated perf qualification |
| projects/project-edit.spec.ts | 1 | Reproduced locally now; earlier CI-only classification superseded |
| projects/workspaces.spec.ts | 1 | Present on frozen dev; cause unknown |
| prompt/context.spec.ts | 1 | Open file action absent; ADR-049/047 actions disabled |
| prompt/prompt-shell.spec.ts | 2 | Present on frozen dev; cause unknown |
| prompt/prompt-slash-terminal.spec.ts | 1 | Present on frozen dev; cause unknown |
| session/session-child-navigation.spec.ts | 1 | Present on frozen dev; cause unknown |
| session/session-composer-dock.spec.ts | 2 | Present on frozen dev; cause unknown |
| session/session-model-persistence.spec.ts | 3 | Present on frozen dev; cause unknown |
| settings/settings-keybinds.spec.ts | 4 | Present on frozen dev; cause unknown |
| sidebar/sidebar-popover-actions.spec.ts | 1 | Present on frozen dev; cause unknown |
| terminal/terminal-init.spec.ts | 1 | Present on frozen dev; cause unknown |
| terminal/terminal-reconnect.spec.ts | 1 | Present on frozen dev; cause unknown |
| terminal/terminal-tabs.spec.ts | 3 | Present on frozen dev; cause unknown |
| terminal/terminal.spec.ts | 1 | Present on frozen dev; cause unknown |
| v110/a3-responsive.spec.ts | 3 | Present on frozen dev; cause unknown |
| v110/a3-shell-mobile.spec.ts | 1 | Present on frozen dev; cause unknown |
| v110/a4-code-chrome.spec.ts | 1 | Present on frozen dev; cause unknown |
| v110/a4-responsive.spec.ts | 1 | Present on frozen dev; cause unknown |
| v110/a6-responsive.spec.ts | 1 | Removed split/switcher selectors; route/layout contract also stale |
| v110/automate-responsive.spec.ts | 1 | Present on frozen dev; cause unknown |
| v110/canvas-comments.spec.ts | 1 | Present on frozen dev; cause unknown |
| v110/canvas-import.spec.ts | 1 | Present on frozen dev; cause unknown |
| v110/canvas-layers.spec.ts | 1 | Present on frozen dev; cause unknown |
| v110/canvas-multiselect.spec.ts | 1 | Present on frozen dev; cause unknown |
| v110/canvas-native.spec.ts | 2 | Present on frozen dev; cause unknown |
| v110/canvas-path-curve.spec.ts | 1 | Present on frozen dev; cause unknown |
| v110/canvas-path-edit.spec.ts | 1 | Present on frozen dev; cause unknown |
| v110/canvas-pen-curve.spec.ts | 1 | Present on frozen dev; cause unknown |
| v110/canvas-vector.spec.ts | 1 | Present on frozen dev; cause unknown |
| v110/chat.spec.ts | 2 | Present on frozen dev; cause unknown |
| v110/code.spec.ts | 3 | Present on frozen dev; cause unknown |
| v110/editor-search.spec.ts | 1 | Present on frozen dev; cause unknown |
| v110/home-glance.spec.ts | 3 | Present on frozen dev; cause unknown |
| v110/home-replay.spec.ts | 1 | Present on frozen dev; cause unknown |
| v110/home-states.spec.ts | 1 | Present on frozen dev; cause unknown |
| v110/memory-graph-filters.spec.ts | 1 | Present on frozen dev; cause unknown |
| v110/memory-graph-pan-zoom.spec.ts | 1 | Present on frozen dev; cause unknown |
| v110/memory-note-actions.spec.ts | 1 | Present on frozen dev; cause unknown |
| v110/memory-note-autosave.spec.ts | 1 | Present on frozen dev; cause unknown |
| v110/memory-vault-dnd.spec.ts | 1 | Present on frozen dev; cause unknown |
| v110/motion.spec.ts | 1 | Present on frozen dev; cause unknown |
| v110/port-gate.spec.ts | 5 | Present on frozen dev; cause unknown |
| v110/responsive.spec.ts | 1 | Present on frozen dev; cause unknown |
| v110/settings-behavior.spec.ts | 3 | Present on frozen dev; cause unknown |
| v110/settings-responsive.spec.ts | 1 | Present on frozen dev; cause unknown |
| v110/shell.spec.ts | 4 | Present on frozen dev; cause unknown |
| v110/surfaces.spec.ts | 3 | Present on frozen dev; cause unknown |
| v110/work-project-update.spec.ts | 1 | Work pickActiveRun localeCompare on missing updatedAt; producer not diagnosed |
| v110/work-team-panels.spec.ts | 1 | Present on frozen dev; cause unknown |
| v110-shell-gate.spec.ts | 4 | Present on frozen dev; cause unknown |
## Limits and next work

The complete JUnit inventory contains every test; this table accounts for all
98 failures. Seven skips and four serial-group not-run cases remain separate
from PASS. Diagnose individual groups against their canonical ADR/issue
acceptance criteria; do not replace them with assertions of current output.
The eight Design images differ by about 79-91% in this original baseline;
no blanket rasterization explanation or automatic golden regeneration applies.
The separate three-attempt reload investigation stops unresolved at 18 light
pixels (see RC0-DESIGN-VISUAL-DIAGNOSIS.md).

CR01 issue #77, complete security dispositions, package wiring, immutable-SHA
CI/build proof and owner-only physical gates remain outstanding. QA12R is not
green; RL00-RL02 and the final RL01 release package are not ready.
