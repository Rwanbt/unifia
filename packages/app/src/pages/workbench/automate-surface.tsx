/* SPDX-License-Identifier: MIT */

import { Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js"
import { createQuery } from "@tanstack/solid-query"
import { createIndexedDbWorkflowDraftStore } from "@unifia/workbench-shell"
import { useLanguage } from "@/context/language"
import { useWorkspaceWorkbench } from "@/context/workbench/provider"
import { workbenchQueryKey } from "@/context/workbench/query-keys"
import { useViewport } from "@/shell/v110-store"
import { ConnectionBanner } from "@/pages/workbench/connection-banner"
import { decodeFile, parseWorkflowDefinition } from "./automate-decode"
import { EMPTY_GRAPH, graphFromSource, runnableSteps, sourceWithGraph, type ExtraNode, type GraphState } from "./automate-graph-draft"
import { layoutWorkflowSteps } from "./automate-graph-layout"
import { validateGraphEdges, type GraphEdgeRef } from "./automate-graph-validation"
import { AutomateStudioCanvas } from "./automate-studio-canvas"
import { AutomateStudioDebug, type AutomateDebugTab, type AutomateStudioLogLine } from "./automate-studio-debug"
import { AutomateStudioEnvironment } from "./automate-studio-environment"
import { AutomateStudioHeader } from "./automate-studio-header"
import { AutomateStudioInspector } from "./automate-studio-inspector"
import { AutomateStudioLibrary, DEFAULT_LIBRARY_CATEGORIES, type LibraryEntry } from "./automate-studio-library"
import { runBarState } from "./automate-run-state"
import { AutomateStudioRunBar, validateDefinition, type RunBarState, type ValidateReport } from "./automate-studio-run-bar"
import { publishedDraftPath, summarizeWorkflowSteps } from "./automate-workflow-model"

const WORKFLOW_DIR = ".unifia/workflows"
const DRAFT_SAVE_DELAY_MS = 700
/** Consecutive position updates closer than this belong to one drag (one undo step). */
const DRAG_COALESCE_MS = 400
/** Session log kept in the debugger's Logs tab. */
const MAX_LOG_LINES = 200

type DraftStatus = "published" | "restored" | "saved" | "unavailable" | "conflict" | "publishedNew"

/** Published versions of a workflow are its append-only `.draft-*` siblings. */
function versionsOf(files: readonly string[], path: string | undefined): readonly string[] {
  if (!path) return []
  const base = path.replace(/\.draft-\d+\.json$/i, ".json").replace(/\.json$/i, "")
  return files.filter((file) => file !== path && file.startsWith(`${base}.draft-`)).sort().reverse()
}

/**
 * Automate surface: the reference's flow studio (ADR-086). Header, node
 * library, flow canvas with run bar, minimap and zoom, then the debugger.
 * The workspace's `.unifia/workflows` files are the only source of truth;
 * edits live in the local draft store until Publish writes a new file.
 */
export function AutomateSurface(): JSX.Element {
  const language = useLanguage()
  const t = language.t
  const viewport = useViewport()
  const narrow = createMemo(() => {
    const family = viewport()
    return family === "phone-portrait" || family === "tablet-portrait" || family === "compact-landscape"
  })
  const workbench = useWorkspaceWorkbench()
  const connection = workbench.connection
  createEffect(() => {
    void workbench.ensureConnected().catch(() => undefined)
  })

  const definitions = createQuery(() => {
    const current = connection()
    return {
      queryKey: workbenchQueryKey(current, "files", { prefix: WORKFLOW_DIR }),
      enabled: !!current,
      queryFn: () => current!.client.listFiles(current!.workspaceId, WORKFLOW_DIR),
    }
  })
  const workflowRuns = createQuery(() => {
    const current = connection()
    return { queryKey: workbenchQueryKey(current, "workflow-runs"), enabled: !!current, queryFn: () => current!.client.listWorkflows() }
  })
  const approvals = createQuery(() => {
    const current = connection()
    return {
      queryKey: workbenchQueryKey(current, "approvals"),
      enabled: !!current,
      queryFn: () => current!.client.listApprovals(current!.workspaceId),
    }
  })
  const workflowFiles = createMemo(() =>
    (definitions.data?.entries ?? []).filter((entry) => entry.kind === "file").map((entry) => entry.path),
  )
  const mainFiles = createMemo(() => workflowFiles().filter((path) => !/\.draft-\d+\.json$/i.test(path)))

  const [selectedDefinition, setSelectedDefinition] = createSignal<string>()
  const [workflowState, setWorkflowState] = createSignal<string>()
  const [workflowError, setWorkflowError] = createSignal<string>()
  const [approvalId, setApprovalId] = createSignal<string>()
  const [activeRunId, setActiveRunId] = createSignal<string>()
  const [pendingDefinition, setPendingDefinition] = createSignal<Record<string, unknown>>()
  const [draftSource, setDraftSource] = createSignal("")
  const [draftRevision, setDraftRevision] = createSignal<number>()
  const [draftStatus, setDraftStatus] = createSignal<DraftStatus>("published")
  const [selectedStepId, setSelectedStepId] = createSignal<string | undefined>()
  const [graph, setGraph] = createSignal<GraphState>(EMPTY_GRAPH)
  const [past, setPast] = createSignal<readonly GraphState[]>([])
  const [future, setFuture] = createSignal<readonly GraphState[]>([])
  const [validateReport, setValidateReport] = createSignal<ValidateReport | undefined>()
  const [showEnvironment, setShowEnvironment] = createSignal(false)
  const [libraryOpen, setLibraryOpen] = createSignal(true)
  const [nodesSheetOpen, setNodesSheetOpen] = createSignal(false)
  const [debugTab, setDebugTab] = createSignal<AutomateDebugTab>("runs")
  const [debugCollapsed, setDebugCollapsed] = createSignal(false)
  const [debugOpenOnPhone, setDebugOpenOnPhone] = createSignal(false)
  const [logs, setLogs] = createSignal<readonly AutomateStudioLogLine[]>([])

  const log = (level: AutomateStudioLogLine["level"], message: string) =>
    setLogs((lines) => [...lines, { at: new Date(), level, message }].slice(-MAX_LOG_LINES))
  const fail = (error: unknown, fallbackKey: string) => {
    const message = error instanceof Error ? error.message : t(fallbackKey)
    setWorkflowError(message)
    log("error", message)
  }

  createEffect(() => {
    if (!showEnvironment()) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowEnvironment(false)
    }
    document.addEventListener("keydown", onKey)
    onCleanup(() => document.removeEventListener("keydown", onKey))
  })

  // The studio always shows a workflow: the first file opens by default.
  // Only when nothing is open — a file just published is selected before the
  // listing refetch reports it.
  createEffect(() => {
    const first = mainFiles()[0]
    if (!selectedDefinition() && first) openDefinition(first)
  })

  const draftStore = createIndexedDbWorkflowDraftStore()
  let draftTimer: ReturnType<typeof setTimeout> | undefined
  let draftLoadEpoch = 0
  let lastGraphEdit = { kind: "", at: 0 }
  onCleanup(() => {
    if (draftTimer) clearTimeout(draftTimer)
  })

  const definitionFile = createQuery(() => {
    const current = connection()
    const path = selectedDefinition()
    return {
      queryKey: workbenchQueryKey(current, "file", { path: path ?? "" }),
      enabled: !!current && !!path,
      queryFn: () => current!.client.readFiles(current!.workspaceId, [path!]),
    }
  })
  const publishedSource = createMemo(() => {
    const file = definitionFile.data?.results[0]
    return file ? decodeFile(file) : ""
  })
  createEffect(() => {
    const current = connection()
    const path = selectedDefinition()
    const published = publishedSource()
    if (!current || !path || !definitionFile.data?.results[0]) return
    const epoch = ++draftLoadEpoch
    setDraftSource(published)
    setGraph(graphFromSource(published) ?? EMPTY_GRAPH)
    setDraftRevision(undefined)
    setDraftStatus("published")
    void draftStore
      .load(current.workspaceId, path)
      .then((draft) => {
        if (epoch !== draftLoadEpoch || !draft) return
        setDraftSource(draft.source)
        setGraph(graphFromSource(draft.source) ?? EMPTY_GRAPH)
        setDraftRevision(draft.revision)
        setDraftStatus("restored")
      })
      .catch(() => {
        if (epoch === draftLoadEpoch) setDraftStatus("unavailable")
      })
  })

  const parsed = createMemo(() => parseWorkflowDefinition(draftSource() || publishedSource()))
  const definition = createMemo(() => {
    const result = parsed()
    return result.kind === "ok" ? result.definition : undefined
  })
  const allSteps = createMemo<readonly ExtraNode[]>(() => {
    const current = definition()
    return current ? [...summarizeWorkflowSteps(current), ...graph().extraNodes] : graph().extraNodes
  })
  const dirty = createMemo(() => !!selectedDefinition() && draftSource() !== "" && draftSource() !== publishedSource())

  function openDefinition(path: string): void {
    setSelectedDefinition(path)
    setSelectedStepId(undefined)
    setWorkflowError(undefined)
    setValidateReport(undefined)
    setGraph(EMPTY_GRAPH)
    setPast([])
    setFuture([])
  }

  /** One undo step per discrete edit; a drag's stream of moves collapses into one. */
  function editGraph(kind: "positions" | "edges" | "nodes", next: GraphState): void {
    const now = Date.now()
    const sameDrag = kind === "positions" && lastGraphEdit.kind === "positions" && now - lastGraphEdit.at < DRAG_COALESCE_MS
    if (!sameDrag) {
      setPast((stack) => [...stack, graph()])
      setFuture([])
    }
    lastGraphEdit = { kind, at: now }
    applyGraph(next)
  }
  /** The drawn graph is part of the draft: every change lands there, so Publish and Run see it. */
  function applyGraph(next: GraphState): void {
    setGraph(next)
    updateDraftSource(sourceWithGraph(draftSource() || publishedSource(), next))
  }
  function undo(): void {
    const stack = past()
    const previous = stack.at(-1)
    if (!previous) return
    setFuture((redo) => [graph(), ...redo])
    setPast(stack.slice(0, -1))
    applyGraph(previous)
  }
  function redo(): void {
    const [next, ...rest] = future()
    if (!next) return
    setPast((stack) => [...stack, graph()])
    setFuture(rest)
    applyGraph(next)
  }

  function addNode(entry: LibraryEntry): void {
    const current = graph()
    const id = `${entry.family.split(".")[0] ?? "node"}-${current.extraNodes.length + 1}-${Date.now().toString(36)}`
    const node: ExtraNode = { id, label: entry.label, requiresApproval: entry.family === "human.approval", family: entry.family }
    editGraph("nodes", { ...current, extraNodes: [...current.extraNodes, node] })
    setSelectedStepId(id)
    setNodesSheetOpen(false)
  }

  function updateDraftSource(source: string): void {
    const current = connection()
    const path = selectedDefinition()
    setDraftSource(source)
    if (!current || !path) return
    if (draftTimer) clearTimeout(draftTimer)
    draftTimer = setTimeout(() => {
      void draftStore
        .save(current.workspaceId, path, source, draftRevision())
        .then((draft) => {
          setDraftRevision(draft.revision)
          setDraftStatus("saved")
        })
        .catch(() => setDraftStatus("conflict"))
    }, DRAFT_SAVE_DELAY_MS)
  }

  /** The JSON tab edits the draft text: the drawn graph follows it whenever the text is readable. */
  function replaceDraft(source: string): void {
    updateDraftSource(source)
    const drawn = graphFromSource(source)
    if (drawn) setGraph(drawn)
  }

  async function writeWorkflow(path: string, content: string): Promise<void> {
    const current = connection()
    if (!current) return
    await current.client.createFiles(current.workspaceId, [{ path, content }])
    await definitions.refetch()
    openDefinition(path)
  }

  async function createWorkflow(): Promise<void> {
    const id = `workflow-${Date.now().toString(36)}`
    try {
      await writeWorkflow(`${WORKFLOW_DIR}/${id}.json`, `${JSON.stringify({ id, version: 1, steps: [] }, null, 2)}\n`)
      log("info", t("automate.studio.log.created", { id }))
    } catch (error) {
      fail(error, "workbench.automate.startFailed")
    }
  }

  async function importWorkflow(file: File): Promise<void> {
    const source = await file.text()
    const result = parseWorkflowDefinition(source)
    if (result.kind === "error") {
      fail(new Error(t("workbench.automate.invalidDefinition")), "workbench.automate.invalidDefinition")
      return
    }
    const target = `${WORKFLOW_DIR}/${result.definition.id}.json`
    const path = workflowFiles().includes(target) ? publishedDraftPath(target, new Date()) : target
    try {
      await writeWorkflow(path, source)
      log("info", t("automate.studio.log.imported", { path }))
    } catch (error) {
      fail(error, "workbench.automate.startFailed")
    }
  }

  function exportWorkflow(): void {
    const source = draftSource() || publishedSource()
    const path = selectedDefinition()
    if (!source || !path) return
    const url = URL.createObjectURL(new Blob([source], { type: "application/json" }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = path.split("/").at(-1) ?? "workflow.json"
    anchor.click()
    URL.revokeObjectURL(url)
  }

  async function publishDraft(): Promise<void> {
    const current = connection()
    const path = selectedDefinition()
    if (!current || !path) return
    if (parseWorkflowDefinition(draftSource()).kind === "error") {
      fail(new Error(t("workbench.automate.invalidDefinition")), "workbench.automate.invalidDefinition")
      return
    }
    const targetPath = publishedDraftPath(path, new Date())
    try {
      await current.client.createFiles(current.workspaceId, [{ path: targetPath, content: draftSource() }])
      setSelectedDefinition(targetPath)
      setDraftStatus("publishedNew")
      setWorkflowError(undefined)
      log("info", t("automate.studio.log.published", { path: targetPath }))
      await definitions.refetch()
    } catch (error) {
      fail(error, "workbench.automate.startFailed")
    }
  }

  async function startDefinition(body: Record<string, unknown>): Promise<void> {
    const current = connection()
    if (!current) return
    workbench.beginOperation()
    const result = await current.client.startWorkflow(current.workspaceId, body)
    if ("approvalRequired" in result) {
      setApprovalId(result.approvalId)
      setPendingDefinition(body)
      setWorkflowState("approval_required")
      log("info", t("automate.studio.log.approval"))
      return
    }
    setApprovalId(undefined)
    setPendingDefinition(undefined)
    setWorkflowState(result.state.status)
    setActiveRunId(result.state.workflowId)
    setWorkflowError(undefined)
    log("info", t("automate.studio.log.started", { status: result.state.status }))
    void workflowRuns.refetch()
  }

  async function startSelectedWorkflow(): Promise<void> {
    try {
      const result = parseWorkflowDefinition(draftSource() || publishedSource())
      if (result.kind === "error") throw new Error(t("workbench.automate.invalidDefinition"))
      const { id, version, steps } = result.definition
      await startDefinition({ id, version, steps: runnableSteps(steps, graph().extraNodes) } as Record<string, unknown>)
    } catch (error) {
      fail(error, "workbench.automate.startFailed")
    }
  }

  async function resolveWorkflowApproval(decision: "allow" | "deny"): Promise<void> {
    const current = connection()
    const id = approvalId()
    if (!current || !id) return
    try {
      const result = await current.client.resolveApproval(id, decision)
      log("info", t("automate.studio.log.resolved", { decision }))
      if (decision === "allow" && result.decision.kind === "allow" && pendingDefinition()) await startDefinition(pendingDefinition()!)
      else {
        setApprovalId(undefined)
        setPendingDefinition(undefined)
        setWorkflowState(result.decision.kind)
      }
    } catch (error) {
      fail(error, "workbench.automate.approvalFailed")
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
      log("info", t("automate.studio.log.cancelled"))
    } catch (error) {
      fail(error, "workbench.automate.cancelFailed")
    }
  }

  async function stopWorkflow(): Promise<void> {
    if (approvalId()) return cancelWorkflowApproval()
    const current = connection()
    const runId = activeRunId()
    if (!current || !runId) return
    try {
      const result = await current.client.updateWorkflow(runId, "cancel")
      setWorkflowState(result.state.status)
      log("info", t("automate.studio.log.cancelled"))
      await workflowRuns.refetch()
    } catch (error) {
      fail(error, "workbench.automate.cancelFailed")
    }
  }

  /**
   * Phase 9 slice 2: the dry-run re-parse proves the JSON shape; the graph
   * pass then checks the topology the author drew (cycles, duplicated branch
   * kinds, branch edges out of non-branching families) against the same
   * expectations the runtime enforces.
   */
  function augmentValidateReport(report: ValidateReport): ValidateReport {
    const all = allSteps()
    const nodes = all.map((entry) => ({ id: entry.id, family: entry.family }))
    const edges: GraphEdgeRef[] = []
    all.forEach((entry, index) => {
      const previous = all[index - 1]
      if (previous) edges.push({ from: previous.id, to: entry.id, kind: "flow" })
    })
    edges.push(...graph().edges)
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

  function validate(): void {
    const source = draftSource() || publishedSource()
    const report = source
      ? augmentValidateReport(validateDefinition(source, t))
      : { ok: false, lines: [{ severity: "error" as const, message: t("workbench.automate.runBar.validateEmpty") }] }
    setValidateReport(report)
    setDebugTab("problems")
    setDebugCollapsed(false)
    log(report.ok ? "info" : "error", t(report.ok ? "workbench.automate.runBar.validateOk" : "workbench.automate.runBar.validateFailed"))
  }

  /** Writes the drawn graph into the draft now (it is also written on every edit). */
  function saveGraphToDraft(): void {
    updateDraftSource(sourceWithGraph(draftSource() || publishedSource(), graph()))
    setValidateReport(undefined)
  }

  const runState = createMemo<RunBarState>(() =>
    runBarState({ error: workflowError(), approvalId: approvalId(), workflowState: workflowState() }),
  )

  const selectedNode = createMemo(() => {
    const id = selectedStepId()
    const steps = allSteps()
    const index = id ? steps.findIndex((step) => step.id === id) : -1
    if (index < 0) return undefined
    const laidOut = layoutWorkflowSteps(steps).nodes[index]
    const override = graph().positions[steps[index]!.id]
    return {
      node: steps[index]!,
      index,
      x: override?.x ?? laidOut?.x,
      y: override?.y ?? laidOut?.y,
      overridden: override !== undefined,
      outgoing: graph().edges.filter((edge) => edge.from === id).map((edge) => edge.to),
      incoming: graph().edges.filter((edge) => edge.to === id).map((edge) => edge.from),
    }
  })

  const versionLine = createMemo(() => {
    const current = definition()
    if (!current) return ""
    return t("automate.studio.versionLine", { version: String(current.version), count: String(allSteps().length) })
  })

  const library = (onCollapse: () => void) => (
    <AutomateStudioLibrary categories={DEFAULT_LIBRARY_CATEGORIES} onAdd={addNode} onCollapse={onCollapse} />
  )

  return (
    <main data-v110="mode-main" data-component="workbench-mode-main" class="min-w-0 min-h-0 flex-1 flex">
      <section data-v110="surface-card" data-component="workbench-automate-surface" class="min-w-0 min-h-0 flex-1 flex flex-col">
        <section
          data-v110="automate-studio"
          data-workbench-surface="automate"
          data-parity="automate.surface"
          data-automate-studio-layout={narrow() ? "single" : "studio"}
          data-automate-studio-library-state={!narrow() && libraryOpen() ? "open" : "closed"}
          data-automate-studio-debug-state={narrow() ? (debugOpenOnPhone() ? "open" : "closed") : debugCollapsed() ? "collapsed" : "open"}
        >
          <AutomateStudioHeader
            name={definition()?.id}
            versionLine={versionLine()}
            dirty={dirty()}
            saveState={t(`automate.studio.draft.${draftStatus()}`)}
            files={mainFiles()}
            selected={selectedDefinition()}
            onSelect={openDefinition}
            onCreate={() => void createWorkflow()}
            onShowEnvironment={() => setShowEnvironment(true)}
            canUndo={past().length > 0}
            canRedo={future().length > 0}
            onUndo={undo}
            onRedo={redo}
            versions={versionsOf(workflowFiles(), selectedDefinition())}
            onOpenVersion={openDefinition}
            onSaveCanonical={saveGraphToDraft}
            onImport={(file) => void importWorkflow(file)}
            onExport={exportWorkflow}
            onPublish={() => void publishDraft()}
            canPublish={dirty()}
            compact={narrow()}
          />
          <Show when={workbench.uiPhase() !== "ready"}>
            <div data-automate-studio-banner>
              <ConnectionBanner dataAttr="automate-connection" dataRetryAttr="automate-retry" />
            </div>
          </Show>
          <div data-automate-studio-body>
            <Show when={!narrow() && libraryOpen()}>{library(() => setLibraryOpen(false))}</Show>
            <div data-automate-studio-main>
              <section data-automate-studio-flow>
                <Show when={!narrow() && !libraryOpen()}>
                  <button
                    type="button"
                    data-automate-studio-library-reopen
                    title={t("automate.studio.library.reopen")}
                    aria-label={t("automate.studio.library.reopen")}
                    onClick={() => setLibraryOpen(true)}
                  >
                    ▸
                  </button>
                </Show>
                <AutomateStudioRunBar
                  state={runState()}
                  error={workflowError()}
                  definitionLoading={definitionFile.isLoading || !definition()}
                  onValidate={validate}
                  onStart={() => void startSelectedWorkflow()}
                  onAllow={() => void resolveWorkflowApproval("allow")}
                  onDeny={() => void resolveWorkflowApproval("deny")}
                  onCancel={() => void stopWorkflow()}
                  onDismissError={() => setWorkflowError(undefined)}
                  compact={narrow()}
                />
                <AutomateStudioCanvas
                  steps={allSteps()}
                  definitionId={definition()?.id}
                  width={640}
                  height={448}
                  running={runState() === "running" || runState() === "waiting-approval"}
                  selectedNodeId={selectedStepId()}
                  onSelectNode={setSelectedStepId}
                  positions={graph().positions}
                  onPositionsChange={(positions) => editGraph("positions", { ...graph(), positions })}
                  edges={graph().edges}
                  onEdgesChange={(edges) => editGraph("edges", { ...graph(), edges })}
                  toolsExtra={
                    narrow() ? (
                      <>
                        <button
                          type="button"
                          data-automate-studio-debug-toggle
                          aria-pressed={debugOpenOnPhone()}
                          onClick={() => setDebugOpenOnPhone((open) => !open)}
                        >
                          {t("automate.studio.debugButton")}
                        </button>
                        <button type="button" data-automate-studio-nodes-toggle onClick={() => setNodesSheetOpen(true)}>
                          {t("automate.studio.library.title")}
                        </button>
                      </>
                    ) : undefined
                  }
                />
                <Show when={!definitions.isLoading && connection() && mainFiles().length === 0}>
                  <div data-automate-definitions="empty">
                    <p>{t("workbench.automate.noDefinitions")}</p>
                    <button type="button" data-automate-studio-create onClick={() => void createWorkflow()}>
                      {t("automate.studio.newWorkflow")}
                    </button>
                  </div>
                </Show>
                <Show when={selectedNode()}>
                  {(selection) => (
                    <div data-automate-studio-inspector-column>
                      <AutomateStudioInspector
                        node={selection().node}
                        index={selection().index}
                        total={allSteps().length}
                        x={selection().x}
                        y={selection().y}
                        positionOverridden={selection().overridden}
                        outgoingTo={selection().outgoing}
                        incomingFrom={selection().incoming}
                        userEdgeCount={graph().edges.length}
                        onClose={() => setSelectedStepId(undefined)}
                      />
                    </div>
                  )}
                </Show>
              </section>
              <Show when={!narrow() || debugOpenOnPhone()}>
                <AutomateStudioDebug
                  tab={debugTab()}
                  onTab={(tab) => {
                    setDebugTab(tab)
                    setDebugCollapsed(false)
                  }}
                  collapsed={!narrow() && debugCollapsed()}
                  onToggle={() => (narrow() ? setDebugOpenOnPhone(false) : setDebugCollapsed((value) => !value))}
                  runs={(workflowRuns.data?.workflows ?? []).map((run) => ({ id: run.workflowId, definitionId: run.definitionId, status: run.status }))}
                  runsError={!!workflowRuns.error}
                  onCancelRun={(runId) => {
                    const current = connection()
                    if (!current) return
                    void current.client
                      .updateWorkflow(runId, "cancel")
                      .then(() => workflowRuns.refetch())
                      .catch((error) => fail(error, "workbench.automate.cancelFailed"))
                  }}
                  draftSource={draftSource()}
                  draftStatus={t(`automate.studio.draft.${draftStatus()}`)}
                  onDraftInput={replaceDraft}
                  onResetDraft={() => replaceDraft(publishedSource())}
                  hasDefinition={!!selectedDefinition()}
                  logs={logs()}
                  problems={validateReport()}
                />
              </Show>
            </div>
          </div>
          <Show when={narrow() && nodesSheetOpen()}>
            <div data-automate-studio-scrim aria-hidden="true" onClick={() => setNodesSheetOpen(false)} />
            <div data-automate-studio-nodes-sheet>{library(() => setNodesSheetOpen(false))}</div>
          </Show>
          <Show when={showEnvironment()}>
            <div data-automate-studio-environment-overlay onClick={(event) => event.target === event.currentTarget && setShowEnvironment(false)}>
              <div data-automate-studio-environment-panel>
                <div data-automate-studio-environment-head>
                  <h2>{t("workbench.automate.environment.drawerTitle")}</h2>
                  <button
                    type="button"
                    onClick={() => setShowEnvironment(false)}
                    aria-label={t("workbench.automate.environment.close")}
                    data-automate-studio-environment-close
                  >
                    ×
                  </button>
                </div>
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
                    void current.client
                      .updateWorkflow(runId, "cancel")
                      .then(() => workflowRuns.refetch())
                      .catch((error) => fail(error, "workbench.automate.cancelFailed"))
                  }}
                />
              </div>
            </div>
          </Show>
        </section>
      </section>
    </main>
  )
}
