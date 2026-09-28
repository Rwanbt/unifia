/* SPDX-License-Identifier: MIT */

import { For, Show, type JSX } from "solid-js"
import { DropdownMenu } from "@unifia/ui/dropdown-menu"
import { useLanguage } from "@/context/language"
import type { DesignTab } from "@/pages/workbench/design-tabs"

/**
 * "Atelier" menu of the Design studio head (ADR-085): the canvas is the
 * default surface, and this menu reaches the other workshop tabs (Spec,
 * Fichiers, artifacts) plus the Terminal and Navigateur tabs, from the slot
 * where the reference shows its "→ Work" button.
 */
export function DesignWorkshopMenu(props: {
  tabs: readonly DesignTab[]
  githubLabel?: string
  onActivate: (id: string) => void
  onOpenTerminal: () => void
  onOpenBrowser: () => void
}): JSX.Element {
  const language = useLanguage()
  const t = language.t
  const others = () => props.tabs.filter((tab) => tab.kind !== "canvas")
  return (
    <DropdownMenu gutter={4} placement="bottom-start">
      <DropdownMenu.Trigger data-design-workshop-menu aria-label={t("design.studio.workshop.label")}>
        {t("design.studio.workshop.button")}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content data-design-workshop-menu-content>
          <For each={others()}>
            {(tab) => (
              <DropdownMenu.Item data-design-workshop-item={tab.id} onSelect={() => props.onActivate(tab.id)}>
                <DropdownMenu.ItemLabel>{tab.title}</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
            )}
          </For>
          <DropdownMenu.Separator />
          <DropdownMenu.Item data-design-workshop-item="terminal" onSelect={() => props.onOpenTerminal()}>
            <DropdownMenu.ItemLabel>{t("design.studio.workshop.terminal")}</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
          <DropdownMenu.Item data-design-workshop-item="browser" onSelect={() => props.onOpenBrowser()}>
            <DropdownMenu.ItemLabel>{t("design.studio.workshop.browser")}</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
          <Show when={props.githubLabel}>
            {(label) => (
              <>
                <DropdownMenu.Separator />
                <DropdownMenu.Item disabled data-design-github-state-item>
                  <DropdownMenu.ItemLabel>{label()}</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
              </>
            )}
          </Show>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}
