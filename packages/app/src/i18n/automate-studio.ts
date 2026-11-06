/* SPDX-License-Identifier: MIT */
// Strings of the Automate studio chrome: node library, capability list,
// canvas categories and the run bar's waiting state. en/fr live here because
// en.ts and fr.ts are past the 1500 LOC ceiling; every other locale owns a
// module under ./automate-studio/, so none of them falls back to English.

import type { Locale } from "@/context/language"
import { ar } from "./automate-studio/ar"
import { br } from "./automate-studio/br"
import { bs } from "./automate-studio/bs"
import { da } from "./automate-studio/da"
import { de } from "./automate-studio/de"
import { es } from "./automate-studio/es"
import { ja } from "./automate-studio/ja"
import { ko } from "./automate-studio/ko"
import { no } from "./automate-studio/no"
import { pl } from "./automate-studio/pl"
import { ru } from "./automate-studio/ru"
import { th } from "./automate-studio/th"
import { tr } from "./automate-studio/tr"
import type { AutomateStudioDict, AutomateStudioKey } from "./automate-studio/types"
import { zh } from "./automate-studio/zh"
import { zht } from "./automate-studio/zht"

export type { AutomateStudioDict, AutomateStudioKey }

const en: AutomateStudioDict = {
  "family.trigger.manual.label": "Manual trigger",
  "family.trigger.manual.description": "Start the workflow when someone continues the run.",
  "family.trigger.schedule.label": "Schedule trigger",
  "family.trigger.schedule.description": "Start on a cron or interval.",
  "family.control.if.label": "If / else",
  "family.control.if.description": "Branch on a boolean expression.",
  "family.control.switch.label": "Switch",
  "family.control.switch.description": "Multi-way branch on a value.",
  "family.control.parallel.label": "Parallel",
  "family.control.parallel.description": "Run child branches concurrently.",
  "family.control.merge.label": "Merge",
  "family.control.merge.description": "Combine parallel branch outputs.",
  "family.control.map.label": "Map",
  "family.control.map.description": "Apply a child branch to each item.",
  "family.control.repeat.label": "Repeat",
  "family.control.repeat.description": "Loop a fixed number of times.",
  "family.control.while.label": "While",
  "family.control.while.description": "Loop while a predicate holds.",
  "family.control.child.label": "Child workflow",
  "family.control.child.description": "Invoke another workflow by id.",
  "family.tool.http.label": "HTTP request",
  "family.tool.http.description": "Call an external HTTP endpoint.",
  "family.tool.transform.label": "Transform",
  "family.tool.transform.description": "Apply a JS expression to the payload.",
  "family.human.approval.label": "Human approval",
  "family.human.approval.description": "Pause until someone approves or rejects.",
  "family.wait.label": "Wait",
  "family.wait.description": "Pause until someone continues the run.",
  "category.Triggers": "Triggers",
  "category.Control flow": "Control flow",
  "category.Tools": "Tools",
  "category.Human": "Human",
  "category.Misc": "Misc",
  "capability.workflow.run": "Run workflows",
  "capability.workflow.publish": "Publish workflow drafts",
  "capability.design.create": "Create design systems",
  "capability.design.write": "Edit design systems",
  "capability.workspace.read": "Read workspace files",
  "capability.workspace.write": "Write workspace files",
  "capability.approval.read": "Read approvals",
  "capability.approval.write": "Resolve approvals",
  "capability.trace.read": "Read trace events",
  "canvas.category.trigger": "Triggers",
  "canvas.category.flow": "Flow",
  "canvas.category.tool": "Tools",
  "canvas.category.human": "Human",
  "canvas.category.steps": "Steps",
  "canvas.fit": "Fit",
  "run.state.waitingStep": "Waiting for you",
  "run.test.title": "Test runs the workflow without any external effect and without saving a run",
  "run.test.result": "Test finished: {status}. {count} external effect(s) simulated, none performed.",
  "run.test.effect": "Simulated: {method} {url}",
  "run.test.waiting": "Test stopped at {node}: a real run would wait for you here.",
  "run.waitingOn": "{node} is waiting for you",
  "run.continue": "Continue",
  "run.approve": "Approve",
  "run.reject": "Reject",
  "run.nothingToRun": "Add a step before running this workflow.",
}

