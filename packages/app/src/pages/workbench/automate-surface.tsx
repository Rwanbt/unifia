/* SPDX-License-Identifier: MIT */

import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js"
import { createQuery } from "@tanstack/solid-query"
import { NodeFamilySchema } from "@unifia/contracts"
import { createIndexedDbWorkflowDraftStore } from "@unifia/workbench-shell"
import { useLanguage } from "@/context/language"
import { useWorkspaceWorkbench } from "@/context/workbench/provider"
import { workbenchQueryKey } from "@/context/workbench/query-keys"
import { useViewport } from "@/shell/v110-store"
import { WorkbenchChat } from "@/pages/workbench-chat"
import { ConnectionBanner } from "@/pages/workbench/connection-banner"
import { decodeFile, parseWorkflowDefinition } from "./automate-decode"
import { NODE_GAP_Y, NODE_HEIGHT, PADDING, type UserEdge } from "./automate-graph-layout"
import { validateGraphEdges, type GraphEdgeRef } from "./automate-graph-validation"
import { buildCanonicalFromState, serializeCanonical } from "./automate-migrate-legacy"
import { AutomateStudioEnvironment } from "./automate-studio-environment"
import { AutomateStudioLibrary, DEFAULT_LIBRARY_CATEGORIES } from "./automate-studio-library"
import { AutomateStudioRunBar, validateDefinition, type RunBarState, type ValidateReport } from "./automate-studio-run-bar"
import { AutomateStudioStepList } from "./automate-studio-step-list"
import { publishedDraftPath, summarizeWorkflowSteps } from "./automate-workflow-model"
import { AutomateStudioCanvas } from "./automate-studio-canvas"
import { AutomateStudioInspector } from "./automate-studio-inspector"

