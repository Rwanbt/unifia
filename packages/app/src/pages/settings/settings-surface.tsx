/* SPDX-License-Identifier: MIT */

import { SettingsPanel } from "@/components/dialog-settings"

// Settings is a workspace destination like the modes: the reference gives it
// no close button, the rail leaves it.
export function SettingsSurface() {
  return (
    <main data-v110="mode-main" data-component="workbench-mode-main" class="min-w-0 min-h-0 flex-1 flex">
      <section data-v110="surface-card" data-component="workbench-settings-surface" class="relative min-w-0 min-h-0 flex-1 flex flex-col">
        <div class="size-full min-h-0 overflow-hidden" data-workbench-surface="settings" data-parity="settings.surface">
          <SettingsPanel />
        </div>
      </section>
    </main>
  )
}
