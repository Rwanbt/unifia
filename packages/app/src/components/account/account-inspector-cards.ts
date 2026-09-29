/* SPDX-License-Identifier: MIT */

import type { InspectorCard } from "@/context/mode-inspector"

type Translate = (key: string, params?: Record<string, string | number>) => string

export type AccountInspectorInput = {
  readonly name: string
  /** Email or role when signed in, the local-profile summary otherwise. */
  readonly summary: string
  readonly page: string
  readonly organisation: string | undefined
  readonly projectCount: number
}

/** What the inspector shows for the account centre: the identity and the page open. */
export function accountInspectorCards(input: AccountInspectorInput, t: Translate): readonly InspectorCard[] {
  return [
    { title: input.name, description: input.summary },
    {
      title: t("account.nav.label"),
      rows: [
        { label: t("inspector.page"), value: input.page },
        { label: t("inspector.account.organisation"), value: input.organisation ?? "—" },
        { label: t("inspector.account.projects"), value: String(input.projectCount) },
      ],
    },
  ]
}
