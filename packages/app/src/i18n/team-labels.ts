// =============================================================================
// i18n/team-labels.ts — TEAM-M05
//
// Builds the Team surface's label bundle from the active dictionary.
//
// The Team components take every user-facing string as a prop (TEAM-M03), which
// is what lets desktop, mobile and the terminal share them without any of them
// owning the others' copy. That design needs exactly one place where the
// dictionary is turned into a bundle — otherwise each surface grows its own
// mapping and they drift, which is how a key ends up translated in one screen
// and English in another.
// =============================================================================

import type { TeamPanelLabels } from "@/components/team/team-panel"

/**
 * The subset of the translator this module needs.
 *
 * Typed structurally rather than importing the context's type: this is a pure
 * function of a dictionary lookup, and depending on the Solid context would
 * make it untestable without a provider tree.
 */
export type Translate = (key: string, params?: Record<string, string>) => string

export function teamLabels(t: Translate): TeamPanelLabels {
  return {
    runs: {
      empty: t("team.runs.empty"),
      unreachable: t("team.runs.unreachable"),
      stale: t("team.runs.stale"),
      more: t("team.runs.more"),
    },
    models: {
      empty: t("team.models.empty"),
      unreachable: t("team.models.unreachable"),
      stale: t("team.models.stale"),
      more: t("team.models.more"),
    },
    selector: {
      title: t("team.selector.title"),
      sessionOnly: t("team.selector.sessionOnly"),
      saveDefault: t("team.selector.saveDefault"),
      clearOverride: t("team.selector.clearOverride"),
      // Interpolated at call time rather than baked in: the missing model is
      // not known until one goes missing.
      missing: (model: string) => t("team.selector.missing", { model }),
    },
    graph: t("team.graph.label"),
    lifecycle: t("team.lifecycle.readOnly"),
    retrying: t("team.status.retrying"),
    exhausted: t("team.status.exhausted"),
  }
}

/** Every key this bundle reads, so a parity test can check them as a set. */
export const TEAM_LABEL_KEYS = [
  "team.runs.empty",
  "team.runs.unreachable",
  "team.runs.stale",
  "team.runs.more",
  "team.models.empty",
  "team.models.unreachable",
  "team.models.stale",
  "team.models.more",
  "team.selector.title",
  "team.selector.sessionOnly",
  "team.selector.saveDefault",
  "team.selector.clearOverride",
  "team.selector.missing",
  "team.graph.label",
  "team.lifecycle.readOnly",
  "team.status.retrying",
  "team.status.exhausted",
] as const
