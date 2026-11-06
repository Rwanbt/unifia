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

import { createEffect, createMemo, createSignal, For, onMount, Show, type JSX } from "solid-js"
import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { createStore, produce } from "solid-js/store"
import { TeamGraph, wavesFor, type TeamGraphTask } from "@unifia/ui/team-graph"
import { Button } from "@unifia/ui/button"
import { TextField } from "@unifia/ui/text-field"
import { Select } from "@unifia/ui/select"
import { Dialog } from "@unifia/ui/dialog"
import { TeamModelSelector } from "@/components/team-model-selector"
import { useLanguage } from "@/context/language"
import { useLocal } from "@/context/local"
import { closeModalOnBack } from "@/utils/modal-back"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useTeam } from "@/context/team"
import "./work-start-run.css"
import {
  emptyDraftBudget,
  emptyDraftTask,
  parseList,
  startRunErrorMessage,
  teamModelsReady,
  toStartRunPayload,
  validateDraft,
  validateBudget,
  shownDraftErrors,
  type DraftBudget,
  type DraftError,
  type DraftTask,
  type TaskMode,
  type TaskRisk,
} from "@/pages/workbench/work-start-run-form"

// A modal Select keeps its body portal accessible while the parent dialog hides outside content.
const FORM_SELECT = {
  variant: "secondary",
  size: "normal",
  triggerStyle: { width: "100%", "min-width": "0", "justify-content": "space-between" },
  modal: true,
} as const
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
    case "invalidBudget":
      return t(`workbench.work.startRun.validation.budget.${error.field}`)
  }
}