const fr: AutomateStudioDict = {
  "family.trigger.manual.label": "Déclencheur manuel",
  "family.trigger.manual.description": "Démarre le workflow quand quelqu'un fait continuer le run.",
  "family.trigger.schedule.label": "Déclencheur planifié",
  "family.trigger.schedule.description": "Démarre selon un cron ou un intervalle.",
  "family.control.if.label": "Si / sinon",
  "family.control.if.description": "Choisit une branche selon une expression booléenne.",
  "family.control.switch.label": "Aiguillage",
  "family.control.switch.description": "Choisit parmi plusieurs branches selon une valeur.",
  "family.control.parallel.label": "Parallèle",
  "family.control.parallel.description": "Exécute des branches en même temps.",
  "family.control.merge.label": "Fusion",
  "family.control.merge.description": "Rassemble les sorties de branches parallèles.",
  "family.control.map.label": "Pour chaque",
  "family.control.map.description": "Applique une branche à chaque élément.",
  "family.control.repeat.label": "Répéter",
  "family.control.repeat.description": "Boucle un nombre fixe de fois.",
  "family.control.while.label": "Tant que",
  "family.control.while.description": "Boucle tant qu'une condition est vraie.",
  "family.control.child.label": "Workflow enfant",
  "family.control.child.description": "Appelle un autre workflow par son id.",
  "family.tool.http.label": "Requête HTTP",
  "family.tool.http.description": "Appelle un point d'accès HTTP externe.",
  "family.tool.transform.label": "Transformation",
  "family.tool.transform.description": "Applique une expression JS aux données.",
  "family.human.approval.label": "Approbation humaine",
  "family.human.approval.description": "Met en pause jusqu'à ce que quelqu'un approuve ou refuse.",
  "family.wait.label": "Attente",
  "family.wait.description": "Met en pause jusqu'à ce que quelqu'un fasse continuer le run.",
  "category.Triggers": "Déclencheurs",
  "category.Control flow": "Contrôle du flux",
  "category.Tools": "Outils",
  "category.Human": "Humain",
  "category.Misc": "Divers",
  "capability.workflow.run": "Lancer des workflows",
  "capability.workflow.publish": "Publier des brouillons de workflow",
  "capability.design.create": "Créer des design systems",
  "capability.design.write": "Modifier des design systems",
  "capability.workspace.read": "Lire les fichiers de l'espace de travail",
  "capability.workspace.write": "Écrire les fichiers de l'espace de travail",
  "capability.approval.read": "Lire les approbations",
  "capability.approval.write": "Traiter les approbations",
  "capability.trace.read": "Lire les événements de trace",
  "canvas.category.trigger": "Déclencheurs",
  "canvas.category.flow": "Flux",
  "canvas.category.tool": "Outils",
  "canvas.category.human": "Humain",
  "canvas.category.steps": "Étapes",
  "canvas.fit": "Ajuster",
  "run.state.waitingStep": "En attente de vous",
  "run.test.title": "Le test exécute le workflow sans aucun effet externe et sans enregistrer d'exécution",
  "run.test.result": "Test terminé : {status}. {count} effet(s) externe(s) simulé(s), aucun exécuté.",
  "run.test.effect": "Simulé : {method} {url}",
  "run.test.waiting": "Test arrêté sur {node} : une vraie exécution vous attendrait ici.",
  "run.waitingOn": "{node} attend votre action",
  "run.continue": "Continuer",
  "run.approve": "Approuver",
  "run.reject": "Refuser",
  "run.nothingToRun": "Ajoutez une étape avant de lancer ce workflow.",
}

export const dicts: Record<Locale, AutomateStudioDict> = {
  en,
  zh,
  zht,
  ko,
  de,
  es,
  fr,
  da,
  ja,
  pl,
  ru,
  ar,
  no,
  br,
  th,
  bs,
  tr,
}

export function isAutomateStudioKey(key: string): key is AutomateStudioKey {
  return key in en
}

export function tAutomateStudio(locale: Locale, key: AutomateStudioKey, params?: Record<string, string>): string {
  const template = dicts[locale][key]
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match)
}

/** A key built from runtime data (a family, a category): falls back to the raw text when unknown. */
export function tAutomateStudioOr(locale: Locale, key: string, fallback: string): string {
  return isAutomateStudioKey(key) ? tAutomateStudio(locale, key) : fallback
}
