/* SPDX-License-Identifier: MIT */

import { type Component, For, Show, createMemo } from "solid-js"
import { IconButton } from "@unifia/ui/icon-button"
import { useLanguage } from "@/context/language"
import type { SettingsGroup } from "./dialog-settings"
import { SettingsNavIcon } from "./settings-nav-icon"
import { SettingsPageBoundary } from "./settings-page"

/**
 * Settings on overlay viewports: the reference's phone list (grouped sections,
 * two-column grid of pages), then one page with a way back. The pages come
 * from the panel's `settingsGroups()` so both layouts list the same ones
 * (ADR-083); `page` is owned by the panel, which also opens pages from
 * cross-links.
 */
export const SettingsMobileNav: Component<{
  groups: SettingsGroup[]
  page: string | undefined
  /** The page the list highlights: the last one opened. */
  active: string
  onOpen: (id: string) => void
  onBack: () => void
}> = (props) => {
  const language = useLanguage()
  const current = createMemo(() => props.groups.flatMap((group) => group.pages).find((page) => page.id === props.page))

  return (
    <div data-slot="settings-mobile-nav">
      <Show
        when={current()}
        fallback={
          <div data-slot="settings-mobile-list">
            <For each={props.groups}>
              {(group) => (
                <section data-slot="settings-mobile-group">
                  <h3>{group.label}</h3>
                  <div data-slot="settings-mobile-grid">
                    <For each={group.pages}>
                      {(page) => (
                        <button
                          type="button"
                          data-slot="settings-mobile-item"
                          data-active={page.id === props.active ? "" : undefined}
                          onClick={() => props.onOpen(page.id)}
                        >
                          <SettingsNavIcon name={page.icon} />
                          <span>{page.label}</span>
                        </button>
                      )}
                    </For>
                  </div>
                </section>
              )}
            </For>
          </div>
        }
      >
        {(page) => (
          <>
            <div data-slot="settings-mobile-head">
              <IconButton
                icon="arrow-left"
                variant="ghost"
                onClick={() => props.onBack()}
                aria-label={language.t("common.goBack")}
              />
              <b>{page().label}</b>
            </div>
            <div data-slot="settings-mobile-content">
              <SettingsPageBoundary>{page().render()}</SettingsPageBoundary>
            </div>
          </>
        )}
      </Show>
    </div>
  )
}
