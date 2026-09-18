/* SPDX-License-Identifier: MIT */
// Copyright (c) 2026 Unifia contributors
//
// Home surface i18n keys for the v110 port. Kept in a separate module so
// packages/app/src/i18n/en.ts (which is already past the AGENTS.md 1500 LOC
// ceiling) does not have to be edited to ship the new keys. The dict is
// merged by useLanguage() at runtime.

export const homeDict = {
  "home.title": "Get started with Unifia",
  "home.subtitle":
    "Open a project, resume a recent session, or jump straight into the mode that fits the task.",
  "home.composer.placeholder": "Ask anything — / for commands, @ for context.",
  "home.composer.new": "New session",
  "home.composer.continue": "Continue",
  "home.modes": "Modes",
  "home.hint": "Click the Unifia logotype at any time to come back to this home.",
  "home.glance.projects": "Projects",
  "home.glance.modes": "Modes",
  "home.glance.server": "Server",
  "home.state.loading": "Loading…",
  "home.state.empty.title": "No recent projects",
  "home.state.empty.description": "Get started by opening a local project",
  "home.state.error.title": "Couldn't load home",
  "home.state.error.description": "Try again or check the server connection",
  "home.mode.code": "Code",
  "home.mode.work": "Work",
  "home.mode.design": "Design",
  "home.mode.automate": "Automate",
  "home.mode.browser": "Browser",
  "home.mode.memory": "Memory",
} as const

export type HomeKey = keyof typeof homeDict

export function tHome(language: { t: (key: string) => string }, key: HomeKey): string {
  const value = homeDict[key]
  if (value in homeDict) return value
  return language.t(key)
}