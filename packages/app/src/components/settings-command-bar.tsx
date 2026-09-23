/* SPDX-License-Identifier: MIT */

import { createEffect, createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import { filterSettingRows } from "./settings-search"

/** Maquette `.v91-settings-commandbar`: title, save state and search (ADR-047). */
export function SettingsCommandBar(props: { tab: string }) {
  const language = useLanguage()
  const [query, setQuery] = createSignal("")
  let bar: HTMLDivElement | undefined

  // Rerun on tab change too: the newly opened page mounts unfiltered.
  createEffect(() => {
    const value = query()
    void props.tab
    requestAnimationFrame(() => {
      const page = bar?.parentElement?.querySelector('[role="tabpanel"]')
      if (page) filterSettingRows(page, value)
    })
  })

  return (
    <div ref={bar} data-v110="settings-commandbar">
      <div data-slot="settings-title">
        <b>{language.t("settings.title")}</b>
        {/* Settings persist as they change; there is no unsaved state to show. */}
        <span data-slot="settings-save-state">
          <i aria-hidden="true" />
          <span>{language.t("settings.saveState.saved")}</span>
        </span>
      </div>
      <input
        type="search"
        data-slot="settings-search"
        placeholder={language.t("settings.search.placeholder")}
        aria-label={language.t("settings.search.placeholder")}
        value={query()}
        onInput={(event) => setQuery(event.currentTarget.value)}
      />
    </div>
  )
}
