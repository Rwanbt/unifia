/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Studio environment — the read-only runtime overview pane.
 *
 * Phase 9.1: slice 1 of 2 (environment first, branches second). The
 * pane surfaces what the runtime actually exposes today — the
 * capability grants, the workspace id, the pending approvals,
 * and the recent workflow runs. No mutations: configure-the-
 * environment is out of scope (no runtime endpoint exists yet;
 * see M3-ACCEPTANCE-MATRIX.md Automate section "Phase 9+ scope"
 * note). The pane is the single source of truth for "what does
 * this workspace support right now".
 *
 * The component is fully controlled by the parent (AutomateSurface):
 * workspace id, grants set, approvals list, runs list. It does not
 * own any state. Click handlers (`onCancelRun`) are forwarded for
 * future Phase 9.2 work (branching) so the wiring is in place
 * before the branches runtime ships.
 */
import { For, Show, createMemo, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"

export type EnvironmentCapability = {
  readonly key: string
  readonly label: string
  readonly category: "workflow" | "design" | "workspace" | "system" | "other"
}

export type EnvironmentApproval = {
  readonly id: string
  readonly capability: string
  readonly resource: string
  readonly status: "pending" | "allow" | "deny" | "cancelled"
}

export type EnvironmentRun = {
  readonly id: string
  readonly definitionId: string
  readonly status: string
}

export type AutomateStudioEnvironmentProps = {
  readonly workspaceId: string
  readonly grants: ReadonlySet<string>
  readonly approvals: readonly EnvironmentApproval[]
  readonly runs: readonly EnvironmentRun[]
  readonly onCancelRun?: (runId: string) => void
}

/**
 * Static capability catalogue — every grant key the runtime can
 * issue. Used to render a stable order in the environment pane
 * (the grants set only contains *active* capabilities; this
 * catalogue lets us show "Available but not granted" rows).
 */
export const CAPABILITY_CATALOGUE: readonly EnvironmentCapability[] = [
  { key: "workflow.run", label: "Run workflows", category: "workflow" },
  { key: "workflow.publish", label: "Publish workflow drafts", category: "workflow" },
  { key: "design.create", label: "Create design systems", category: "design" },
  { key: "design.write", label: "Edit design systems", category: "design" },
  { key: "workspace.read", label: "Read workspace files", category: "workspace" },
  { key: "workspace.write", label: "Write workspace files", category: "workspace" },
  { key: "approval.read", label: "Read approvals", category: "system" },
  { key: "approval.write", label: "Resolve approvals", category: "system" },
  { key: "trace.read", label: "Read trace events", category: "system" },
]

export function AutomateStudioEnvironment(props: AutomateStudioEnvironmentProps): JSX.Element {
  const language = useLanguage()
  const t = language.t
  /**
   * Capabilities grouped by category. Active ones first, inactive
   * (in catalogue but not granted) shown below for transparency.
   */
  const groupedCapabilities = createMemo(() => {
    const active: EnvironmentCapability[] = []
    const inactive: EnvironmentCapability[] = []
    for (const entry of CAPABILITY_CATALOGUE) {
      if (props.grants.has(entry.key)) active.push(entry)
      else inactive.push(entry)
    }
    return { active, inactive }
  })
  const pendingApprovals = createMemo(() => props.approvals.filter((a) => a.status === "pending"))
  return (
    <aside
      class="flex h-full flex-col gap-3 overflow-auto rounded-lg border border-border-base bg-background-stronger p-3"
      data-automate-studio-environment
    >
      <header class="space-y-1">
        <h2 class="text-12-medium">{t("workbench.automate.environment.title")}</h2>
        <p class="font-mono text-11-regular text-text-weak" data-automate-studio-environment-workspace>
          {t("workbench.automate.environment.workspaceLabel", { id: props.workspaceId })}
        </p>
      </header>

      <section class="space-y-2" data-automate-studio-environment-section="capabilities">
        <h3 class="text-11-regular uppercase tracking-wide text-text-weak">
          {t("workbench.automate.environment.capabilities")}
        </h3>
        <ul class="space-y-1">
          <For each={groupedCapabilities().active}>
            {(cap) => (
              <li
                class="flex items-baseline justify-between gap-2 rounded border border-border-base bg-background-base px-2 py-1"
                data-automate-studio-environment-capability={cap.key}
                data-automate-studio-environment-capability-active="true"
              >
                <span class="text-12-regular">{cap.label}</span>
                <span class="font-mono text-11-regular text-text-weak">{cap.key}</span>
              </li>
            )}
          </For>
          <Show when={groupedCapabilities().inactive.length > 0}>
            <li class="pt-1 text-11-regular uppercase tracking-wide text-text-weak">
              {t("workbench.automate.environment.capabilitiesInactive")}
            </li>
            <For each={groupedCapabilities().inactive}>
              {(cap) => (
                <li
                  class="flex items-baseline justify-between gap-2 rounded border border-dashed border-border-weaker-base px-2 py-1 text-text-weak"
                  data-automate-studio-environment-capability={cap.key}
                  data-automate-studio-environment-capability-active="false"
                >
                  <span class="text-12-regular line-through">{cap.label}</span>
                  <span class="font-mono text-11-regular">{cap.key}</span>
                </li>
              )}
            </For>
          </Show>
        </ul>
      </section>

      <section class="space-y-2" data-automate-studio-environment-section="approvals">
        <h3 class="text-11-regular uppercase tracking-wide text-text-weak">
          {t("workbench.automate.environment.approvals")}
        </h3>
        <Show
          when={pendingApprovals().length > 0}
          fallback={
            <p class="text-12-regular text-text-weak" data-automate-studio-environment-approvals-empty>
              {t("workbench.automate.environment.approvalsEmpty")}
            </p>
          }
        >
          <ul class="space-y-1">
            <For each={pendingApprovals()}>
              {(approval) => (
                <li
                  class="rounded border border-border-base bg-background-base px-2 py-1 text-12-regular"
                  data-automate-studio-environment-approval={approval.id}
                >
                  <span class="font-mono">{approval.capability}</span>
                  <span class="ml-2 text-text-weak">{approval.resource}</span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>

      <section class="space-y-2" data-automate-studio-environment-section="runs">
        <h3 class="text-11-regular uppercase tracking-wide text-text-weak">
          {t("workbench.automate.environment.recentRuns")}
        </h3>
        <Show
          when={props.runs.length > 0}
          fallback={
            <p class="text-12-regular text-text-weak" data-automate-studio-environment-runs-empty>
              {t("workbench.automate.environment.runsEmpty")}
            </p>
          }
        >
          <ul class="space-y-1">
            <For each={props.runs}>
              {(run) => (
                <li
                  class="flex items-baseline justify-between gap-2 rounded border border-border-base bg-background-base px-2 py-1 text-12-regular"
                  data-automate-studio-environment-run={run.id}
                >
                  <span class="min-w-0 truncate font-mono">{run.definitionId}</span>
                  <span class="shrink-0 text-text-weak">{run.status}</span>
                  <Show when={props.onCancelRun}>
                    <button
                      type="button"
                      class="rounded border border-border-base px-2 py-0.5 text-11-regular hover:bg-background-stronger"
                      onClick={() => props.onCancelRun?.(run.id)}
                      data-automate-studio-environment-run-cancel
                    >
                      {t("workbench.automate.environment.cancel")}
                    </button>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>
    </aside>
  )
}
