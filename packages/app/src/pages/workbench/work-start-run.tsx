/* SPDX-License-Identifier: MIT */

// =============================================================================
// pages/workbench/work-start-run.tsx — A5-06
//
// The "start a new run" form: the first real write path this workstream
// adds (sdk.client.team.startRun via context/team.tsx's new lifecycle.start).
// Local Kobalte dialog root, matching work-runs-panel.tsx's established
// pattern — not the shared <DialogOutlet/>, which is broken for Team content
// (issue #82) because it renders outside TeamProvider's scope.
//
// Agent field: a real dropdown over the unfiltered agent list (hidden/
// app_hidden excluded, subagents included per product decision — a Team
// task is exactly the autonomous-execution case subagents exist for, unlike
// the chat composer's @agent popover which reasonably excludes them).
// Model field: a real dropdown over the user's saved Team model selection
// (context/local.tsx's local.team, the same data team-model-selector.tsx
// already manages) — embeds that exact component as a "configure models
// first" prompt when fewer than two are configured, rather than sending the
// user away mid-flow.
// =============================================================================

import { createMemo, createSignal, For, onMount, Show, type JSX } from "solid-js"
import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { createStore, produce } from "solid-js/store"
import { TeamGraph, wavesFor, type TeamGraphTask } from "@unifia/ui/team-graph"
import { Button } from "@unifia/ui/button"
import { Select } from "@unifia/ui/select"
import { Dialog } from "@unifia/ui/dialog"
import { TeamModelSelector } from "@/components/team-model-selector"
import { useLanguage } from "@/context/language"
import { useLocal } from "@/context/local"
import { useSync } from "@/context/sync"
import { useTeam } from "@/context/team"
import {
  emptyDraftBudget,
  emptyDraftTask,
  parseList,
  toStartRunPayload,
  validateDraft,
  type DraftError,
  type DraftTask,
  type TaskMode,
  type TaskRisk,
} from "@/pages/workbench/work-start-run-form"

// A modal Select keeps its body portal accessible while the parent dialog hides outside content.
const FORM_SELECT = { variant: "secondary", size: "small", triggerVariant: "settings", modal: true } as const
const RISKS = ["", "low", "medium", "high", "critical"]

export interface WorkStartRunDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}

function describeDraftError(error: DraftError, t: (key: string, params?: Record<string, string>) => string): string {
  switch (error.kind) {
    case "descriptionRequired":
      return t("workbench.work.startRun.validation.descriptionRequired")
    case "noTasks":
      return t("workbench.work.startRun.validation.noTasks")
    case "missingFields":
      return t("workbench.work.startRun.validation.missingFields", { id: error.id })
    case "duplicateId":
      return t("workbench.work.startRun.validation.duplicateId", { id: error.id })
    case "selfDependency":
      return t("workbench.work.startRun.validation.selfDependency", { id: error.id })
    case "unknownDependency":
      return t("workbench.work.startRun.validation.unknownDependency", { id: error.id, dependsOn: error.dependsOn })
    case "cycle":
      return t("workbench.work.startRun.validation.cycle")
  }
}

