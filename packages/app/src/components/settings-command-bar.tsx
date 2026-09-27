/* SPDX-License-Identifier: MIT */

import { createEffect, createSignal, For } from "solid-js"
import { getFilename } from "@unifia/util/path"
import { Select } from "@unifia/ui/select"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { filterSettingRows } from "./settings-search"
import { useSettingsScope, type SettingsDetail, type SettingsScope } from "./settings-scope"

const DETAILS: SettingsDetail[] = ["guided", "technical"]
const SCOPES: SettingsScope[] = ["personal", "project"]

/** Maquette `.v91-settings-commandbar`: title and save state, search, scope
 * and detail level (ADR-047). */
export function SettingsCommandBar(props: { tab: string }) {
  const language = useLanguage()
  const sdk = useSDK()
  const settings = useSettingsScope()
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
      <div data-slot="settings-search-wrap">
        <input
          type="search"
          data-slot="settings-search"
          placeholder={language.t("settings.search.placeholder")}
          aria-label={language.t("settings.search.placeholder")}
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
      </div>
      <div data-slot="settings-controls">
        <span data-slot="settings-control-label">{language.t("settings.scope.label")}</span>
        <div data-slot="settings-scope">
          <Select
            options={SCOPES}
            current={settings.scope()}
            label={(scope) =>
              scope === "personal"
                ? language.t("settings.scope.personal")
                : language.t("settings.scope.project", { name: getFilename(sdk.directory) || sdk.directory })
            }
            onSelect={(scope) => scope && settings.setScope(scope)}
            aria-label={language.t("settings.scope.aria")}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </div>
        <div data-slot="settings-detail" role="group" aria-label={language.t("settings.detail.aria")}>
          <span aria-hidden="true">{language.t("settings.detail.label")}</span>
          <For each={DETAILS}>
            {(detail) => (
              <button
                type="button"
                aria-pressed={settings.detail() === detail}
                onClick={() => settings.setDetail(detail)}
              >
                {language.t(`settings.detail.${detail}`)}
              </button>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}
