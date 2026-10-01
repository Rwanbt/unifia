<!-- SPDX-License-Identifier: MIT -->
# QA03 / CR10 — obsolete inspector entry control

Measured on `3a02d8de7e` (documentation-only delta from `dev@100eae3073`), 2026-10-01. Run from `packages/app`, with `PLAYWRIGHT_TIMEOUT=180000`, `PLAYWRIGHT_WORKERS=1` and mandated TEMP/TMP: `bun run test:e2e:local -- e2e/v110/memory-rename-links.spec.ts e2e/v110/editor-search.spec.ts e2e/v110/work-team-panels.spec.ts --workers=1 --retries=0`.

`editor-search.spec.ts:15` fails at 180 seconds waiting for `getByRole("button", { name: "Toggle file tree" })`. Its page snapshot shows Chat layout selected and a button named `Show / hide the inspector`, with no `Toggle file tree` button. `packages/app/src/components/titlebar.tsx:365` implements that current control as `data-v110="inspector-toggle"`, with `aria-expanded` tied to the inspector state. The former file-tree toggle belongs to the session header and forces a particular tab; opening the generic inspector also requires selecting its desired tab explicitly.

Search found the same former locator in editor-search, a4-code-chrome, a3-responsive, port-gate, memory-note-autosave, memory-note-actions, memory-graph-pan-zoom, memory-graph-filters, memory-vault-dnd and memory-rename-links. This is a concrete stale entry-control failure on the current layout. It does not prove that every historical Linux starvation failure in #58 has the same cause.

Next correction: use the current inspector control, wait for expanded state, select the required inspector tab, and retain the existing editor/file or Memory byte assertions. Split coherent test groups into small independently verifiable PRs; do not increase timeouts, skip tests or weaken their outcomes. The remaining tests in this measured process must be classified from its final output before claiming a complete CR10 gate.

The same process also reproduced the former locator timeout in `memory-rename-links.spec.ts:44` before any rename. `work-team-panels.spec.ts:72` then failed because it asserts `aria-pressed="true"` on the Overview navigation item; the resolved current element instead exposes `aria-current="true"`. This requires tracing the current navigation contract separately from the inspector entry control. All three are pre-existing on the candidate: this branch has changed documentation only.
