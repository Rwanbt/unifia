/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Studio run bar — the bottom-of-canvas action strip.
 *
 * Phase 8 slice 6: consolidates the four legacy inline buttons
 * (Start with approval, Allow, Deny, Cancel) into a single action
 * bar above the canvas + adds a fifth action — Validate, which
 * dry-runs the selected definition against the canonical
 * `parseWorkflowDefinition` and reports shape errors without
 * starting the workflow. The bar surfaces a state chip so the
 * user always knows whether the workflow is idle, waiting on
 * approval, running, cancelled, or failed.
 *
 * The component is controlled by the parent (AutomateSurface):
 * it does not own the workflow state, it only renders it. The
 * parent passes the state, an optional error message, and the
 * five action callbacks. This matches the controlled shape used
 * by the canvas (selection, positions, edges) and the library
 * (extraNodes) in slices 2-5.
 */
import { For, Show, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"

export type RunBarState =
  | "idle"
  | "waiting-approval"
  | "running"
  | "cancelled"
  | "failed"

export type ValidateReport = {
  readonly ok: boolean
  /** Human-readable lines: errors first, then warnings. */
  readonly lines: readonly { readonly severity: "error" | "warning"; readonly message: string }[]
}

export type AutomateStudioRunBarProps = {
  /** Current workflow state (drives the chip + button visibility). */
  readonly state: RunBarState
  /** Optional error message surfaced from the last start / approval attempt. */
  readonly error?: string
  /** Validate report (slice 6: re-parse the definition and list shape issues). */
  readonly validateReport?: ValidateReport
  /** Disables Start / Validate while the file is still loading. */
  readonly definitionLoading?: boolean
  /** The five action callbacks. The parent decides what each one does. */
  readonly onValidate?: () => void
  readonly onStart?: () => void
  readonly onAllow?: () => void
  readonly onDeny?: () => void
  readonly onCancel?: () => void
  readonly onDismissError?: () => void
  /** Slice 7: save the current visual state (positions + edges + extra nodes) to the workflow file as canonical v2. */
  readonly onSave?: () => void
  /** Slice 7: timestamp of the last successful save (for the "saved at HH:MM" chip). */
  readonly savedAt?: Date
  /** Slice 7: disable Save while a save is in flight (parallel-write safety). */
  readonly savePending?: boolean
}

export function AutomateStudioRunBar(props: AutomateStudioRunBarProps): JSX.Element {
  const language = useLanguage()
  const t = language.t
  const stateLabel = (): string => {
    switch (props.state) {
      case "idle":
        return t("workbench.automate.runBar.state.idle")
      case "waiting-approval":
        return t("workbench.automate.runBar.state.waitingApproval")
      case "running":
        return t("workbench.automate.runBar.state.running")
      case "cancelled":
        return t("workbench.automate.runBar.state.cancelled")
      case "failed":
        return t("workbench.automate.runBar.state.failed")
    }
  }
  const stateChipClass = (): string => {
    switch (props.state) {
      case "idle":
        return "bg-background-base text-text-weak"
      case "waiting-approval":
        return "bg-accent-weak text-accent-base"
      case "running":
        return "bg-accent-base text-text-strong"
      case "cancelled":
        return "bg-background-base text-text-weak line-through"
      case "failed":
        return "bg-background-base text-accent-base"
    }
  }
  const canStart = (): boolean => props.state === "idle" && !props.definitionLoading
  const canApprove = (): boolean => props.state === "waiting-approval"
  return (
    <div
      class="flex flex-col gap-2 rounded-lg border border-border-base bg-background-stronger px-3 py-2"
      data-automate-studio-run-bar
      data-state={props.state}
    >
      <div class="flex flex-wrap items-center gap-2">
        <span
          class={`rounded px-2 py-0.5 text-11-medium ${stateChipClass()}`}
          data-automate-studio-run-bar-state
          data-state-value={props.state}
        >
          {t("workbench.automate.runBar.stateLabel", { state: stateLabel() })}
        </span>
        <button
          type="button"
          class="rounded border border-border-base bg-background-base px-2 py-1 text-12-regular hover:bg-background-stronger disabled:opacity-50"
          disabled={props.definitionLoading}
          onClick={() => props.onValidate?.()}
          data-automate-studio-run-bar-action="validate"
        >
          {t("workbench.automate.runBar.action.validate")}
        </button>
        <button
          type="button"
          class="rounded border border-border-base bg-background-base px-2 py-1 text-12-regular hover:bg-background-stronger disabled:opacity-50"
          disabled={props.definitionLoading || props.savePending === true}
          onClick={() => props.onSave?.()}
          data-automate-studio-run-bar-action="save"
        >
          {props.savePending === true ? t("workbench.automate.runBar.action.saving") : t("workbench.automate.runBar.action.save")}
        </button>
        <Show when={props.savedAt}>
          <span class="text-11-regular text-text-weak" data-automate-studio-run-bar-saved-at>
            {t("workbench.automate.runBar.savedAt", { time: formatSavedAt(props.savedAt!) })}
          </span>
        </Show>
        <Show when={canStart()}>
          <button
            type="button"
            class="rounded border border-accent-base bg-accent-base px-2 py-1 text-12-medium text-text-strong hover:opacity-90 disabled:opacity-50"
            onClick={() => props.onStart?.()}
            data-automate-studio-run-bar-action="start"
          >
            {t("workbench.automate.runBar.action.start")}
          </button>
        </Show>
        <Show when={canApprove()}>
          <button
            type="button"
            class="rounded border border-accent-base bg-accent-weak px-2 py-1 text-12-medium hover:opacity-90"
            onClick={() => props.onAllow?.()}
            data-automate-studio-run-bar-action="allow"
          >
            {t("workbench.automate.runBar.action.allow")}
          </button>
          <button
            type="button"
            class="rounded border border-border-base bg-background-base px-2 py-1 text-12-regular hover:opacity-90"
            onClick={() => props.onDeny?.()}
            data-automate-studio-run-bar-action="deny"
          >
            {t("workbench.automate.runBar.action.deny")}
          </button>
          <button
            type="button"
            class="rounded border border-border-base bg-background-base px-2 py-1 text-12-regular hover:opacity-90"
            onClick={() => props.onCancel?.()}
            data-automate-studio-run-bar-action="cancel"
          >
            {t("workbench.automate.runBar.action.cancel")}
          </button>
        </Show>
        <Show when={props.error}>
          <button
            type="button"
            class="ml-auto rounded border border-border-base px-2 py-0.5 text-11-regular text-text-weak hover:bg-background-base"
            onClick={() => props.onDismissError?.()}
            aria-label={t("workbench.automate.runBar.dismissError")}
            data-automate-studio-run-bar-dismiss
          >
            {t("workbench.automate.runBar.dismiss")}
          </button>
        </Show>
      </div>
      <Show when={props.error}>
        <p class="text-11-regular text-accent-base" data-automate-studio-run-bar-error>
          {props.error}
        </p>
      </Show>
      <Show when={props.validateReport}>
        <div
          class="rounded border border-border-base bg-background-base p-2"
          data-automate-studio-run-bar-validate
          data-validate-ok={props.validateReport?.ok ? "true" : "false"}
        >
          <p class="text-11-medium text-text-strong">
            {props.validateReport?.ok
              ? t("workbench.automate.runBar.validateOk")
              : t("workbench.automate.runBar.validateFailed")}
          </p>
          <Show when={(props.validateReport?.lines.length ?? 0) > 0}>
            <ul class="mt-1 space-y-0.5">
              <For each={props.validateReport?.lines ?? []}>
                {(line) => (
                  <li
                    class={`text-11-regular ${line.severity === "error" ? "text-accent-base" : "text-text-weak"}`}
                    data-automate-studio-run-bar-validate-line={line.severity}
                  >
                    {line.message}
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </div>
      </Show>
    </div>
  )
}

/**
 * Pure validation helper: re-parses the currently-selected
 * definition's source text and lists shape issues without
 * starting the workflow. Pure on purpose — easy to unit-test and
 * safe to call repeatedly (the user can click Validate many
 * times before committing to Start).
 */
export function validateDefinition(source: string): ValidateReport {
  const lines: { severity: "error" | "warning"; message: string }[] = []
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch (error) {
    lines.push({
      severity: "error",
      message: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    })
    return { ok: false, lines }
  }
  if (!isRecord(parsed)) {
    lines.push({ severity: "error", message: "Definition root must be an object." })
    return { ok: false, lines }
  }
  if (typeof parsed.id !== "string" || parsed.id.length === 0) {
    lines.push({ severity: "error", message: 'Missing or empty "id" field.' })
  }
  if (parsed.version !== 1) {
    lines.push({
      severity: "error",
      message: `Unsupported version: ${JSON.stringify(parsed.version)} (expected 1).`,
    })
  }
  const steps = parsed.steps
  if (!Array.isArray(steps)) {
    lines.push({ severity: "error", message: 'Missing or non-array "steps" field.' })
  } else {
    if (steps.length === 0) {
      lines.push({ severity: "warning", message: "Definition has no steps — runtime will be a no-op." })
    }
    steps.forEach((step, index) => {
      if (!isRecord(step)) {
        lines.push({ severity: "error", message: `Step #${index + 1} is not an object.` })
        return
      }
      if (typeof step.id !== "string" || step.id.length === 0) {
        lines.push({ severity: "error", message: `Step #${index + 1} has no id.` })
      }
      const hasFamily = typeof step.family === "string" && step.family.length > 0
      const hasCapability = typeof step.capability === "string" && step.capability.length > 0
      if (!hasFamily && !hasCapability) {
        lines.push({
          severity: "warning",
          message: `Step #${index + 1} (${step.id ?? "?"}) has no family or capability — runtime will skip it.`,
        })
      }
    })
  }
  return { ok: lines.every((line) => line.severity !== "error"), lines }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Formats the savedAt timestamp as HH:MM in the local timezone. */
function formatSavedAt(date: Date): string {
  const hours = date.getHours().toString().padStart(2, "0")
  const minutes = date.getMinutes().toString().padStart(2, "0")
  return `${hours}:${minutes}`
}
