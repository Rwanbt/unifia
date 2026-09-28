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
import { Show, type JSX } from "solid-js"
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
  /** Current workflow state (drives the status dot and the approval actions). */
  readonly state: RunBarState
  /** Optional error message surfaced from the last start / approval attempt. */
  readonly error?: string
  /** Disables Run / Validate while the file is still loading. */
  readonly definitionLoading?: boolean
  readonly onValidate?: () => void
  readonly onStart?: () => void
  readonly onAllow?: () => void
  readonly onDeny?: () => void
  readonly onCancel?: () => void
  /** Clears the last error so the run bar returns to Ready. */
  readonly onDismissError?: () => void
  /** Phones: Run and Stop collapse to their glyphs, like the reference. */
  readonly compact?: boolean
}

/**
 * Floating run bar of the flow (`.a60-runbar`, ADR-086): Validate, Test,
 * Run, Stop, the test fixture, the run status and the Work handoff. Test,
 * the fixture and → Work have no runtime yet, so they stay disabled and
 * labelled. The validation report lives in the debugger's Problems tab.
 */
export function AutomateStudioRunBar(props: AutomateStudioRunBarProps): JSX.Element {
  const language = useLanguage()
  const t = language.t
  const stateLabel = (): string => {
    switch (props.state) {
      case "idle":
        return t("automate.studio.run.ready")
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
  const soon = (label: string) => t("automate.studio.soon", { label })
  const canStart = (): boolean => props.state === "idle" && !props.definitionLoading
  const canApprove = (): boolean => props.state === "waiting-approval"
  return (
    <div data-automate-studio-run-bar data-automate-studio-run-bar-state={props.state}>
      <button
        type="button"
        data-automate-studio-run-bar-action="validate"
        disabled={props.definitionLoading}
        onClick={() => props.onValidate?.()}
      >
        {t("automate.studio.run.validate")}
      </button>
      <button type="button" data-automate-studio-run-bar-action="test" aria-disabled="true" title={soon(t("automate.studio.run.test"))}>
        {t("automate.studio.run.test")}
      </button>
      <button
        type="button"
        data-automate-studio-run-bar-action="start"
        data-primary
        disabled={!canStart()}
        aria-label={t("automate.studio.run.run")}
        onClick={() => props.onStart?.()}
      >
        {props.compact ? "▶" : `▶ ${t("automate.studio.run.run")}`}
      </button>
      <button
        type="button"
        data-automate-studio-run-bar-action="cancel"
        data-stop
        disabled={!canApprove()}
        aria-label={t("automate.studio.run.stop")}
        onClick={() => props.onCancel?.()}
      >
        {props.compact ? "■" : `■ ${t("automate.studio.run.stop")}`}
      </button>
      <button
        type="button"
        data-automate-studio-run-bar-fixture
        aria-disabled="true"
        title={soon(t("automate.studio.run.fixture"))}
        aria-label={soon(t("automate.studio.run.fixture"))}
      >
        <span>{t("automate.studio.run.noFixture")}</span>
        <i>⌄</i>
      </button>
      <span data-automate-studio-run-status={props.state} title={props.error ?? stateLabel()}>
        <i />
        <span>{stateLabel()}</span>
      </span>
      <Show when={props.error}>
        <button
          type="button"
          data-automate-studio-run-bar-dismiss
          title={t("workbench.automate.runBar.dismissError")}
          aria-label={t("workbench.automate.runBar.dismissError")}
          onClick={() => props.onDismissError?.()}
        >
          ×
        </button>
      </Show>
      <Show when={canApprove()}>
        <button type="button" data-automate-studio-run-bar-action="allow" onClick={() => props.onAllow?.()}>
          {t("workbench.automate.runBar.action.allow")}
        </button>
        <button type="button" data-automate-studio-run-bar-action="deny" onClick={() => props.onDeny?.()}>
          {t("workbench.automate.runBar.action.deny")}
        </button>
      </Show>
      <button type="button" data-automate-studio-run-bar-action="work" aria-disabled="true" title={soon(t("automate.studio.run.toWork"))}>
        → Work
      </button>
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
