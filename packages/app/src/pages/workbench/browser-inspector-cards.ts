/* SPDX-License-Identifier: MIT */

import type { BrowserSession, P3Capability } from "@unifia/contracts"
import type { InspectorCard } from "@/context/mode-inspector"

type Translate = (key: string, params?: Record<string, string | number>) => string

export type BrowserInspectorInput = {
  readonly session: BrowserSession
  /** Browser capabilities the Workbench lease actually granted to this surface. */
  readonly capabilities: readonly P3Capability[]
}

// Mirrors the runtime's egress rule: a user browses public HTTP(S), the AI is
// narrowed to the origins approved for its session, a paused session sends nothing.
const NETWORK_KEY: Record<BrowserSession["controller"], string> = {
  user: "inspector.browser.networkUser",
  ai: "inspector.browser.networkAi",
  paused: "inspector.browser.networkBlocked",
}

/** What the inspector shows for Browser: the live runtime session, nothing it does not hold. */
export function browserInspectorCards(input: BrowserInspectorInput | undefined, t: Translate): readonly InspectorCard[] {
  if (!input)
    return [{ title: t("design.studio.workshop.browser"), rows: [{ label: t("inspector.browser.status"), value: t("inspector.browser.connecting") }] }]
  const { session } = input
  const granted = (capability: P3Capability) => input.capabilities.includes(capability)
  const allowed = (capability: P3Capability) => t(granted(capability) ? "inspector.browser.allowed" : "inspector.browser.blocked")
  const activeTab = session.tabs.find((tab) => tab.id === session.activeTabId)
  return [
    {
      title: t("design.studio.workshop.browser"),
      rows: [
        { label: t("inspector.browser.controller"), value: t(`inspector.browser.controller.${session.controller}`) },
        { label: t("inspector.browser.address"), value: activeTab?.url ?? "—" },
        { label: t("inspector.browser.tabs"), value: String(session.tabs.length) },
        { label: t("inspector.browser.network"), value: t(NETWORK_KEY[session.controller]) },
        { label: t("inspector.browser.viewport"), value: `${session.viewport.width} × ${session.viewport.height}` },
        { label: t("inspector.browser.profile"), value: session.runtimeProfile },
      ],
    },
    {
      title: t("inspector.browser.permissions"),
      rows: [
        { label: t("inspector.browser.navigate"), value: allowed("browser.navigate") },
        { label: t("inspector.browser.interact"), value: allowed("browser.interact") },
        // Downloads and uploads are step-up capabilities: without a grant they
        // still reach the approval gate rather than being refused outright.
        { label: t("inspector.browser.download"), value: t(granted("browser.download") ? "inspector.browser.allowed" : "inspector.browser.approval") },
        { label: t("inspector.browser.upload"), value: t(granted("browser.upload") ? "inspector.browser.allowed" : "inspector.browser.approval") },
        { label: t("inspector.browser.sensitive"), value: t("inspector.browser.approval") },
      ],
    },
  ]
}
