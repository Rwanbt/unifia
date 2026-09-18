/* SPDX-License-Identifier: MIT */
// Copyright (c) 2026 Unifia contributors
//
// Home surface strings for the v110 port. packages/app/src/i18n/en.ts and
// fr.ts are already past the AGENTS.md 1500 LOC ceiling (2096 / 2109 lines --
// past the point the edit tooling itself refuses to touch them), so these
// keys live here instead of growing either file further.
//
// This replaces an earlier version of this file (homeDict + tHome) that was
// never imported anywhere: home.tsx hardcoded its English strings directly,
// bypassing i18n entirely, so a French-locale user saw an English hero,
// subtitle, composer placeholder and hint no matter what. Fixed by keying on
// the resolved Locale and falling back to English for any locale this file
// does not carry a translation for -- never silently rendering nothing for
// an unsupported locale, and never regressing existing English behaviour.

import type { Locale } from "@/context/language"

export type HomeKey =
  | "home.title"
  | "home.subtitle"
  | "home.composer.before"
  | "home.composer.commands"
  | "home.composer.context"
  | "home.composer.openProject"
  | "home.composer.newSession"
  | "home.composer.continue"
  | "home.hint"

type HomeDict = Record<HomeKey, string>

const en: HomeDict = {
  "home.title": "Get started with Unifia",
  "home.subtitle": "Open a project, resume a recent session, or jump straight into the mode that fits the task.",
  "home.composer.before": "Ask anything — ",
  "home.composer.commands": " for commands, ",
  "home.composer.context": " for context.",
  "home.composer.openProject": "Open project",
  "home.composer.newSession": "New session",
  "home.composer.continue": "Continue",
  "home.hint": "Click the Unifia logotype at any time to come back to this home.",
}

// Authoritative wording from the frozen maquette
// (Unifia-UI-UX-v110-PORT-READY-R1.html lines 15281-15283, 15287, 15296-15302, 15322).
const fr: HomeDict = {
  "home.title": "Commencer avec Unifia",
  "home.subtitle":
    "Ouvre un projet, reprends une session récente ou démarre directement dans le mode adapté à ta tâche.",
  "home.composer.before": "Demandez n'importe quoi, ",
  "home.composer.commands": " pour les commandes, ",
  "home.composer.context": " pour le contexte…",
  "home.composer.openProject": "Ouvrir un projet",
  "home.composer.newSession": "Nouvelle session",
  "home.composer.continue": "Continuer",
  "home.hint": "Clique sur le logotype Unifia à tout moment pour revenir à cet accueil.",
}

const dicts: Partial<Record<Locale, HomeDict>> = { en, fr }

export function tHome(locale: Locale, key: HomeKey): string {
  return dicts[locale]?.[key] ?? en[key]
}
