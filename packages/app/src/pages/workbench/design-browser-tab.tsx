/* SPDX-License-Identifier: MIT */

import { createSignal, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { useMode } from "@/context/mode"
import { browserHandoffState } from "@/pages/workbench/design-browser-model"

/** Redirects legacy Design preview requests into the chat-linked Browser runtime. */
export function DesignBrowserTab(): JSX.Element {
  const mode = useMode()
  const language = useLanguage()
  const [address, setAddress] = createSignal("")
  const [error, setError] = createSignal("")

  const openInBrowser = (event: Event) => {
    event.preventDefault()
    const handoff = browserHandoffState(address(), crypto.randomUUID())
    if (!handoff) {
      setError(language.t("workbench.design.browser.addressRequired"))
      return
    }
    mode.selectDestination("browser", handoff)
  }

  return <div class="flex h-full min-h-0 flex-col" data-design-browser>
    <form class="flex shrink-0 items-center gap-2 border-b border-border-base p-2" onSubmit={openInBrowser}>
      <input
        class="min-w-0 flex-1 rounded border border-border-base bg-background-base px-2 py-1 text-12-regular"
        aria-label="URL"
        placeholder="https://example.com"
        value={address()}
        onInput={(event) => setAddress(event.currentTarget.value)}
        data-design-browser-address
      />
      <button type="submit" class="rounded border border-border-base px-2 py-1 text-12-medium" data-design-browser-go>{language.t("browser.surface.openInBrowser")}</button>
    </form>
    {error() && <p class="shrink-0 px-2 py-1 text-12-regular text-text-weak" role="alert" data-design-browser-error>{error()}</p>}
    <div class="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-12-regular text-text-weak" data-design-browser-shared-runtime>
      {language.t("browser.surface.sharedRuntime")}
    </div>
  </div>
}
