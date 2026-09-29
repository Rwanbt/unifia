/* SPDX-License-Identifier: MIT */

// =============================================================================
// context/work-view.ts — A5-03, moved here by ADR-040
//
// The Work mode's view set, mirroring the v110 mockup's viewDefs
// (Overview/Tasks/Board/Timeline/Activity/Runs). The active view is layout
// state (layout.work.view()) because the context panel picks it and the Work
// card renders it. Unlike Design's tab state (design-tabs.ts), this set is
// fixed and never opened/closed by the user.
// =============================================================================

export type WorkView = "overview" | "tasks" | "board" | "timeline" | "activity" | "runs"

export const WORK_VIEWS: readonly WorkView[] = ["overview", "tasks", "board", "timeline", "activity", "runs"]

// The maquette's own glyphs for each view (context panel "Work" section).
export const WORK_VIEW_GLYPH: Record<WorkView, string> = {
  overview: "☼",
  tasks: "✓",
  board: "▦",
  timeline: "⌁",
  activity: "◷",
  runs: "▶",
}

export const WORK_VIEW_LABEL_KEY: Record<WorkView, string> = {
  overview: "workbench.work.view.overview",
  tasks: "workbench.work.view.tasks",
  board: "workbench.work.view.board",
  timeline: "workbench.work.view.timeline",
  activity: "workbench.work.view.activity",
  runs: "workbench.work.view.runs",
}