export function WorkStartRunDialog(props: WorkStartRunDialogProps): JSX.Element {
  const language = useLanguage()
  const t = language.t
  const team = useTeam()
  const local = useLocal()
  const sync = useSync()

  const [description, setDescription] = createSignal("")
  const [budget, setBudget] = createStore(emptyDraftBudget())
  const [tasks, setTasks] = createStore<DraftTask[]>([emptyDraftTask()])
  const [submitting, setSubmitting] = createSignal(false)
  const [submitError, setSubmitError] = createSignal("")

  onMount(() => {
    if (!local.team.current()) void local.team.load().catch(() => undefined)
  })

  const agentOptions = createMemo(() => sync.data.agent.filter((agent) => !agent.hidden && !agent.app_hidden))
  const modelOptions = createMemo(() => local.team.current()?.models ?? [])

  const errors = createMemo(() => validateDraft(description(), tasks))
  const canSubmit = createMemo(() => errors().length === 0 && !submitting())

  const previewTasks = createMemo<TeamGraphTask[]>(() =>
    tasks
      .filter((task) => task.id.trim().length > 0)
      .map((task) => ({ taskId: task.id.trim(), status: "pending", dependsOn: parseList(task.dependsOn) })),
  )

  function addRow() {
    setTasks(produce((current) => current.push(emptyDraftTask())))
  }

  function removeRow(index: number) {
    setTasks(produce((current) => current.splice(index, 1)))
  }

  function updateRow<K extends keyof DraftTask>(index: number, key: K, value: DraftTask[K]) {
    setTasks(index, key, value)
  }

  async function submit() {
    if (!canSubmit()) return
    setSubmitting(true)
    setSubmitError("")
    try {
      const payload = toStartRunPayload(description(), budget, tasks)
      await team.lifecycle.start(payload)
      props.onOpenChange(false)
      setDescription("")
      setBudget(emptyDraftBudget())
      setTasks([emptyDraftTask()])
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t("workbench.work.startRun.error"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Kobalte modal open={props.open} onOpenChange={props.onOpenChange}>
      <Kobalte.Portal>
        <Kobalte.Overlay data-component="dialog-overlay" onClick={() => props.onOpenChange(false)} />
        <Dialog size="x-large" transition title={t("workbench.work.startRun.title")}>
          <div class="flex flex-col gap-4" data-v110="work-start-run-dialog">
            <label class="flex flex-col gap-1 text-12-regular">
              {t("workbench.work.startRun.description.label")}
              <textarea
                class="rounded border border-border-base bg-background-base p-2"
                data-v110="work-start-run-description"
                value={description()}
                onInput={(event) => setDescription(event.currentTarget.value)}
              />
            </label>

            <fieldset class="flex flex-col gap-2">
              <legend class="text-12-medium">{t("workbench.work.startRun.budget.title")}</legend>
              <div class="flex gap-2">
                <input
                  type="number"
                  class="w-1/3 rounded border border-border-base bg-background-base p-2 text-12-regular"
                  placeholder={t("workbench.work.startRun.budget.maxCostUsd")}
                  value={budget.maxCostUsd}
                  onInput={(event) => setBudget("maxCostUsd", event.currentTarget.value)}
                />
                <input
                  type="number"
                  class="w-1/3 rounded border border-border-base bg-background-base p-2 text-12-regular"
                  placeholder={t("workbench.work.startRun.budget.maxTokens")}
                  value={budget.maxTokens}
                  onInput={(event) => setBudget("maxTokens", event.currentTarget.value)}
                />
                <input
                  type="number"
                  class="w-1/3 rounded border border-border-base bg-background-base p-2 text-12-regular"
                  placeholder={t("workbench.work.startRun.budget.maxParallel")}
                  value={budget.maxParallel}
                  onInput={(event) => setBudget("maxParallel", event.currentTarget.value)}
                />
              </div>
            </fieldset>

            <Show when={modelOptions().length < 2}>
              <div class="rounded border border-border-weak-base p-2">
                <p class="mb-2 text-12-regular text-text-weak">{t("workbench.work.startRun.configureModels")}</p>
                <TeamModelSelector local={local} />
              </div>
            </Show>

            <div class="flex flex-col gap-2" data-v110="work-start-run-tasks">
              <div class="flex items-center justify-between">
                <h3 class="text-12-medium">{t("workbench.work.startRun.tasks.title")}</h3>
                <Button size="small" variant="ghost" onClick={addRow} data-v110="work-start-run-add-task">
                  {t("workbench.work.startRun.tasks.addRow")}
                </Button>
              </div>
              <For each={tasks}>
                {(row, index) => (
                  <div
                    class="flex flex-col gap-2 rounded border border-border-weak-base p-2"
                    data-v110="work-start-run-task-row"
                  >
                    <div class="flex gap-2">
                      <input
                        class="w-1/4 rounded border border-border-base bg-background-base p-1 text-12-regular"
                        placeholder={t("workbench.work.startRun.task.id")}
                        value={row.id}
                        onInput={(event) => updateRow(index(), "id", event.currentTarget.value)}
                      />
                      <input
                        class="flex-1 rounded border border-border-base bg-background-base p-1 text-12-regular"
                        placeholder={t("workbench.work.startRun.task.description")}
                        value={row.description}
                        onInput={(event) => updateRow(index(), "description", event.currentTarget.value)}
                      />
                      <Button
                        size="small"
                        variant="ghost"
                        onClick={() => removeRow(index())}
                        data-v110="work-start-run-remove-task"
                      >
                        {t("workbench.work.startRun.tasks.removeRow")}
                      </Button>
                    </div>
                    <textarea
                      class="rounded border border-border-base bg-background-base p-1 text-12-regular"
                      placeholder={t("workbench.work.startRun.task.prompt")}
                      value={row.prompt}
                      onInput={(event) => updateRow(index(), "prompt", event.currentTarget.value)}
                    />
                    <div class="flex gap-2">
                      <div data-v110="work-start-run-agent" class="flex flex-1 min-w-0">
                        <Select
                          options={["", ...agentOptions().map((agent) => agent.name)]}
                          current={row.agent}
                          label={(name) => name || t("workbench.work.startRun.task.agent")}
                          onSelect={(name) => updateRow(index(), "agent", name ?? "")}
                          {...FORM_SELECT}
                        />
                      </div>
                      <Select
                        options={["read", "write"] as TaskMode[]}
                        current={row.mode}
                        label={(mode) => t(`workbench.work.startRun.task.mode.${mode}`)}
                        onSelect={(mode) => mode && updateRow(index(), "mode", mode)}
                        {...FORM_SELECT}
                      />
                      <Select
                        options={RISKS}
                        current={row.risk ?? ""}
                        label={(risk) => t(`workbench.work.startRun.task.risk.${risk || "none"}`)}
                        onSelect={(risk) => updateRow(index(), "risk", (risk ?? "") as TaskRisk)}
                        {...FORM_SELECT}
                      />
                      <div data-v110="work-start-run-model" class="flex">
                        <Select
                          options={["", ...modelOptions().map((_, modelIndex) => String(modelIndex))]}
                          current={row.modelIndex === undefined ? "" : String(row.modelIndex)}
                          label={(value) => {
                            const model = value === "" ? undefined : modelOptions()[Number(value)]
                            return model
                              ? `${model.providerID}/${model.modelID}`
                              : t("workbench.work.startRun.task.modelNone")
                          }}
                          onSelect={(value) =>
                            updateRow(
                              index(),
                              "modelIndex",
                              value === undefined || value === "" ? undefined : Number(value),
                            )
                          }
                          {...FORM_SELECT}
                        />
                      </div>
                    </div>
                    <div class="flex gap-2">
                      <input
                        class="flex-1 rounded border border-border-base bg-background-base p-1 text-12-regular"
                        placeholder={t("workbench.work.startRun.task.dependsOn")}
                        value={row.dependsOn}
                        onInput={(event) => updateRow(index(), "dependsOn", event.currentTarget.value)}
                      />
                      <input
                        class="flex-1 rounded border border-border-base bg-background-base p-1 text-12-regular"
                        placeholder={t("workbench.work.startRun.task.readSet")}
                        value={row.readSet}
                        onInput={(event) => updateRow(index(), "readSet", event.currentTarget.value)}
                      />
                      <input
                        class="flex-1 rounded border border-border-base bg-background-base p-1 text-12-regular"
                        placeholder={t("workbench.work.startRun.task.writeSet")}
                        value={row.writeSet}
                        onInput={(event) => updateRow(index(), "writeSet", event.currentTarget.value)}
                      />
                    </div>
                  </div>
                )}
              </For>
            </div>

            <Show when={previewTasks().length > 0}>
              <TeamGraph label={t("team.graph.label")} waves={wavesFor(previewTasks())} tasks={previewTasks()} />
            </Show>

            <Show when={errors().length > 0}>
              <ul class="flex flex-col gap-1" data-v110="work-start-run-errors">
                <For each={errors()}>
                  {(error) => (
                    <li role="alert" class="text-11-regular text-text-danger">
                      {describeDraftError(error, t)}
                    </li>
                  )}
                </For>
              </ul>
            </Show>

            <Show when={submitError()}>
              <p role="alert" class="text-11-regular text-text-danger">
                {submitError()}
              </p>
            </Show>

            <Button
              variant="primary"
              disabled={!canSubmit()}
              onClick={() => void submit()}
              data-v110="work-start-run-submit"
            >
              {submitting() ? t("workbench.work.startRun.submitting") : t("workbench.work.startRun.submit")}
            </Button>
          </div>
        </Dialog>
      </Kobalte.Portal>
    </Kobalte>
  )
}
