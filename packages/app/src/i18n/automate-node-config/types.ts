/* SPDX-License-Identifier: MIT */
// Key union and dictionary shape for the Automate node settings. Kept out of
// automate-node-config.ts so a per-locale module can type its object without
// importing the registry that imports it.

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

export type AutomateNodeConfigDict = Record<AutomateNodeConfigKey, string>
