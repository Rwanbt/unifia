/* SPDX-License-Identifier: MIT */
// Strings for the Automate node settings (control.if condition, control.merge
// strategy). en/fr here, every other locale falls back to English: same pattern
// as i18n/design-artifact.ts, because en.ts and fr.ts are past the 1500 LOC ceiling.

import type { Locale } from "@/context/language"

export type AutomateNodeConfigKey =
  | "config.title"
  | "config.if.condition"
  | "config.if.hint"
  | "config.if.required"
  | "config.merge.strategy"
  | "config.merge.all"
  | "config.merge.any"
  | "config.merge.waitsOn"
  | "config.merge.noBranches"

type Dict = Record<AutomateNodeConfigKey, string>

const en: Dict = {
  "config.title": "Settings",
  "config.if.condition": "Condition",
  "config.if.hint": "Reads earlier steps as $node.<id>.json.<field>, for example $node.fetch.json.count > 2. The true and false outputs are the two ports of this node.",
  "config.if.required": "A condition is required before this workflow can run.",
  "config.merge.strategy": "Continue when",
  "config.merge.all": "all incoming branches are done",
  "config.merge.any": "one incoming branch is done",
  "config.merge.waitsOn": "Waits on: {ids}",
  "config.merge.noBranches": "Draw at least one edge into this node.",
}

const fr: Dict = {
  "config.title": "Réglages",
  "config.if.condition": "Condition",
  "config.if.hint": "Lit les étapes précédentes avec $node.<id>.json.<champ>, par exemple $node.fetch.json.count > 2. Les sorties vrai et faux sont les deux ports de ce nœud.",
  "config.if.required": "Une condition est nécessaire pour lancer ce workflow.",
  "config.merge.strategy": "Continuer quand",
  "config.merge.all": "toutes les branches entrantes sont terminées",
  "config.merge.any": "une branche entrante est terminée",
  "config.merge.waitsOn": "Attend : {ids}",
  "config.merge.noBranches": "Tracez au moins un lien vers ce nœud.",
}

const dicts: Partial<Record<Locale, Dict>> = { en, fr }

export function tAutomateNodeConfig(locale: Locale, key: AutomateNodeConfigKey, params?: Record<string, string>): string {
  const template = dicts[locale]?.[key] ?? en[key]
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match)
}
