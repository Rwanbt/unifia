/* SPDX-License-Identifier: MIT */

import type { InspectorCard } from "@/context/mode-inspector"

type Translate = (key: string, params?: Record<string, string | number>) => string

/** What the inspector shows for Settings: where the user is in the settings pages. */
export function settingsInspectorCards(input: { readonly section: string | undefined; readonly page: string | undefined }, t: Translate): readonly InspectorCard[] {
  const rows = [
    ...(input.section ? [{ label: t("inspector.settings.section"), value: input.section }] : []),
    ...(input.page ? [{ label: t("inspector.page"), value: input.page }] : []),
  ]
  return [{ title: t("settings.title"), rows }]
}