export function WorkStartRunDialog(props: WorkStartRunDialogProps): JSX.Element {
  const language = useLanguage()
  const t = language.t
  const team = useTeam()
  const local = useLocal()
  const sdk = useSDK()
  const sync = useSync()

  const [description, setDescription] = createSignal("")
  const [budget, setBudget] = createStore(emptyDraftBudget())
  const [malformed, setMalformed] = createStore({ maxCostUsd: false, maxTokens: false, maxParallel: false })
  const [tasks, setTasks] = createStore<DraftTask[]>([emptyDraftTask()])
  const [submitting, setSubmitting] = createSignal(false)
  const [submitError, setSubmitError] = createSignal("")
  const [touched, setTouched] = createStore({ description: false, tasks: false })
  createEffect(() => {
    if (!props.open) return
    setTouched({ description: false, tasks: false })
    setMalformed({ maxCostUsd: false, maxTokens: false, maxParallel: false })
  })
  closeModalOnBack(
    () => props.open,
    () => props.onOpenChange(false),
  )
  const [initializingGit, setInitializingGit] = createSignal(false)
  const [initializedDirectory, setInitializedDirectory] = createSignal("")
  const [headDirectory, setHeadDirectory] = createSignal("")
  const [checkingHead, setCheckingHead] = createSignal(false)
  const [gitError, setGitError] = createSignal("")
  let headRequest = 0
  createEffect(() => {
    const directory = sdk.directory
    const open = props.open
    headRequest += 1
    setHeadDirectory("")
    setCheckingHead(false)
    setGitError("")
    if (open) void checkGitHead(directory)
  })

  onMount(() => {
    if (!local.team.current()) void local.team.load().catch(() => undefined)
  })

  const agentOptions = createMemo(() => sync.data.agent.filter((agent) => !agent.hidden && !agent.app_hidden))
  const modelOptions = createMemo(() => local.team.current()?.models ?? [])
  const modelsReady = createMemo(() => teamModelsReady(modelOptions()))

  // git init creates an unborn branch; only a readable commit satisfies /team/runs.
  const gitReady = createMemo(() => headDirectory() === sdk.directory)
  const gitMissing = createMemo(
    () => sync.project !== undefined && sync.project.vcs !== "git" && initializedDirectory() !== sdk.directory,
  )

  const errors = createMemo(() => validateDraft(description(), tasks))
  const visible = createMemo(() => shownDraftErrors(touched, errors()))
  const budgetErrors = createMemo(() => [
    ...validateBudget(budget).map((error) => error.field),
    ...(["maxCostUsd", "maxTokens", "maxParallel"] as const).filter((field) => malformed[field]),
  ])
  // The server refuses to start without two distinct Team models and a Git
  // HEAD. The form used to enable "Démarrer" anyway, so the run could only
  // fail after the request. Keep every visible banner and the button in
  // agreement.
  const canSubmit = createMemo(
    () => errors().length === 0 && budgetErrors().length === 0 && modelsReady() && gitReady() && !submitting(),
  )

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

  function updateBudget(field: keyof DraftBudget, input: HTMLInputElement) {
    // Number inputs expose incomplete numbers as an empty value, even though the budget is not omitted.
    setMalformed(field, input.validity.badInput)
    setBudget(field, input.value)
  }

  async function checkGitHead(directory = sdk.directory) {
    const request = ++headRequest
    setHeadDirectory("")
    setCheckingHead(true)
    setGitError("")
    try {
      const response = await sdk.client.git.log({ directory, limit: "1" })
      if (request !== headRequest || directory !== sdk.directory || !props.open) return
      if (response.error) throw response.error
      if (response.data && response.data.length > 0) setHeadDirectory(directory)
    } catch (error) {
      if (request === headRequest && directory === sdk.directory && props.open)
        setGitError(startRunErrorMessage(error) || t("common.requestFailed"))
    } finally {
      if (request === headRequest) setCheckingHead(false)
    }
  }

  async function initializeGit() {
    if (initializingGit()) return
    const directory = sdk.directory
    const request = headRequest
    setInitializingGit(true)
    setGitError("")
    try {
      const response = await sdk.client.project.initGit({ directory })
      if (response.error) throw response.error
      if (request !== headRequest || directory !== sdk.directory || !props.open) return
      setInitializedDirectory(directory)
      await checkGitHead(directory)
    } catch (error) {
      if (request === headRequest && directory === sdk.directory && props.open)
        setGitError(startRunErrorMessage(error) || t("common.requestFailed"))
    } finally {
      setInitializingGit(false)
    }
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
      setMalformed({ maxCostUsd: false, maxTokens: false, maxParallel: false })
      setTasks([emptyDraftTask()])
    } catch (error) {
      setSubmitError(startRunErrorMessage(error) || t("workbench.work.startRun.error"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Kobalte modal open={props.open} onOpenChange={props.onOpenChange}>
      <Kobalte.Portal>
        <Kobalte.Overlay data-component="dialog-overlay" onClick={() => props.onOpenChange(false)} />
        <Dialog class="work-start-run-dialog" size="x-large" transition title={t("workbench.work.startRun.title")}>
          <div class="flex flex-col gap-6 px-5 pb-5" data-v110="work-start-run-dialog">
            <TextField
              multiline
              class="min-h-24"
              label={t("workbench.work.startRun.description.label")}
              data-v110="work-start-run-description"
              value={description()}
              onBlur={() => setTouched("description", true)}
              onInput={(event) => setDescription(event.currentTarget.value)}
            />

            <fieldset class="flex flex-col gap-2">
              <legend class="text-12-medium">{t("workbench.work.startRun.budget.title")}</legend>
              <div class="grid gap-3 sm:grid-cols-3">
                <TextField
                  validationState={budgetErrors().includes("maxCostUsd") ? "invalid" : undefined}
                  label={t("workbench.work.startRun.budget.maxCostUsd")}
                  type="number"
                  min="0"
                  step="any"
                  aria-invalid={budgetErrors().includes("maxCostUsd")}
                  value={budget.maxCostUsd}
                  onInput={(event) => updateBudget("maxCostUsd", event.currentTarget)}
                />
                <TextField
                  validationState={budgetErrors().includes("maxTokens") ? "invalid" : undefined}
                  label={t("workbench.work.startRun.budget.maxTokens")}
                  type="number"
                  min="1"
                  step="1"
                  aria-invalid={budgetErrors().includes("maxTokens")}
                  value={budget.maxTokens}
                  onInput={(event) => updateBudget("maxTokens", event.currentTarget)}
                />
                <TextField
                  validationState={budgetErrors().includes("maxParallel") ? "invalid" : undefined}
                  label={t("workbench.work.startRun.budget.maxParallel")}
                  type="number"
                  min="1"
                  max="50"
                  step="1"
                  aria-invalid={budgetErrors().includes("maxParallel")}
                  value={budget.maxParallel}
                  onInput={(event) => updateBudget("maxParallel", event.currentTarget)}
                />
              </div>
              <Show when={budgetErrors().length > 0}>
                <ul role="alert" class="text-11-regular text-text-on-critical-base" data-v110="work-start-run-budget-errors">
                  <For each={budgetErrors()}>
                    {(field) => (
                      <li>
                        {t(`workbench.work.startRun.budget.${field}`)}:{" "}
                        {field === "maxCostUsd" ? "> 0" : field === "maxTokens" ? "1, 2, 3, …" : "1–50"}
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </fieldset>

            <Show when={gitMissing()}>
              <div class="rounded-lg border border-border-weak-base p-3" data-v110="work-start-run-git">
                <p class="mb-2 text-12-regular text-text-weak">{t("session.review.noVcs")}</p>
                <Button
                  size="small"
                  variant="secondary"
                  disabled={initializingGit()}
                  onClick={() => void initializeGit()}
                >
                  {initializingGit()
                    ? t("session.review.noVcs.createGit.actionLoading")
                    : t("session.review.noVcs.createGit.action")}
                </Button>
                <Show when={gitError()}>
                  <p role="alert" class="mt-2 text-11-regular text-text-on-critical-base">
                    {gitError()}
                  </p>
                </Show>
              </div>
            </Show>

            <Show when={!gitReady() && !gitMissing()}>
              <div class="rounded-lg border border-border-weak-base p-3" data-v110="work-start-run-head">
                <p class="mb-2 text-12-regular text-text-weak">
                  {checkingHead()
                    ? t("dialog.server.add.checking")
                    : gitError() || t("workbench.work.startRun.gitHeadRequired")}
                </p>
                <Button size="small" variant="secondary" disabled={checkingHead()} onClick={() => void checkGitHead()}>
                  {t("common.retry")}
                </Button>
              </div>
            </Show>

            <Show when={!modelsReady()}>
              <div class="rounded-lg border border-border-weak-base p-3">
                <p class="mb-2 text-12-regular text-text-weak">{t("workbench.work.startRun.configureModels")}</p>
                <TeamModelSelector local={local} />
              </div>
            </Show>

            <div
              class="flex flex-col gap-2"
              data-v110="work-start-run-tasks"
              onFocusOut={() => setTouched("tasks", true)}
            >
              <div class="flex items-center justify-between">
                <h3 class="text-12-medium">{t("workbench.work.startRun.tasks.title")}</h3>
                <Button size="small" variant="ghost" onClick={addRow} data-v110="work-start-run-add-task">
                  {t("workbench.work.startRun.tasks.addRow")}
                </Button>
              </div>
              <For each={tasks}>
                {(row, index) => (
                  <div
                    class="flex flex-col gap-4 rounded-lg border border-border-weak-base p-3"
                    data-v110="work-start-run-task-row"
                  >
                    <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
                      <TextField
                        label={t("workbench.work.startRun.task.id")}
                        value={row.id}
                        onInput={(event) => updateRow(index(), "id", event.currentTarget.value)}
                      />
                      <TextField
                        label={t("workbench.work.startRun.task.description")}
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
                    <TextField
                      multiline
                      class="min-h-24"
                      label={t("workbench.work.startRun.task.prompt")}
                      value={row.prompt}
                      onInput={(event) => updateRow(index(), "prompt", event.currentTarget.value)}
                    />
                    <div class="grid grid-cols-2 gap-3">
                      <div data-v110="work-start-run-agent" class="flex flex-1 min-w-0">
                        <Select
                          options={["", ...agentOptions().map((agent) => agent.name)]}
                          current={row.agent}
                          placeholder={t("workbench.work.startRun.task.agent")}
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
                        placeholder={t("workbench.work.startRun.task.risk.none")}
                        label={(risk) => t(`workbench.work.startRun.task.risk.${risk || "none"}`)}
                        onSelect={(risk) => updateRow(index(), "risk", (risk ?? "") as TaskRisk)}
                        {...FORM_SELECT}
                      />
                      <div data-v110="work-start-run-model" class="flex min-w-0">
                        <Select
                          options={["", ...modelOptions().map((_, modelIndex) => String(modelIndex))]}
                          current={row.modelIndex === undefined ? "" : String(row.modelIndex)}
                          placeholder={t("workbench.work.startRun.task.modelNone")}
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
                    <div class="grid gap-3 sm:grid-cols-3">
                      <TextField
                        label={t("workbench.work.startRun.task.dependsOn")}
                        value={row.dependsOn}
                        onInput={(event) => updateRow(index(), "dependsOn", event.currentTarget.value)}
                      />
                      <TextField
                        label={t("workbench.work.startRun.task.readSet")}
                        value={row.readSet}
                        onInput={(event) => updateRow(index(), "readSet", event.currentTarget.value)}
                      />
                      <TextField
                        label={t("workbench.work.startRun.task.writeSet")}
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

            <Show when={visible().length > 0}>
              <ul class="flex flex-col gap-1" data-v110="work-start-run-errors">
                <For each={visible()}>
                  {(error) => (
                    <li role="alert" class="text-11-regular text-text-on-critical-base">
                      {describeDraftError(error, t)}
                    </li>
                  )}
                </For>
              </ul>
            </Show>

            <Show when={submitError()}>
              <p role="alert" class="text-11-regular text-text-on-critical-base">
                {submitError()}
              </p>
            </Show>

            <Button
              variant="primary"
              class="w-full"
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
