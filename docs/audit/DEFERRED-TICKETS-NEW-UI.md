<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# Deferred work from the non-connected UI audit

Decision of 2026-09-29: the corrections plan fixes defects and removes dead code but adds **no new product function**. Everything below is real work that was deliberately left out. Each entry is ready to become a GitHub issue (title, scope, acceptance criteria).

## 1. Work: Run, Approve and "Generate update" have no backend action
- Where: `pages/workbench/work-cockpit.tsx` (`Soon` buttons: Auto Safe, Plan AI, Undo, per-task Run, Policy, Run, Approve, Generate update).
- Needed: Team endpoints to start a task, resolve a gate, undo, and draft a project update.
- Acceptance: each button either performs its action against the Team runtime or stays disabled with the "coming soon" tooltip.

## 2. Automate: Test, fixture and "→ Work"
- Where: `automate-studio-run-bar.tsx` (Test, fixture select, → Work are `aria-disabled`).
- Needed: a dry-run/test execution mode in the workflow runtime, fixture storage, and a handoff that creates a Work task from a workflow run.

## 3. Automate: the runtime is linear
- `toIr` (`workbench-server/src/native-workflow-port.ts`) executes `steps` only and always links them in sequence, so edges drawn in the studio (branches, joins) are stored in the draft (`ui`) but ignored at run time.
- Needed: accept the canonical v2 `{nodes, edges}` IR at `POST /v1/workflows`, then switch the draft to v2 (the migration code in `automate-migrate-legacy.ts` is ready and currently only tested).

## 4. Browser: tabs and `@unifia/browser-runtime`
- The Browser destination drives one native window (`design-browser-tab.tsx`); `packages/browser-runtime` has no consumer.
- Needed: multi-tab model, and either wire the runtime package or delete it.

## 5. Terminal panel: Problems, Output, Tests, Debug, Ports
- Five tabs are placeholders. Needed: producers for each (LSP diagnostics already exist in `context/lsp-diagnostics`).

## 6. Code inspector: "add to context" and tasks
- `pages/session/code-inspector/parts.tsx` keeps `Soon` controls for adding items to the prompt context and for tasks.

## 7. `voice/*` modules never imported by the web app
- About twenty modules under `packages/app/src/voice/` have no production import. Decide whether they belong to the mobile/desktop bridge (then document) or are remnants (then remove).

## 8. Workspace packages with no consumer
- `browser-runtime`, `scheduler`, `artifact-store`, `media-runtime`, `capability-runtime`, `sandbox-drivers`, `generative-ui-dom`, `release-hardening`, `runtime-conformance`: product decision per package (wire, park, or delete).

## 9. Observability: seven domains without a producer
- `artifact`, `approval`, `browser`, `process`, `routing`, `policy`, `hooks` are declared in the observability schema but nothing emits them.

## 10. Wiring gaps found while cleaning
- `components/workspace-tabs-bar.tsx` is never mounted although `e2e/v110/a4-code-chrome.spec.ts` expects it visible: fix the spec or mount the bar.
- `components/team/refresh-policy.ts` (TEAM-M03 throttle and recovery) is tested but not used by the Team panel.
- `pages/session/file-tab-scroll.ts` (`createFileTabListSync`) is tested but not used by the editor tab list.

## 11. Account and Settings "soon" controls
- Settings and Account pages keep greyed controls with no backend (see audit section G). Each needs its own issue when the backend exists.

## 12. Automate: allow `workflow.run` through the approval gate
- Run answers 403 in the shipped app: the lease lacks `workflow.run` and the server refuses it before the broker (`server-helpers.ts`, 2026-08-17 decision, `capability-scope.test.ts`). Everything behind it works (`packages/unifia/test/server/workbench-automate-run.test.ts`).
- Needed: owner decision to make `workflow.run` step-up eligible (`workbench-server/src/constants.ts`), then adapt the pinned test.

## 13. Automate: node configuration editor
- The studio adds library nodes with an empty config, so only `trigger.manual`, `human.approval` and `wait` run; the other 11 families are greyed "soon" (evidence: `workbench-server/test/library-family-runnability.test.ts`).
- Needed: a per-family config form and typed branch edges (the run currently rebuilds linear edges in `toIr`), then a schedule worker for `trigger.schedule`.

## 14. Design skill picker is not mounted
- `pages/workbench/skill-picker.tsx`, `workbench-shell/src/skill-picker.ts`, `client.listDesignSkills` and the `/v1/design-skills` route all exist and are wired server-side; no surface mounts the picker or defines what selecting a skill does.

## 15. Server dependencies never injected
- `browser`, `desktop`, `memory`, `capabilities`, `ui`, `uiAllowedActions`, `skillHub` are optional in `createWorkbenchApp` and left unset by `unifia/src/server/workbench.ts`; their routes answer 503. No surface calls them today (see `AUDIT-CABLAGE-NEW-UI-2026-09-30.md`).
