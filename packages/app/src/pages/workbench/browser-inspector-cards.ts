/* SPDX-License-Identifier: MIT */

import type { InspectorCard } from "@/context/mode-inspector"

type Translate = (key: string, params?: Record<string, string | number>) => string

export type BrowserInspectorInput = {
  /** Label of the native window this tab opened, when there is one. */
  readonly windowLabel: string | undefined
  /** Address the tab was last asked to open. */
  readonly address: string
  /** Address shown in the inline frame, set only when the native window could not open. */
  readonly fallbackUrl: string
}

/** What the inspector shows for Browser: the window this tab really holds, nothing more. */
export function browserInspectorCards(input: BrowserInspectorInput, t: Translate): readonly InspectorCard[] {
  const native = input.windowLabel !== undefined
  const framed = input.fallbackUrl !== ""
  const rows = [{ label: t("inspector.browser.window"), value: t(native ? "inspector.browser.windowOpen" : "inspector.browser.windowNone") }]
  if (native) rows.push({ label: t("inspector.browser.mode"), value: t("inspector.browser.modeNative") })
  if (framed) rows.push({ label: t("inspector.browser.mode"), value: t("inspector.browser.modeFrame") })
  if (native || framed) rows.push({ label: t("inspector.browser.address"), value: framed ? input.fallbackUrl : input.address })
  return [{ title: t("design.studio.workshop.browser"), rows }]
}
