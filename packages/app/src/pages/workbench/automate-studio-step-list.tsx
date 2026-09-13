/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Studio step list — the mobile/responsive fallback for the
 * Automate canvas.
 *
 * Phase 8 slice 8: when the viewport is too narrow to render the
 * full 3-column studio (library + canvas + inspector), the
 * surface swaps the SVG canvas for this vertical list view.
 * The list preserves the visual hierarchy (nodes stack top-to-
 * bottom, sequential flow between them) without paying the cost
 * of pan/zoom + SVG hit-testing on small screens.
 *
 * The list is fully controlled: the surface passes `steps` (the
 * merged legacy + extraNodes list), `selectedStepId`,
 * `onSelectStep`, and the `positions` / `extraNodes` info
 * needed for the badges. The component renders a button per
 * step with:
 * - the step id in monospace
 * - the label
 * - an "approval required" chip when `requiresApproval` is true
 * - a "(dragged)" marker when the position has been overridden
 *
 * No DOM-level interactivity beyond click. No drag, no pan, no
 * ports — those are desktop-only via the canvas. The screen
 * reader can navigate the list naturally (it's an `<ol>` of
 * buttons with `aria-pressed` for the selected state).
 */
import { For, Show, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import type { WorkflowStepSummary } from "./automate-workflow-model"

export type AutomateStudioStepListProps = {
  readonly steps: readonly WorkflowStepSummary[]
  readonly selectedStepId?: string
  readonly onSelectStep?: (id: string) => void
  readonly positions: Readonly<Record<string, { readonly x: number; readonly y: number }>>
}

export function AutomateStudioStepList(props: AutomateStudioStepListProps): JSX.Element {
  const language = useLanguage()
  const t = language.t
  return (
    <ol class="flex flex-col gap-1" data-automate-studio-step-list>
      <For each={props.steps}>
        {(step, index) => {
          const isSelected = (): boolean => props.selectedStepId === step.id
          const isOverridden = (): boolean => props.positions[step.id] !== undefined
          return (
            <li>
              <button
                type="button"
                class="flex w-full flex-col items-start gap-1 rounded border border-border-base bg-background-stronger px-3 py-2 text-left hover:bg-background-base focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-base"
                aria-pressed={isSelected()}
                onClick={() => props.onSelectStep?.(step.id)}
                data-automate-studio-step-list-entry={step.id}
                data-automate-studio-step-list-entry-selected={isSelected() ? "true" : "false"}
                data-automate-studio-step-list-entry-family={step.family}
              >
                <div class="flex w-full items-baseline justify-between gap-2">
                  <span class="font-mono text-12-medium text-text-strong">
                    {index() + 1}. {step.id}
                  </span>
                  <Show when={step.requiresApproval}>
                    <span
                      class="rounded bg-accent-weak px-2 py-0.5 text-11-regular"
                      data-automate-studio-step-list-approval="true"
                    >
                      {t("workbench.automate.canvas.approvalTag")}
                    </span>
                  </Show>
                </div>
                <span class="text-12-regular text-text-weak">{step.label}</span>
                <Show when={step.family}>
                  <span class="font-mono text-11-regular text-text-weak">{step.family}</span>
                </Show>
                <Show when={isOverridden()}>
                  <span class="text-11-regular text-accent-base">
                    {t("workbench.automate.inspector.coordinatesOverridden")}
                  </span>
                </Show>
              </button>
            </li>
          )
        }}
      </For>
      <Show when={props.steps.length === 0}>
        <li class="rounded border border-border-base bg-background-stronger px-3 py-4 text-center text-12-regular text-text-weak" data-automate-studio-step-list-empty>
          {t("workbench.automate.canvas.empty")}
        </li>
      </Show>
    </ol>
  )
}
