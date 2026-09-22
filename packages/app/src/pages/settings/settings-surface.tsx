/* SPDX-License-Identifier: MIT */

import { IconButton } from "@unifia/ui/icon-button"
import { useLanguage } from "@/context/language"
import { SettingsPanel } from "@/components/dialog-settings"

export function SettingsSurface(props: { onClose: () => void }) {
  const language = useLanguage()

  return (
    <main data-v110="mode-main" data-component="workbench-mode-main" class="min-w-0 min-h-0 flex-1 flex">
      <section data-v110="surface-card" data-component="workbench-settings-surface" class="relative min-w-0 min-h-0 flex-1 flex flex-col">
        <div class="size-full min-h-0 overflow-hidden" data-workbench-surface="settings" data-parity="settings.surface">
          <div class="relative size-full min-h-0">
            <IconButton
              icon="close"
              variant="ghost"
              class="absolute right-3 top-3 z-10"
              aria-label={language.t("ui.common.close")}
              onClick={props.onClose}
            />
            <SettingsPanel />
          </div>
        </div>
      </section>
    </main>
  )
}
