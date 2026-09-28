/* SPDX-License-Identifier: MIT */

import type { InspectorCard } from "@/context/mode-inspector"
import type { MemoryNoteDocument } from "./memory-panel-model"

type Translate = (key: string, params?: Record<string, string | number>) => string

export type MemoryInspectorInput = {
  readonly note: MemoryNoteDocument | undefined
  /** Location shown under the title (folder / file). */
  readonly location: string
  readonly modified?: string
  readonly backlinkCount: number
  readonly attached: boolean
  readonly onToggleAttached: () => void
}

/** What the inspector shows for Memory: the open note's real properties and its place in the session context. */
export function memoryInspectorCards(input: MemoryInspectorInput, t: Translate): readonly InspectorCard[] {
  const { note } = input
  if (!note) return [{ title: t("inspector.empty.title"), description: t("inspector.empty.description") }]
  const description = input.modified ? `${input.location} · ${input.modified}` : input.location
  return [
    { title: note.title, description },
    {
      title: t("inspector.memory.properties"),
      rows: [
        { label: t("inspector.memory.tags"), value: note.tags.length > 0 ? note.tags.map((tag) => `#${tag}`).join(" ") : "—" },
        { label: t("inspector.memory.links"), value: String(note.links.length) },
        { label: t("inspector.memory.backlinks"), value: String(input.backlinkCount) },
      ],
    },
    {
      title: t("inspector.memory.context"),
      description: t(input.attached ? "inspector.memory.attached" : "inspector.memory.detached"),
      actions: [{ label: t(input.attached ? "workbench.memory.toolbar.detach" : "workbench.memory.toolbar.attach"), run: input.onToggleAttached }],
    },
  ]
}