export function AutomateSurface(): JSX.Element {
  const language = useLanguage()
  const viewport = useViewport()
  // Slice 8.8: when the viewport is too narrow for the 3-column
  // studio, swap the SVG canvas for the step list and collapse the
  // library + inspector into accordions. The breakpoint mirrors
  // the existing `lg:` Tailwind boundary (RESPONSIVE-MATRIX.md).
  const isMobileLayout = createMemo(() => {
    const v = viewport()
    if (v === "phone-portrait" || v === "tablet-portrait" || v === "compact-landscape") return true
    return false
  })
  const t = language.t
  const workbench = useWorkspaceWorkbench()
  const connection = workbench.connection
  createEffect(() => { void workbench.ensureConnected().catch(() => undefined) })
  const definitionsQueryOptions = createMemo(() => {
    const current = connection()
    return { queryKey: workbenchQueryKey(current, "files", { prefix: ".unifia/workflows" }), enabled: !!current, queryFn: () => current!.client.listFiles(current!.workspaceId, ".unifia/workflows") }
  })
  const definitions = createQuery(definitionsQueryOptions)
  const workflowFiles = createMemo(() => definitions.data?.entries.filter((entry) => entry.kind === "file") ?? [])
  const workflowRunsQueryOptions = createMemo(() => {
    const current = connection()
    return { queryKey: workbenchQueryKey(current, "workflow-runs"), enabled: !!current, queryFn: () => current!.client.listWorkflows() }
  })
  const workflowRuns = createQuery(workflowRunsQueryOptions)
  const approvalsQueryOptions = createMemo(() => {
    const current = connection()
    return { queryKey: workbenchQueryKey(current, "approvals"), enabled: !!current, queryFn: () => current!.client.listApprovals(current!.workspaceId) }
  })
  const approvals = createQuery(approvalsQueryOptions)
  const [selectedDefinition, setSelectedDefinition] = createSignal<string>()
  const [workflowState, setWorkflowState] = createSignal<string>()
  const [workflowError, setWorkflowError] = createSignal<string>()
  const [approvalId, setApprovalId] = createSignal<string>()
  const [pendingDefinition, setPendingDefinition] = createSignal<Record<string, unknown>>()
  const [nodeFilter, setNodeFilter] = createSignal("")
  const [draftSource, setDraftSource] = createSignal("")
  const [draftRevision, setDraftRevision] = createSignal<number>()
  const [draftStatus, setDraftStatus] = createSignal("Published definition")
  const [selectedStepId, setSelectedStepId] = createSignal<string | undefined>()
  /** Override map (nodeId -> {x, y}) shared between canvas and inspector. */
  const [stepPositions, setStepPositions] = createSignal<Record<string, { readonly x: number; readonly y: number }>>({})
  /** User-added edges (slice 4 port connectors). */
  const [stepEdges, setStepEdges] = createSignal<readonly UserEdge[]>([])
  /** User-added nodes from the library (slice 5 node library). */
  const [extraNodes, setExtraNodes] = createSignal<readonly { readonly id: string; readonly label: string; readonly requiresApproval: boolean; readonly family?: string }[]>([])
  /** Slice 6: report from the last dry-run validate. */
  const [validateReport, setValidateReport] = createSignal<ValidateReport | undefined>()
  /** Slice 7: timestamp of the last successful canonical save. */
  const [savedAt, setSavedAt] = createSignal<Date | undefined>()
  /** Slice 7: parallel-write safety — disables the Save button while a save is in flight. */
  const [savePending, setSavePending] = createSignal(false)
  /** Phase 9.1: Environment pane visibility (slide-out). */
  const [showEnvironment, setShowEnvironment] = createSignal(false)
  createEffect(() => {
    if (!showEnvironment()) return
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setShowEnvironment(false) }
    document.addEventListener("keydown", onKey)
    onCleanup(() => document.removeEventListener("keydown", onKey))
  })
  const draftStore = createIndexedDbWorkflowDraftStore()
  let draftTimer: ReturnType<typeof setTimeout> | undefined
  let draftLoadEpoch = 0
  onCleanup(() => { if (draftTimer) clearTimeout(draftTimer) })
  const visibleNodeFamilies = createMemo(() => {
    const term = nodeFilter().trim().toLocaleLowerCase()
    return term ? NodeFamilySchema.options.filter((family) => family.includes(term)) : NodeFamilySchema.options
  })
  const definitionFileQueryOptions = createMemo(() => {
    const current = connection()
    const selectedPath = selectedDefinition()
    return { queryKey: workbenchQueryKey(current, "file", { path: selectedPath ?? "" }), enabled: !!current && !!selectedPath, queryFn: () => current!.client.readFiles(current!.workspaceId, [selectedPath!]) }
  })
  const definitionFile = createQuery(definitionFileQueryOptions)
  createEffect(() => {
    const current = connection()
    const path = selectedDefinition()
    const file = definitionFile.data?.results[0]
    if (!current || !path || !file) return
    const epoch = ++draftLoadEpoch
    const published = decodeFile(file)
    setDraftSource(published)
    setDraftRevision(undefined)
    setDraftStatus("Published definition")
    void draftStore.load(current.workspaceId, path).then((draft) => {
      if (epoch !== draftLoadEpoch || !draft) return
      setDraftSource(draft.source)
      setDraftRevision(draft.revision)
      setDraftStatus("Local draft restored")
    }).catch(() => {
      if (epoch === draftLoadEpoch) setDraftStatus("Local drafts unavailable")
    })
  })

  function updateDraftSource(source: string): void {
    const current = connection()
    const path = selectedDefinition()
    setDraftSource(source)
    if (!current || !path) return
    if (draftTimer) clearTimeout(draftTimer)
    draftTimer = setTimeout(() => {
      void draftStore.save(current.workspaceId, path, source, draftRevision()).then((draft) => {
        setDraftRevision(draft.revision)
        setDraftStatus("Local draft saved")
      }).catch(() => setDraftStatus("Local draft conflict — reload before editing"))
    }, 700)
  }

  async function publishDraft(): Promise<void> {
    const current = connection()
    const path = selectedDefinition()
    if (!current || !path) return
    const parsed = parseWorkflowDefinition(draftSource())
    if (parsed.kind === "error") {
      setWorkflowError(t("workbench.automate.invalidDefinition"))
      return
    }
    const targetPath = publishedDraftPath(path, new Date())
    try {
      await current.client.createFiles(current.workspaceId, [{ path: targetPath, content: draftSource() }])
      setSelectedDefinition(targetPath)
      setDraftStatus("Published as a new workflow file")
      setWorkflowError(undefined)
      await definitions.refetch()
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : t("workbench.automate.startFailed"))
    }
  }
  async function startDefinition(definition: Record<string, unknown>): Promise<void> {
    const current = connection()
    if (!current) return
    workbench.beginOperation()
    const result = await current.client.startWorkflow(current.workspaceId, definition)
    if ("approvalRequired" in result) {
      setApprovalId(result.approvalId)
      setPendingDefinition(definition)
      setWorkflowState("approval_required")
      return
    }
    setApprovalId(undefined)
    setPendingDefinition(undefined)
    setWorkflowState(result.state.status)
    setWorkflowError(undefined)
    void workflowRuns.refetch()
  }

  async function startSelectedWorkflow(): Promise<void> {
    const current = connection()
    const file = definitionFile.data?.results[0]
    if (!current || !file) return
    try {
      const parsed = parseWorkflowDefinition(draftSource() || decodeFile(file))
      if (parsed.kind === "error") throw new Error(t("workbench.automate.invalidDefinition"))
      const definition = { id: parsed.definition.id, version: parsed.definition.version, steps: parsed.definition.steps } as Record<string, unknown>
      await startDefinition(definition)
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : t("workbench.automate.startFailed"))
    }
  }
  async function resolveWorkflowApproval(decision: "allow" | "deny"): Promise<void> {
    const current = connection()
    const id = approvalId()
    if (!current || !id) return
    try {
      const result = await current.client.resolveApproval(id, decision)
      if (decision === "allow" && result.decision.kind === "allow" && pendingDefinition()) await startDefinition(pendingDefinition()!)
      else {
        setApprovalId(undefined)
        setPendingDefinition(undefined)
        setWorkflowState(result.decision.kind)
      }
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : t("workbench.automate.approvalFailed"))
    }
  }
  async function cancelWorkflowApproval(): Promise<void> {
    const current = connection()
    const id = approvalId()
    if (!current || !id) return
    try {
      await current.client.cancelApproval(id)
      setApprovalId(undefined)
      setPendingDefinition(undefined)
      setWorkflowState("cancelled")
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : t("workbench.automate.cancelFailed"))
    }
  }
  /**
   * Phase 9 slice 2: the dry-run re-parse proves the JSON shape; the
   * graph pass then checks the topology the author drew (cycles,
   * duplicated branch kinds, branch edges out of non-branching
   * families) against the same expectations the runtime enforces.
   */
  function augmentValidateReport(report: ValidateReport, source: string): ValidateReport {
    const parsedNow = parseWorkflowDefinition(source)
    if (parsedNow.kind !== "ok") return report
    const all = [...summarizeWorkflowSteps(parsedNow.definition), ...extraNodes()]
    const nodes = all.map((entry) => ({ id: entry.id, family: entry.family }))
    const edges: GraphEdgeRef[] = []
    all.forEach((entry, index) => {
      const previous = all[index - 1]
      if (previous) edges.push({ from: previous.id, to: entry.id, kind: "flow" })
    })
    edges.push(...stepEdges())
    const lines = [...report.lines]
    for (const issue of validateGraphEdges(nodes, edges)) {
      if (issue.code === "cycle") {
        lines.push({ severity: "error", message: t("workbench.automate.runBar.validateCycle", { path: issue.path.join(" -> ") }) })
      } else if (issue.code === "duplicate-branch") {
        lines.push({ severity: "error", message: t("workbench.automate.runBar.validateDuplicateBranch", { from: issue.from, kind: issue.kind }) })
      } else {
        lines.push({ severity: "error", message: t("workbench.automate.runBar.validateBranchNonBranching", { from: issue.from, kind: issue.kind }) })
      }
    }
    const added = lines.slice(report.lines.length)
    return { ok: report.ok && added.every((line) => line.severity !== "error"), lines }
  }
  return (
    <section class="size-full overflow-auto p-6 md:p-10" data-workbench-surface="automate" data-v110="automate-surface" data-parity="automate.surface">
      <div class="mx-auto max-w-5xl space-y-8">
        <header class="space-y-2">
          <p class="text-12-medium uppercase tracking-wide text-text-weak">{t("workbench.automate.title")}</p>
          <h1 class="text-24-medium">{t("workbench.automate.heading")}</h1>
          <p class="max-w-2xl text-14-regular text-text-weak">{t("workbench.automate.description")}</p>
        </header>
        <WorkbenchChat
          mode="automate"
          prompt={t("workbench.automate.chatPrompt")}
          description={t("workbench.automate.chatDescription")}
        />
        <ConnectionBanner dataAttr="automate-connection" dataRetryAttr="automate-retry" />
        <section class="rounded-lg border border-border-base bg-background-stronger p-4" data-automate-node-library>
          <div class="flex flex-wrap items-baseline justify-between gap-3"><div><h2 class="text-14-medium">Node library</h2><p class="mt-1 text-12-regular text-text-weak">Families available in the connected workflow runtime.</p></div><input class="rounded border border-border-base bg-background-base px-2 py-1 text-12-regular" value={nodeFilter()} onInput={(event) => setNodeFilter(event.currentTarget.value)} placeholder="Search nodes" aria-label="Search workflow nodes" /></div>
          <div class="mt-3 flex flex-wrap gap-2"><For each={visibleNodeFamilies()}>{(family) => <span class="rounded border border-border-base bg-background-base px-2 py-1 text-12-regular">{family}</span>}</For></div>
        </section>
        <Show when={definitions.error}>
          <p data-automate-definitions="failed" class="text-14-regular text-text-danger">{definitions.error instanceof Error ? definitions.error.message : String(definitions.error)}</p>
        </Show>
        <Show when={workflowFiles().length > 0}>
          <ul class="space-y-2" data-automate-definition-count={workflowFiles().length}>
            <For each={workflowFiles()}>
              {(entry) => (
                <li class="rounded-lg border border-border-base bg-background-stronger p-4" data-automate-definition={entry.path}>
                  <div class="flex items-center justify-between gap-3"><span>{entry.path}</span><button type="button" class="rounded border border-border-base px-2 py-1 text-12-medium" onClick={() => { setSelectedDefinition(entry.path); setSelectedStepId(undefined); setWorkflowError(undefined); setExtraNodes([]) }}>{t("workbench.automate.inspect")}</button></div>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={selectedDefinition()}>
          <div class="rounded-lg border border-border-base bg-background-stronger p-4" data-automate-selected={selectedDefinition()}>
            <p class="text-12-regular text-text-weak">{t("workbench.automate.selectedDescription")}</p>
            <Show when={definitionFile.data?.results[0]}>
              {(file) => {
                const parsed = parseWorkflowDefinition(draftSource() || decodeFile(file()))
                return (
                  <div class="mt-3 rounded border border-border-weaker-base bg-background-base p-3" data-automate-definition-preview={parsed.kind}>
                    <Show when={parsed.kind === "ok"} fallback={<p class="text-12-regular text-text-danger">{t("workbench.automate.invalidDefinition")}</p>}>
                      <nav class="flex items-baseline gap-1 text-12-regular" data-automate-studio-breadcrumb aria-label={t("workbench.automate.breadcrumb.label")}>
                        <span class="text-text-weak">{t("workbench.automate.breadcrumb.workspace")}</span>
                        <span class="text-text-weak" aria-hidden="true">›</span>
                        <span class="text-text-weak">{t("workbench.automate.breadcrumb.automate")}</span>
                        <span class="text-text-weak" aria-hidden="true">›</span>
                        <span class="font-mono text-12-medium text-text-strong">{parsed.kind === "ok" ? parsed.definition.id : ""}</span>
                      </nav>
                      <p class="text-12-regular text-text-weak">v{parsed.kind === "ok" ? parsed.definition.version : ""} · {parsed.kind === "ok" ? parsed.definition.steps.length : 0} steps</p>
                      <Show when={parsed.kind === "ok" && parsed.definition.steps.length > 0}>
                        {(() => {
                          if (parsed.kind !== "ok") return null
                          const steps = summarizeWorkflowSteps(parsed.definition)
                          const positions = stepPositions()
                          const userEdgeList = stepEdges()
                          const extraNodeList = extraNodes()
                          const allSteps = [...steps, ...extraNodeList]
                          const totalSteps = allSteps.length
                          // Re-index selection against the merged list so the Inspector
                          // can target both legacy steps AND user-added nodes.
                          const mergedSelectedIndex = (() => {
                            const id = selectedStepId()
                            if (!id) return undefined
                            const index = allSteps.findIndex((step) => step.id === id)
                            return index >= 0 ? index : undefined
                          })()
                          const mergedSelectedStep =
                            mergedSelectedIndex !== undefined ? allSteps[mergedSelectedIndex] : undefined
                          const selectedOverride = mergedSelectedStep ? positions[mergedSelectedStep.id] : undefined
                          const selectedX = selectedOverride?.x ?? PADDING
                          const selectedY =
                            selectedOverride?.y ??
                            (mergedSelectedIndex !== undefined ? PADDING + mergedSelectedIndex * (NODE_HEIGHT + NODE_GAP_Y) : undefined)
                          const outgoingTo = mergedSelectedStep
                            ? userEdgeList.filter((edge) => edge.from === mergedSelectedStep.id).map((edge) => edge.to)
                            : []
                          const incomingFrom = mergedSelectedStep
                            ? userEdgeList.filter((edge) => edge.to === mergedSelectedStep.id).map((edge) => edge.from)
                            : []
                          return (
                            <div class="mt-3 grid gap-3 lg:grid-cols-[16rem_minmax(0,1fr)_18rem]">
                              <div class="h-72 lg:h-[28rem]">
                                <Show
                                  when={!isMobileLayout()}
                                  fallback={
                    <details class="rounded-lg border border-border-base bg-background-stronger" data-automate-studio-library-accordion>
                      <summary class="cursor-pointer px-3 py-2 text-12-medium">{t("workbench.automate.library.title")}</summary>
                      <div class="px-3 pb-3">
                        <AutomateStudioLibrary
                          categories={DEFAULT_LIBRARY_CATEGORIES}
                          onAdd={(entry) => {
                            const id = `${entry.family.split(".")[0] ?? "node"}-${extraNodeList.length + 1}-${Date.now().toString(36)}`
                            const newNode = {
                              id,
                              label: entry.label,
                              requiresApproval: entry.family === "human.approval",
                              family: entry.family,
                            }
                            setExtraNodes([...extraNodeList, newNode])
                            setSelectedStepId(id)
                          }}
                        />
                      </div>
                    </details>
                  }
                >
                  <AutomateStudioLibrary
                    categories={DEFAULT_LIBRARY_CATEGORIES}
                    onAdd={(entry) => {
                      const id = `${entry.family.split(".")[0] ?? "node"}-${extraNodeList.length + 1}-${Date.now().toString(36)}`
                      const newNode = {
                        id,
                        label: entry.label,
                        requiresApproval: entry.family === "human.approval",
                        family: entry.family,
                      }
                      setExtraNodes([...extraNodeList, newNode])
                      setSelectedStepId(id)
                    }}
                  />
                </Show>
                              </div>
                              <div class="h-72 lg:h-[28rem]">
                                <Show
                                  when={!isMobileLayout()}
                                  fallback={
                                    <AutomateStudioStepList
                                      steps={allSteps}
                                      selectedStepId={selectedStepId()}
                                      onSelectStep={setSelectedStepId}
                                      positions={positions}
                                    />
                                  }
                                >
                                  <AutomateStudioCanvas
                                    steps={allSteps}
                                    definitionId={parsed.definition.id}
                                    width={640}
                                    height={448}
                                    selectedNodeId={selectedStepId()}
                                    onSelectNode={setSelectedStepId}
                                    positions={positions}
                                    onPositionsChange={setStepPositions}
                                    edges={userEdgeList}
                                    onEdgesChange={setStepEdges}
                                  />
                                </Show>
                              </div>
                              <div class="h-72 lg:h-[28rem]">
                                <AutomateStudioInspector
                                  node={mergedSelectedStep}
                                  index={mergedSelectedIndex}
                                  total={totalSteps}
                                  x={selectedX}
                                  y={selectedY}
                                  positionOverridden={selectedOverride !== undefined}
                                  outgoingTo={outgoingTo}
                                  incomingFrom={incomingFrom}
                                  userEdgeCount={userEdgeList.length}
                                  onClose={() => setSelectedStepId(undefined)}
                                />
                              </div>
                            </div>
                          )
                        })()}
                      </Show>
                    </Show>
                  </div>
                )
              }}
            </Show>
            <Show when={definitionFile.data?.results[0]}>
              {(file) => <details class="mt-3 rounded border border-border-base bg-background-base p-3"><summary class="cursor-pointer text-12-medium">Local draft</summary><p class="mt-2 text-11-regular text-text-weak">{draftStatus()}</p><textarea class="mt-3 h-48 w-full resize-y rounded border border-border-base bg-background-stronger p-2 font-mono text-11-regular leading-5" value={draftSource()} onInput={(event) => updateDraftSource(event.currentTarget.value)} aria-label="Edit local workflow draft" /><div class="mt-2 flex flex-wrap gap-2"><button type="button" class="rounded border border-border-base px-2 py-1 text-11-medium" onClick={() => updateDraftSource(decodeFile(file()))}>Reset to published</button><button type="button" class="rounded border border-border-base px-2 py-1 text-11-medium" onClick={() => void publishDraft()}>Publish as new file</button></div></details>}
            </Show>
            <div class="mt-3">
              <AutomateStudioRunBar
                state={(() => {
                  if (workflowError()) return "failed"
                  if (approvalId()) return "waiting-approval"
                  if (workflowState() === "cancelled") return "cancelled"
                  if (workflowState()) return "running"
                  return "idle"
                })() as RunBarState}
                error={workflowError()}
                validateReport={validateReport()}
                definitionLoading={definitionFile.isLoading}
                onValidate={() => {
                  const source = draftSource() || (definitionFile.data?.results[0] ? decodeFile(definitionFile.data.results[0]) : "")
                  if (!source) {
                    setValidateReport({ ok: false, lines: [{ severity: "error", message: t("workbench.automate.runBar.validateEmpty") }] })
                    return
                  }
                  setValidateReport(augmentValidateReport(validateDefinition(source), source))
                }}
                onStart={() => void startSelectedWorkflow()}
                onAllow={() => void resolveWorkflowApproval("allow")}
                onDeny={() => void resolveWorkflowApproval("deny")}
                onCancel={() => void cancelWorkflowApproval()}
                onDismissError={() => setWorkflowError(undefined)}
                onSave={() => {
                  if (savePending()) return
                  const parsedNow = parseWorkflowDefinition(draftSource() || (definitionFile.data?.results[0] ? decodeFile(definitionFile.data.results[0]) : ""))
                  if (parsedNow.kind !== "ok") return
                  setSavePending(true)
                  try {
                    const canonical = buildCanonicalFromState({
                      legacy: parsedNow.definition,
                      positions: stepPositions(),
                      userEdges: stepEdges(),
                      extraNodes: extraNodes(),
                    })
                    const serialized = serializeCanonical(canonical)
                    setDraftSource(serialized)
                    setSavedAt(new Date())
                    setValidateReport({ ok: true, lines: [{ severity: "warning", message: t("workbench.automate.runBar.saveMigratedWarning") }] })
                  } finally {
                    setSavePending(false)
                  }
                }}
                savedAt={savedAt()}
                savePending={savePending()}
                onShowEnvironment={() => setShowEnvironment(true)}
              />
            </div>
          </div>
        </Show>
        <Show when={!definitions.isLoading && !definitions.error && workflowFiles().length === 0}>
          <p data-automate-definitions="empty" class="text-14-regular text-text-weak">{t("workbench.automate.noDefinitions")}</p>
        </Show>
        <section class="rounded-lg border border-border-base bg-background-stronger p-4" data-automate-runs>
          <div class="flex items-baseline justify-between gap-3"><h2 class="text-14-medium">Recent runs</h2><button type="button" class="text-12-regular text-text-weak underline" disabled={workflowRuns.isFetching} onClick={() => void workflowRuns.refetch()}>Refresh</button></div>
          <Show when={workflowRuns.error}><p class="mt-2 text-12-regular text-text-danger">Unable to load run history.</p></Show>
          <Show when={!workflowRuns.isLoading && !workflowRuns.error && workflowRuns.data?.workflows.length === 0}><p class="mt-2 text-12-regular text-text-weak">No durable workflow run for this workspace.</p></Show>
          <ul class="mt-3 space-y-2"><For each={workflowRuns.data?.workflows ?? []}>{(run) => <li class="flex items-center justify-between gap-3 rounded border border-border-weaker-base bg-background-base px-3 py-2 text-12-regular"><span class="min-w-0 truncate">{run.definitionId}</span><span class="shrink-0 text-text-weak">{run.status}</span></li>}</For></ul>
        </section>
      </div>
      <Show when={showEnvironment()}>
        <div
          class="fixed inset-0 z-20 flex justify-end bg-background-base/60"
          data-automate-studio-environment-overlay
        >
          <div class="h-full w-full max-w-sm overflow-auto border-l border-border-base bg-background-stronger p-4 shadow-xl">
            <div class="mb-3 flex items-center justify-between">
              <h2 class="text-14-medium">{t("workbench.automate.environment.drawerTitle")}</h2>
              <button
                type="button"
                class="rounded border border-border-base bg-background-base px-2 py-0.5 text-11-regular hover:bg-background-stronger"
                onClick={() => setShowEnvironment(false)}
                aria-label={t("workbench.automate.environment.close")}
                data-automate-studio-environment-close
              >
                {t("workbench.automate.environment.close")}
              </button>
            </div>
            <div class="h-[calc(100%-3rem)]">
              <AutomateStudioEnvironment
                workspaceId={connection()?.workspaceId ?? ""}
                grants={workbench.grants()}
                approvals={approvals.data?.approvals ?? []}
                runs={(workflowRuns.data?.workflows ?? []).map((run) => ({
                  id: run.workflowId,
                  definitionId: run.definitionId,
                  status: run.status,
                }))}
                onCancelRun={(runId) => {
                  const current = connection()
                  if (!current) return
                  void current.client.updateWorkflow(runId, "cancel").then(() => workflowRuns.refetch()).catch(() => undefined)
                }}
              />
            </div>
          </div>
        </div>
      </Show>
    </section>
  )
}
