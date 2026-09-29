/* SPDX-License-Identifier: MIT */

import { MemoryPanel } from "@/pages/session/memory-panel"

export function MemorySurface() {
  return (
    <main data-v110="mode-main" data-component="workbench-mode-main" class="min-w-0 min-h-0 flex-1 flex">
      <section data-v110="surface-card" data-component="workbench-memory-surface" class="min-w-0 min-h-0 flex-1 flex flex-col overflow-hidden">
        <div class="size-full min-h-0 overflow-hidden" data-workbench-surface="memory" data-parity="memory.surface">
          <MemoryPanel />
        </div>
      </section>
    </main>
  )
}
