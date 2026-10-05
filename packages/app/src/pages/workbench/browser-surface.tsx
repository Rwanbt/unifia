/* SPDX-License-Identifier: MIT */

import { Show, createEffect, onCleanup } from "solid-js"
import { useLocation } from "@solidjs/router"
import { useMode } from "@/context/mode"
import { useLanguage } from "@/context/language"
import { useModeInspector } from "@/context/mode-inspector"
import { useModeNavigation } from "@/context/mode-navigation"
import { useWorkspaceWorkbench } from "@/context/workbench/provider"
import { browserNavigationRequest } from "@/pages/workbench/design-browser-model"
import { browserInspectorCards } from "@/pages/workbench/browser-inspector-cards"
import { browserNavSections } from "@/pages/workbench/browser-nav-sections"
import { createBrowserSessionController } from "@/pages/workbench/browser-session-controller"
import { BrowserActivityStrip, BrowserAddressBar, BrowserDownloadStrip, BrowserTabStrip, BrowserViewport } from "@/pages/workbench/browser-surface-parts"

/** Browser mode: the chat-linked isolated runtime session, shown and driven in the Editor. */
export function BrowserSurface() {
  const mode = useMode()
  const language = useLanguage()
  const location = useLocation()
  const workbench = useWorkspaceWorkbench()
  const browser = createBrowserSessionController({
    browserConnection: workbench.browserConnection,
    ensureBrowserConnected: workbench.ensureBrowserConnected,
    publishActivity: workbench.setBrowserActivity,
  })

  createEffect(() =>
    browser.load({ directory: mode.directory(), chatSessionId: mode.sessionId(), request: browserNavigationRequest(location.state) }),
  )
  onCleanup(browser.dispose)

  useModeInspector().publish("browser", () => {
    const session = browser.state.session
    return browserInspectorCards(session ? { session, capabilities: browser.grantedCapabilities() } : undefined, language.t)
  })
  useModeNavigation().publish("browser", () =>
    browserNavSections(
      {
        visited: browser.state.visited,
        current: browser.activeTab()?.url,
        onOpen: (page) => browser.navigate(page, language.t("workbench.design.browser.addressRequired")),
      },
      language.t,
    ),
  )

  return (
    <main data-v110="mode-main" data-component="workbench-mode-main" class="min-w-0 min-h-0 flex-1 flex">
      <section data-v110="surface-card" data-component="workbench-browser-surface" class="min-w-0 min-h-0 flex-1 flex flex-col overflow-hidden">
        <BrowserTabStrip browser={browser} />
        <BrowserAddressBar browser={browser} />
        <Show when={browser.state.error}>
          {(message) => (
            <p class="shrink-0 px-2 py-1 text-12-regular text-text-weak" role="status" data-browser-error>
              {message()}
            </p>
          )}
        </Show>
        <BrowserViewport browser={browser} />
        <BrowserActivityStrip browser={browser} />
        <BrowserDownloadStrip browser={browser} />
      </section>
    </main>
  )
}
