/* SPDX-License-Identifier: MIT */

import type { NavSection } from "@/context/mode-navigation"

type Translate = (key: string) => string

export type AutomateNavInput = {
  /** Main workflow files (published versions excluded). */
  readonly files: readonly string[]
  readonly selected: string | undefined
  readonly runs: readonly { readonly status: string }[]
  readonly onOpenWorkflow: (path: string) => void
  readonly onOpenRuns: () => void
}

const VERSION_SUFFIX = /\.draft-\d+\.json$/i
const fileName = (path: string) => path.split("/").at(-1) ?? path

/** The Automate side panel: the workspace's real workflow files and its real run tallies. */
export function automateNavSections(input: AutomateNavInput, t: Translate): readonly NavSection[] {
  const selectedMain = input.selected?.replace(VERSION_SUFFIX, ".json")
  const failed = input.runs.filter((run) => run.status === "failed").length
  return [
    {
      id: "automate.workflows",
      titleKey: "sidebar.nav.workflows",
      emptyKey: "workbench.automate.noDefinitions",
      rows: input.files.map((path) => ({
        id: path,
        glyph: "⛓",
        label: fileName(path).replace(/\.json$/i, ""),
        active: path === selectedMain,
        onSelect: () => input.onOpenWorkflow(path),
      })),
    },
    {
      id: "automate.runs",
      titleKey: "sidebar.nav.runs",
      count: input.runs.length,
      rows: [
        { id: "history", glyph: "▶", label: t("sidebar.nav.history"), badge: String(input.runs.length), onSelect: input.onOpenRuns },
        { id: "failures", glyph: "⚠", label: t("sidebar.nav.failures"), badge: String(failed), onSelect: input.onOpenRuns },
      ],
    },
  ]
}
