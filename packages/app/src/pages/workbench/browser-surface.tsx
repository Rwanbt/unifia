/* SPDX-License-Identifier: MIT */

import { DesignBrowserTab } from "@/pages/workbench/design-browser-tab"

export function BrowserSurface() {
  return (
    <main data-v110="mode-main" data-component="workbench-mode-main" class="min-w-0 min-h-0 flex-1 flex">
      <section data-v110="surface-card" data-component="workbench-browser-surface" class="min-w-0 min-h-0 flex-1 flex flex-col overflow-hidden">
        <div class="size-full min-h-0 overflow-hidden" data-workbench-surface="browser" data-parity="browser.surface">
          <DesignBrowserTab />
        </div>
      </section>
    </main>
  )
}
