/* SPDX-License-Identifier: MIT */

// =============================================================================
// pages/workbench/work-health-chip.tsx — issue #100 (v65 health chip)
//
// The header chip the v65 mockup shows next to the Work title. It renders
// the classification from work-health.ts; the labels are the mockup's three
// states, translated, so the chip only ever reports a real run/task/gate
// fact. The dot colour follows the mockup's success / warning / danger
// convention.
// =============================================================================

import type { JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { WORK_HEALTH_I18N_KEY, type WorkHealth } from "./work-health"

export interface WorkHealthChipProps {
  readonly health: WorkHealth
}

const DOT_CLASS: Record<WorkHealth, string> = {
  ok: "bg-background-success",
  risk: "bg-background-warning",
  off: "bg-background-danger",
}

export function WorkHealthChip(props: WorkHealthChipProps): JSX.Element {
  const language = useLanguage()
  const t = language.t

  return (
    <span
      class="flex shrink-0 items-center gap-2 rounded-full border border-border-base bg-background-stronger px-3 py-1 text-12-medium text-text-weak"
      data-v110="work-health"
      data-work-health={props.health}
    >
      <span class={`size-2 rounded-full ${DOT_CLASS[props.health]}`} />
      {t(WORK_HEALTH_I18N_KEY[props.health] as Parameters<typeof t>[0])}
    </span>
  )
}
