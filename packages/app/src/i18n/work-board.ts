/* SPDX-License-Identifier: MIT */
// Strings for the Work board card moves (CR06). en/fr here, every other locale
// falls back to English: same pattern as i18n/design-artifact.ts, because
// en.ts and fr.ts are past the 1500 LOC ceiling.

import type { Locale } from "@/context/language"

export type WorkBoardKey =
  | "move.label"
  | "move.placeholder"
  | "move.failed"
  | "move.reason.stale"
  | "move.reason.not_allowed"
  | "move.reason.run_closed"
  | "move.reason.live_dependents"

type WorkBoardDict = Record<WorkBoardKey, string>

const en: WorkBoardDict = {
  "move.label": "Move task {task}",
  "move.placeholder": "Move to…",
  "move.failed": "The task could not be moved",
  "move.reason.stale": "The task changed in the meantime; the board was refreshed.",
  "move.reason.not_allowed": "A person cannot move a task to this column.",
  "move.reason.run_closed": "This run is finished.",
  "move.reason.live_dependents": "Other tasks still depend on this one.",
}

const fr: WorkBoardDict = {
  "move.label": "Déplacer la tâche {task}",
  "move.placeholder": "Déplacer vers…",
  "move.failed": "La tâche n'a pas pu être déplacée",
  "move.reason.stale": "La tâche a changé entre-temps ; le tableau a été actualisé.",
  "move.reason.not_allowed": "Une personne ne peut pas déplacer une tâche vers cette colonne.",
  "move.reason.run_closed": "Ce run est terminé.",
  "move.reason.live_dependents": "D'autres tâches dépendent encore de celle-ci.",
}

const dicts: Partial<Record<Locale, WorkBoardDict>> = { en, fr }

export function tWorkBoard(locale: Locale, key: WorkBoardKey, params?: Record<string, string>): string {
  const template = dicts[locale]?.[key] ?? en[key]
  if (!params) return template
  return template.replace(/{(w+)}/g, (match, name: string) => params[name] ?? match)
}
