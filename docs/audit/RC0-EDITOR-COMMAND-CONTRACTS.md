<!-- SPDX-License-Identifier: MIT -->

# RC-0 editor command qualification

## Reproduced failures

On dev73cd8ec6ea, the unchanged command journeys fail twice (exit1).
The inspector test expects the removed Toggle file tree control. The
file-close test opens package.json through the real slash command and file
picker, but Chat layout hides the editor. Selecting Split reveals a second
production defect: the file selector is exposed as a button rather than a
tab, with no selected state or named tabpanel.

## Scoped correction

Choose Editor for the inspector journey and Split for the file journey.
Keep the real Ctrl+Shift+R and Ctrl+W actions and their state assertions.
Expose file buttons as tabs with stable IDs and selected state; name the
active content panel through its tab. A tablist owns only those IDs, leaving
adjacent close buttons outside its required tab children. This preserves
the existing interleaved visual layout. The ownership relationship follows
[WAI-ARIA 1.2](https://www.w3.org/TR/wai-aria-1.2/#aria-owns).

An initial header-as-tablist patch passed both command tests but introduced
critical axe aria-required-children failures because it also contained close
buttons. That regression is recorded, corrected and covered by the retained
axe assertion; no accessibility rule was disabled for this correction.

## Evidence and limits

Command: bun run test:e2e:local -- e2e/commands/panels.spec.ts
e2e/commands/tab-close.spec.ts --workers=1 --retries=0

Final result: 2 passed in 30.2s, complete process exit0. The journey verifies
the real file tab, selected state, named panel, scoped axe scan and closure.
App typecheck passes. App unit suite: 2095 pass, 1 existing live STT skip,
0 fail, 151437 assertions across 250 files, 7.04s, exit0.
JUnit: rc0-command-app-unit-20261002.xml under rc0-agent/.build-temp.
Baseline and introduced-regression snapshots are retained there as
rc0-command-{panels-baseline,tab-baseline,tab-split,tab-aria-regression}-context-20261002.md.

The repository search finds one production code-tab owner, this editor
surface, plus editor-search and a4-code-chrome browser consumers. Nine other
fixtures still reference Toggle file tree and need separate qualification.
Existing axe contrast debt remains recorded by the shared helper. These two
journeys do not qualify screen readers, complete tab keyboard navigation,
physical devices, the full browser suite or QA12R.
