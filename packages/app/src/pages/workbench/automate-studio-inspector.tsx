/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Studio inspector — the right-side pane of the Automate studio.
 *
 * Phase 8 slice 2: when a node is selected in the canvas, this pane
 * surfaces its metadata (id, label, position in the pipeline,
 * approval flag). When nothing is selected, it shows an empty state
 * pointing the user at the canvas.
 *
 * The component is a pure view: it does not own selection state, it
 * only reads from the `node` prop. The parent (AutomateSurface) owns
 * the selection and passes both the selected `WorkflowStepSummary`
 * (or undefined for the empty state) and the `onClose` callback
 * that clears the selection. This matches the controlled pattern used
 * by `AutomateStudioCanvas`.
 */
import { Show, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import type { WorkflowStepSummary } from "./automate-workflow-model"

export type AutomateStudioInspectorProps = {
  /** Currently-selected step. `undefined` renders the empty state. */
  readonly node?: WorkflowStepSummary
  /** Zero-based position of the selected step in the source pipeline. */
  readonly index?: number
  /** Total step count in the source pipeline (for "step N of M"). */
  readonly total?: number
  /** Current effective x coordinate of the node (in graph units). */
  readonly x?: number
  /** Current effective y coordinate of the node (in graph units). */
  readonly y?: number
  /** Whether the position has been overridden by the user dragging the node. */
  readonly positionOverridden?: boolean
  /** Optional callback invoked when the user dismisses the inspector. */
  readonly onClose?: () => void
}

export function AutomateStudioInspector(props: AutomateStudioInspectorProps): JSX.Element {
  const language = useLanguage()
  const t = language.t
  return (
    <aside
      class="flex h-full flex-col rounded-lg border border-border-base bg-background-stronger"
      data-automate-studio-inspector
    >
      <header class="flex items-center justify-between border-b border-border-base px-3 py-2">
        <h2 class="text-12-medium">{t("workbench.automate.inspector.title")}</h2>
        <Show when={props.onClose}>
          <button
            type="button"
            class="rounded px-2 py-0.5 text-11-regular text-text-weak hover:bg-background-base"
            aria-label={t("workbench.automate.inspector.close")}
            onClick={() => props.onClose?.()}
          >
            {t("workbench.automate.inspector.close")}
          </button>
        </Show>
      </header>
      <Show
        when={props.node}
        fallback={
          <div
            class="flex flex-1 items-center justify-center px-3 py-6 text-center text-12-regular text-text-weak"
            data-automate-studio-inspector="empty"
          >
            {t("workbench.automate.inspector.empty")}
          </div>
        }
      >
        {(node) => (
          <div class="flex flex-1 flex-col gap-3 overflow-auto p-3 text-12-regular" data-automate-studio-inspector="selected">
            <section class="space-y-1">
              <p class="text-11-regular uppercase tracking-wide text-text-weak">
                {t("workbench.automate.inspector.field.id")}
              </p>
              <p class="font-mono text-12-medium" data-automate-studio-inspector-id={node().id}>
                {node().id}
              </p>
            </section>
            <section class="space-y-1">
              <p class="text-11-regular uppercase tracking-wide text-text-weak">
                {t("workbench.automate.inspector.field.label")}
              </p>
              <p class="text-12-regular">{node().label}</p>
            </section>
            <Show when={props.index !== undefined && props.total !== undefined}>
              <section class="space-y-1">
                <p class="text-11-regular uppercase tracking-wide text-text-weak">
                  {t("workbench.automate.inspector.field.position")}
                </p>
                <p class="text-12-regular" data-automate-studio-inspector-position>
                  {t("workbench.automate.inspector.positionValue", {
                    index: (props.index ?? 0) + 1,
                    total: props.total ?? 0,
                  })}
                </p>
              </section>
            </Show>
            <Show when={props.x !== undefined && props.y !== undefined}>
              <section class="space-y-1">
                <p class="text-11-regular uppercase tracking-wide text-text-weak">
                  {t("workbench.automate.inspector.field.coordinates")}
                </p>
                <p class="font-mono text-12-regular" data-automate-studio-inspector-coordinates>
                  {t("workbench.automate.inspector.coordinatesValue", {
                    x: Math.round(props.x ?? 0),
                    y: Math.round(props.y ?? 0),
                  })}
                  <Show when={props.positionOverridden}>
                    <span class="ml-2 text-11-regular text-accent-base">
                      {t("workbench.automate.inspector.coordinatesOverridden")}
                    </span>
                  </Show>
                </p>
              </section>
            </Show>
            <section class="space-y-1">
              <p class="text-11-regular uppercase tracking-wide text-text-weak">
                {t("workbench.automate.inspector.field.approval")}
              </p>
              <Show
                when={node().requiresApproval}
                fallback={
                  <p class="text-12-regular text-text-weak">{t("workbench.automate.inspector.approvalNo")}</p>
                }
              >
                <p
                  class="inline-flex items-center rounded bg-accent-weak px-2 py-0.5 text-11-medium"
                  data-automate-studio-inspector-approval="true"
                >
                  {t("workbench.automate.inspector.approvalYes")}
                </p>
              </Show>
            </section>
          </div>
        )}
      </Show>
    </aside>
  )
}
