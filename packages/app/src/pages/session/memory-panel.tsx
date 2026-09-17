/* SPDX-License-Identifier: MIT */

import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js"
import { createQuery, useQueryClient } from "@tanstack/solid-query"
import { showToast } from "@unifia/ui/toast"
import { Markdown } from "@unifia/ui/markdown"
import { Icon } from "@unifia/ui/icon"
import type { WorkbenchConnection } from "@unifia/workbench-shell"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import { useWorkspaceWorkbench } from "@/context/workbench/provider"
import { workbenchQueryKey } from "@/context/workbench/query-keys"
import { ConnectionBanner } from "@/pages/workbench/connection-banner"
import { useViewport } from "@/shell/v110-store"
import { buildMemoryTree, isMemoryMarkdown, linkedMemoryNotes, memoryBacklinks, memoryExcerpt, memoryGraphAtDepth, memoryGraphFit, memoryGraphZoom, memoryMenuActions, memoryMovePath, memoryParentFolder, memoryRenamePath, memorySaveState, memoryTitle, memoryTitleIsAmbiguous, memoryUniquePath, parseMemoryNote, rewriteMemoryWikilinks, visibleMemoryRows, type MemoryAction, type MemoryFileEntry, type MemoryGraphView, type MemoryNoteDocument } from "./memory-panel-model"

const MEMORY_ROOT = ".unifia/memory"
// The mockup expands a collapsed folder after 620 ms of drag-hover; the panel
// mirrors that so a deep drop target is reachable without stopping the drag.
const AUTO_EXPAND_DELAY_MS = 620
// INTERACTIONS.md: the Memory editor autosaves 700 ms after the last keystroke;
// the explicit Save button flushes immediately instead of resetting the delay.
const AUTOSAVE_DELAY_MS = 700
const TREE_INDENT_PX = 18
const MAX_MEMORY_PAGES = 20
// Margin kept around the graph content by the fit gesture, in graph units.
const MEMORY_GRAPH_PAD = 6

type MemoryFiles = { readonly entries: readonly MemoryFileEntry[]; readonly skipped: number }

async function collectMemoryFiles(current: WorkbenchConnection): Promise<MemoryFiles> {
  let page = await current.client.listFiles(current.workspaceId, MEMORY_ROOT)
  const entries: MemoryFileEntry[] = [...page.entries]
  let pages = 1
  while (page.nextCursor && pages < MAX_MEMORY_PAGES) {
    page = await current.client.listFiles(current.workspaceId, MEMORY_ROOT, page.nextCursor)
    entries.push(...page.entries)
    pages += 1
  }
  return { entries, skipped: page.skipped }
}

function MemoryPreview(props: { note: MemoryNoteDocument }): JSX.Element {
  return <><h1 class="mt-2 text-20-medium">{props.note.title}</h1><Show when={props.note.tags.length > 0}><div class="mt-3 flex flex-wrap gap-1"><For each={props.note.tags}>{(tag) => <span class="rounded bg-background-base px-2 py-1 text-11-regular">#{tag}</span>}</For></div></Show><Markdown text={props.note.body} class="mt-5 text-13-regular leading-6 text-text-base" /></>
}

function MemoryEditor(props: { value: string; onInput: (value: string) => void }): JSX.Element {
  return <textarea class="h-full min-h-72 w-full resize-none rounded border border-border-base bg-background-base p-3 font-mono text-12-regular leading-5" value={props.value} onInput={(event) => props.onInput(event.currentTarget.value)} aria-label="Edit memory note" />
}

export function MemoryPanel(): JSX.Element {
  const workbench = useWorkspaceWorkbench()
  const sdk = useSDK()
  const language = useLanguage()
  const t = language.t
  const connection = workbench.connection
  const queryClient = useQueryClient()
  const [selectedPath, setSelectedPath] = createSignal<string>()
  const [query, setQuery] = createSignal("")
  const [view, setView] = createSignal<"preview" | "source" | "split">("preview")
  const [contextView, setContextView] = createSignal<"links" | "graph">("links")
  const [draft, setDraft] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set())
  const [dragPath, setDragPath] = createSignal<string>()
  const [dropFolder, setDropFolder] = createSignal<string>()
  const [menu, setMenu] = createSignal<{ kind: "note" | "folder"; target: string; name: string; x: number; y: number }>()
  const [moving, setMoving] = createSignal(false)
  const [renaming, setRenaming] = createSignal<string>()
  const [renameDraft, setRenameDraft] = createSignal("")
  let expandTimer: ReturnType<typeof setTimeout> | undefined
  let vaultScroll: HTMLDivElement | undefined
  let autosaveTimer: ReturnType<typeof setTimeout> | undefined
  let draftPath: string | undefined
  /**
   * Phase 9 (Memory mobile single-pane): the canonical viewport authority
   * decides the layout. On the overlay families the triptych collapses to
   * one visible pane (vault | note | links) with tap-to-navigate; the wide
   * families keep the three-column grid.
   */
  const viewport = useViewport()
  const narrow = createMemo(() => {
    const family = viewport()
    return family === "phone-portrait" || family === "tablet-portrait" || family === "compact-landscape"
  })
  const [mobilePane, setMobilePane] = createSignal<"vault" | "note" | "links">("vault")

  createEffect(() => { void workbench.ensureConnected().catch(() => undefined) })
  const filesQueryOptions = createMemo(() => {
    const current = connection()
    return {
      queryKey: workbenchQueryKey(current, "files", { prefix: MEMORY_ROOT }),
      enabled: !!current,
      queryFn: () => collectMemoryFiles(current!),
    }
  })
  const files = createQuery(filesQueryOptions)
  const notes = createMemo(() => (files.data?.entries ?? []).filter((entry) => entry.kind === "file" && isMemoryMarkdown(entry.path)).map((entry) => ({ path: entry.path, title: memoryTitle(entry.path) })))
  const rows = createMemo(() => buildMemoryTree(files.data?.entries ?? []))
  const allPaths = createMemo(() => (files.data?.entries ?? []).map((entry) => entry.path))
  const folders = createMemo(() => rows().filter((row) => row.kind === "folder"))
  const visibleRows = createMemo(() => {
    const term = query().trim().toLocaleLowerCase()
    if (!term) return visibleMemoryRows(rows(), collapsed())
    return rows().filter((row) => row.kind === "note" && (row.name.toLocaleLowerCase().includes(term) || row.path.toLocaleLowerCase().includes(term)))
  })
  createEffect(() => {
    // Narrow viewports start on the vault list (tap to navigate); only the
    // wide triptych auto-selects the first note so the note pane is not empty.
    if (narrow()) return
    if (!selectedPath() && notes()[0]) setSelectedPath(notes()[0].path)
  })
  const noteQueryOptions = createMemo(() => {
    const path = selectedPath()
    return {
      queryKey: ["memory-note", sdk.directory, path] as const,
      enabled: !!path,
      queryFn: async () => {
        const result = await sdk.client.file.readRaw({ path: path! })
        if (!result.data) throw new Error("Memory note was not found")
        return result.data
      },
    }
  })
  const noteFile = createQuery(noteQueryOptions)
  const note = createMemo(() => {
    const path = selectedPath()
    const file = noteFile.data
    return path && file ? parseMemoryNote(path, file.content) : undefined
  })
  const linked = createMemo(() => note() ? linkedMemoryNotes(note()!.links, notes()) : [])
  // One document read feeds both the backlinks list and the depth-N graph:
  // the previous dedicated backlinks query refetched every document on each
  // selection change and could not serve the graph.
  const documentsQueryOptions = createMemo(() => {
    const candidates = notes()
    return {
      queryKey: ["memory-documents", sdk.directory, candidates.map((candidate) => candidate.path).join("|")] as const,
      enabled: candidates.length > 0,
      queryFn: async () => {
        const parsed = await Promise.all(candidates.map(async (candidate) => {
          const result = await sdk.client.file.readRaw({ path: candidate.path })
          return result.data ? parseMemoryNote(candidate.path, result.data.content) : undefined
        }))
        return parsed.filter((document): document is MemoryNoteDocument => !!document)
      },
    }
  })
  const documents = createQuery(documentsQueryOptions)
  const backlinks = createMemo(() => {
    const selected = selectedPath()
    if (!selected) return []
    return memoryBacklinks({ path: selected, title: memoryTitle(selected) }, documents.data ?? [])
  })
  // v110 graph defaults (module m69): depth 2, tags on, orphans on.
  const [graphDepth, setGraphDepth] = createSignal(2)
  const [graphTags, setGraphTags] = createSignal(true)
  const [graphOrphans, setGraphOrphans] = createSignal(true)
  const graph = createMemo(() => {
    const current = note()
    if (!current) return { nodes: [], tags: [], edges: [] } as const
    return memoryGraphAtDepth(current, notes(), documents.data ?? [], graphDepth(), { orphans: graphOrphans(), tags: graphTags() })
  })
  // Mockup m69 viewport: drag pans, the wheel zooms (clamped 0.55-1.8) and a
  // double-click fits the content. The layout normalises nodes around
  // (50, 50), so the identity view is the fallback when a fit is impossible.
  const [graphView, setGraphView] = createSignal<MemoryGraphView>({ x: 0, y: 0, zoom: 1 })
  const [graphPanning, setGraphPanning] = createSignal(false)
  let graphSvg: SVGSVGElement | undefined
  let graphWorld: SVGGElement | undefined
  let graphContent: SVGGElement | undefined
  let graphPan: { pointerId: number; from: { x: number; y: number }; start: MemoryGraphView } | undefined

  const graphPoint = (clientX: number, clientY: number) => {
    const matrix = graphSvg?.getScreenCTM()
    if (!graphSvg || !matrix) return undefined
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
    return { x: point.x, y: point.y }
  }

  const fitGraph = () => {
    const svg = graphSvg
    const content = graphContent
    if (!svg || !content) return
    const rect = svg.getBoundingClientRect()
    // The square viewBox uses `meet`, so one user unit is the smaller side.
    const scale = Math.min(rect.width, rect.height) / 100
    if (!Number.isFinite(scale) || scale <= 0) return
    // getBBox includes the element's own transform, so the bounds are read
    // from the untransformed content group: the fit stays idempotent across
    // pan and zoom.
    let box: { x: number; y: number; width: number; height: number }
    try {
      box = content.getBBox()
    } catch {
      return
    }
    const viewport = { width: rect.width / scale, height: rect.height / scale }
    setGraphView(memoryGraphFit(box, viewport, { x: 50, y: 50 }, MEMORY_GRAPH_PAD) ?? { x: 0, y: 0, zoom: 1 })
  }

  const onGraphWheel = (event: WheelEvent) => {
    event.preventDefault()
    const cursor = graphPoint(event.clientX, event.clientY)
    if (!cursor) return
    const current = graphView()
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1
    const zoom = Math.max(memoryGraphZoom.min, Math.min(memoryGraphZoom.max, current.zoom * factor))
    if (zoom === current.zoom) return
    setGraphView({
      zoom,
      x: cursor.x - ((cursor.x - current.x) / current.zoom) * zoom,
      y: cursor.y - ((cursor.y - current.y) / current.zoom) * zoom,
    })
  }

  const onGraphPointerDown = (event: PointerEvent) => {
    const target = event.target as Element | null
    if (target?.closest("[data-memory-graph-node], [data-memory-graph-tag], button, input")) return
    const from = graphPoint(event.clientX, event.clientY)
    if (!from) return
    graphPan = { pointerId: event.pointerId, from, start: graphView() }
    setGraphPanning(true)
    graphSvg?.setPointerCapture(event.pointerId)
  }

  const onGraphPointerMove = (event: PointerEvent) => {
    const pan = graphPan
    if (!pan || pan.pointerId !== event.pointerId) return
    const to = graphPoint(event.clientX, event.clientY)
    if (!to) return
    setGraphView({ zoom: pan.start.zoom, x: pan.start.x + (to.x - pan.from.x), y: pan.start.y + (to.y - pan.from.y) })
  }

  const endGraphPan = (event: PointerEvent) => {
    const pan = graphPan
    if (!pan || pan.pointerId !== event.pointerId) return
    graphPan = undefined
    setGraphPanning(false)
    graphSvg?.releasePointerCapture(event.pointerId)
  }

  createEffect(() => {
    // Refit when the content or the visible pane changes; the fit is
    // deterministic, so new content simply replaces pan and zoom.
    graph()
    contextView()
    requestAnimationFrame(fitGraph)
  })
  const linkedExcerpt = createMemo(() => {
    const current = note()
    if (!current) return new Map<string, string>()
    return new Map(linked().map((item) => [item.path, memoryExcerpt(current.body, 120)]))
  })
  const backlinksExcerpt = createMemo(() => {
    const current = note()
    if (!current) return new Map<string, string>()
    return new Map(backlinks().map((item) => [item.path, memoryExcerpt(current.body, 120)]))
  })
  const saveState = createMemo(() => memorySaveState(draft(), noteFile.data?.content, saving()))
  createEffect(() => {
    // Adopt the disk content when the selected note changes, and after a
    // write lands while the editor has not moved on (autosave keeps
    // draft === disk otherwise).
    const path = selectedPath()
    const content = noteFile.data?.content
    if (!path || content === undefined) return
    if (draftPath !== path) {
      draftPath = path
      setDraft(content)
      return
    }
    if (memorySaveState(draft(), content, false) === "unsaved") return
    setDraft(content)
  })

  function clearAutosave(): void {
    if (autosaveTimer !== undefined) {
      clearTimeout(autosaveTimer)
      autosaveTimer = undefined
    }
  }

  function scheduleAutosave(): void {
    if (!selectedPath()) return
    clearAutosave()
    autosaveTimer = setTimeout(() => {
      autosaveTimer = undefined
      void persistNote("auto")
    }, AUTOSAVE_DELAY_MS)
  }

  function onDraftChange(value: string): void {
    setDraft(value)
    scheduleAutosave()
  }

  async function persistNote(kind: "auto" | "manual"): Promise<void> {
    const path = selectedPath()
    const current = noteFile.data
    const content = draft()
    if (!path || !current || saving() || content === current.content) return
    setSaving(true)
    try {
      const result = await sdk.client.file.write({ path, content, expectedHash: current.stamp.hash })
      if (result.response?.status === 409) {
        clearAutosave()
        showToast({ variant: "error", title: t("workbench.memory.save.conflict") })
        return
      }
      if (!result.data) throw new Error(t("workbench.memory.save.failed"))
      // Advance the CAS stamp in place: a refetch would race the next
      // keystroke, while this keeps draft-vs-disk comparison honest.
      queryClient.setQueryData(["memory-note", sdk.directory, path], result.data)
      if (draft() !== content) scheduleAutosave()
      if (kind === "manual") showToast({ variant: "success", title: t("workbench.memory.save.saved") })
    } catch (error) {
      showToast({ variant: "error", title: t("workbench.memory.save.failed"), description: error instanceof Error ? error.message : String(error) })
    } finally {
      setSaving(false)
    }
  }

  onCleanup(clearAutosave)

  function toggleFolder(path: string): void {
    const next = new Set(collapsed())
    if (next.has(path)) next.delete(path)
    else next.add(path)
    setCollapsed(next)
  }

  function startDrag(event: DragEvent, path: string): void {
    if (!connection()) return
    setDragPath(path)
    event.dataTransfer?.setData("text/plain", path)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"
  }

  function endDrag(): void {
    if (expandTimer !== undefined) {
      clearTimeout(expandTimer)
      expandTimer = undefined
    }
    setDragPath(undefined)
    setDropFolder(undefined)
  }

  function overFolder(event: DragEvent, path: string): void {
    if (!dragPath()) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move"
    if (dropFolder() !== path) setDropFolder(path)
    if (collapsed().has(path)) {
      if (expandTimer !== undefined) clearTimeout(expandTimer)
      expandTimer = setTimeout(() => {
        expandTimer = undefined
        const next = new Set(collapsed())
        next.delete(path)
        setCollapsed(next)
      }, AUTO_EXPAND_DELAY_MS)
    }
    const scroll = vaultScroll
    if (scroll) {
      const rect = scroll.getBoundingClientRect()
      if (event.clientY < rect.top + 42) scroll.scrollTop -= 14
      else if (event.clientY > rect.bottom - 42) scroll.scrollTop += 14
    }
  }

  async function dropOnFolder(event: DragEvent, folder: string): Promise<void> {
    event.preventDefault()
    const from = dragPath()
    endDrag()
    const to = from ? memoryMovePath(from, folder) : undefined
    const current = connection()
    if (!from || !to || !current) return
    try {
      await current.client.renameFile(current.workspaceId, from, to)
      await files.refetch()
      if (selectedPath() === from) setSelectedPath(to)
      showToast({ variant: "success", title: t("workbench.memory.move.moved") })
    } catch (error) {
      showToast({ variant: "error", title: t("workbench.memory.move.failed"), description: error instanceof Error ? error.message : String(error) })
    }
  }

  function openMenu(event: MouseEvent, kind: "note" | "folder", target: string, name: string): void {
    if (!connection()) return
    event.preventDefault()
    setMoving(false)
    setRenaming(undefined)
    const width = 200
    const height = kind === "folder" ? 96 : 260
    setMenu({ kind, target, name, x: Math.max(8, Math.min(event.clientX, window.innerWidth - width)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - height)) })
  }

  function closeMenu(): void {
    setMenu(undefined)
    setMoving(false)
  }

  function startRename(target: string, name: string): void {
    closeMenu()
    setRenaming(target)
    setRenameDraft(name)
  }

  async function commitRename(): Promise<void> {
    const from = renaming()
    const current = connection()
    if (!from || !current) return
    const to = memoryRenamePath(from, renameDraft())
    if (!to || to === from) {
      setRenaming(undefined)
      return
    }
    if (allPaths().includes(to)) {
      showToast({ variant: "error", title: t("workbench.memory.actions.nameTaken") })
      return
    }
    try {
      await current.client.renameFile(current.workspaceId, from, to)
      // #93 / v110 mockup: a note rename rewrites the wikilinks that point at
      // it. Folder renames change paths, not titles, so links are unaffected.
      const refactor = isMemoryMarkdown(from) ? await refactorWikilinksAfterRename(from, to) : undefined
      await files.refetch()
      if (refactor && (refactor.updated > 0 || refactor.failed.length > 0)) {
        void queryClient.invalidateQueries({ queryKey: ["memory-documents"] })
      }
      if (selectedPath() === from) setSelectedPath(to)
      setRenaming(undefined)
      showToast({ variant: "success", title: t("workbench.memory.actions.renamed") })
      if (refactor && refactor.updated > 0) {
        showToast({ variant: "success", title: t("workbench.memory.rename.linksRefactored", { count: refactor.updated }) })
      }
      if (refactor && refactor.failed.length > 0) {
        showToast({
          variant: "error",
          title: t("workbench.memory.rename.linksFailed", { paths: refactor.failed.join(", ") }),
        })
      }
    } catch (error) {
      showToast({ variant: "error", title: t("workbench.memory.move.failed"), description: error instanceof Error ? error.message : String(error) })
    }
  }

  /**
   * Rewrites the unambiguous wikilinks that pointed at the renamed note,
   * note by note, through the real file routes with a CAS write per file
   * (the same `expectedHash` discipline the autosave uses). Partial failures
   * are reported instead of being swallowed: a rename that left some links
   * stale must say which notes it could not touch.
   */
  async function refactorWikilinksAfterRename(
    from: string,
    to: string,
  ): Promise<{ updated: number; failed: string[] }> {
    const oldTitle = memoryTitle(from)
    const newTitle = memoryTitle(to)
    const ambiguous = memoryTitleIsAmbiguous(notes(), oldTitle)
    let updated = 0
    const failed: string[] = []
    for (const candidate of notes()) {
      // The renamed note itself needs no rewrite, and its old path is already
      // gone on disk; on the mock harness its new path is not readable either.
      if (candidate.path === from) continue
      try {
        const result = await sdk.client.file.readRaw({ path: candidate.path })
        if (!result.data) continue
        const next = rewriteMemoryWikilinks({ body: result.data.content, oldTitle, newTitle, ambiguous })
        if (next === result.data.content) continue
        const write = await sdk.client.file.write({ path: candidate.path, content: next, expectedHash: result.data.stamp.hash })
        if (write.response?.status === 409 || !write.data) failed.push(candidate.path)
        else updated += 1
      } catch {
        failed.push(candidate.path)
      }
    }
    return { updated, failed }
  }

  async function readContent(path: string): Promise<string> {
    if (path === selectedPath() && noteFile.data) return noteFile.data.content
    const result = await sdk.client.file.readRaw({ path })
    if (!result.data) throw new Error(t("workbench.memory.actions.exportFailed"))
    return result.data.content
  }

  async function createNote(folder: string): Promise<void> {
    const current = connection()
    if (!current) return
    const name = t("workbench.memory.defaults.noteName")
    const path = memoryUniquePath(allPaths(), folder, name)
    try {
      await current.client.createFiles(current.workspaceId, [{ path, content: `# ${name}\n\n` }])
      await files.refetch()
      closeMenu()
      setSelectedPath(path)
      setMobilePane("note")
      showToast({ variant: "success", title: t("workbench.memory.actions.created") })
    } catch (error) {
      showToast({ variant: "error", title: t("workbench.memory.actions.createFailed"), description: error instanceof Error ? error.message : String(error) })
    }
  }

  async function createFolder(folder: string): Promise<void> {
    if (!connection()) return
    const name = t("workbench.memory.defaults.folderName")
    const path = memoryUniquePath(allPaths(), folder, name, "")
    try {
      await sdk.client.file.mkdir({ path })
      await files.refetch()
      closeMenu()
      showToast({ variant: "success", title: t("workbench.memory.actions.folderCreated") })
    } catch (error) {
      showToast({ variant: "error", title: t("workbench.memory.actions.mkdirFailed"), description: error instanceof Error ? error.message : String(error) })
    }
  }

  async function duplicateNote(target: string): Promise<void> {
    const current = connection()
    if (!current) return
    try {
      const content = await readContent(target)
      const stem = target.slice(target.lastIndexOf("/") + 1).replace(/\.md$/i, "")
      const path = memoryUniquePath(allPaths(), memoryParentFolder(target), `${stem} copy`)
      await current.client.createFiles(current.workspaceId, [{ path, content }])
      await files.refetch()
      closeMenu()
      setSelectedPath(path)
      setMobilePane("note")
      showToast({ variant: "success", title: t("workbench.memory.actions.duplicated") })
    } catch (error) {
      showToast({ variant: "error", title: t("workbench.memory.actions.createFailed"), description: error instanceof Error ? error.message : String(error) })
    }
  }

  async function exportNote(target: string): Promise<void> {
    try {
      const content = await readContent(target)
      const url = URL.createObjectURL(new Blob([content], { type: "text/markdown" }))
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = target.slice(target.lastIndexOf("/") + 1)
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 500)
      closeMenu()
      showToast({ variant: "success", title: t("workbench.memory.actions.exported") })
    } catch (error) {
      showToast({ variant: "error", title: t("workbench.memory.actions.exportFailed"), description: error instanceof Error ? error.message : String(error) })
    }
  }

  async function deleteNote(target: string): Promise<void> {
    const current = connection()
    if (!current) return
    const name = target.slice(target.lastIndexOf("/") + 1)
    if (!window.confirm(t("workbench.memory.actions.confirmDelete", { name }))) {
      closeMenu()
      return
    }
    try {
      await current.client.removeFiles(current.workspaceId, [target])
      await files.refetch()
      if (selectedPath() === target) setSelectedPath(undefined)
      closeMenu()
      showToast({ variant: "success", title: t("workbench.memory.actions.deleted") })
    } catch (error) {
      showToast({ variant: "error", title: t("workbench.memory.actions.deleteFailed"), description: error instanceof Error ? error.message : String(error) })
    }
  }

  async function moveNoteTo(target: string, folder: string): Promise<void> {
    const current = connection()
    if (!current) return
    const to = memoryMovePath(target, folder)
    if (!to) {
      closeMenu()
      return
    }
    if (allPaths().includes(to)) {
      showToast({ variant: "error", title: t("workbench.memory.actions.nameTaken") })
      return
    }
    try {
      await current.client.renameFile(current.workspaceId, target, to)
      await files.refetch()
      if (selectedPath() === target) setSelectedPath(to)
      closeMenu()
      showToast({ variant: "success", title: t("workbench.memory.move.moved") })
    } catch (error) {
      showToast({ variant: "error", title: t("workbench.memory.move.failed"), description: error instanceof Error ? error.message : String(error) })
    }
  }

  function runAction(action: MemoryAction): void {
    const current = menu()
    if (!current) return
    switch (action) {
      case "open":
        setSelectedPath(current.target)
        setMobilePane("note")
        closeMenu()
        return
      case "rename":
        startRename(current.target, current.name)
        return
      case "duplicate":
        void duplicateNote(current.target)
        return
      case "move":
        setMoving(true)
        return
      case "export":
        void exportNote(current.target)
        return
      case "delete":
        void deleteNote(current.target)
        return
      case "newNote":
        void createNote(current.target)
        return
      case "newFolder":
        void createFolder(current.target)
        return
    }
  }

  return (
    <section class="flex size-full min-w-0 flex-col gap-2 bg-background-base p-3" data-v110="memory-panel" data-parity="memory.panel">
      <ConnectionBanner dataAttr="memory-connection" dataRetryAttr="memory-retry" />
      <div
        class={narrow()
          ? "grid min-h-0 flex-1 grid-cols-1 gap-3"
          : "grid min-h-0 flex-1 grid-cols-[minmax(180px,0.8fr)_minmax(0,1.7fr)_minmax(180px,0.8fr)] gap-3"}
        data-memory-layout={narrow() ? "single" : "triptych"}
      >
        <aside class="min-h-0 overflow-hidden rounded-lg border border-border-base bg-background-stronger" classList={{ hidden: narrow() && mobilePane() !== "vault" }} data-memory-vault onDragEnd={endDrag}>
          <div class="border-b border-border-base p-3"><div class="flex items-center gap-1"><h2 class="text-14-medium">{t("workbench.memory.vault.title")}</h2><div class="ml-auto flex items-center gap-1"><button type="button" class="rounded p-1 text-text-weak hover:bg-background-base hover:text-text-strong" data-memory-new-note title={t("workbench.memory.actions.newNote")} aria-label={t("workbench.memory.actions.newNote")} onClick={() => void createNote(MEMORY_ROOT)}><Icon name="plus" size="small" /></button><button type="button" class="rounded p-1 text-text-weak hover:bg-background-base hover:text-text-strong" data-memory-new-folder title={t("workbench.memory.actions.newFolder")} aria-label={t("workbench.memory.actions.newFolder")} onClick={() => void createFolder(MEMORY_ROOT)}><Icon name="folder-add-left" size="small" /></button></div></div><input class="mt-2 w-full rounded border border-border-base bg-background-base px-2 py-1 text-12-regular" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} aria-label={t("workbench.memory.vault.searchLabel")} placeholder={t("workbench.memory.vault.searchPlaceholder")} /></div>
          <div ref={(element) => { vaultScroll = element }} class="h-[calc(100%-76px)] overflow-y-auto p-2">
            <Show when={files.error}><p class="text-12-regular text-text-danger">{t("workbench.memory.vault.loadError")}</p></Show>
            <For each={visibleRows()}>{(item) => <Switch>
              <Match when={item.kind === "folder"}>
                <button type="button" class="mb-1 flex w-full items-center gap-1 rounded px-2 py-2 text-left text-12-regular hover:bg-background-base" classList={{ "bg-background-base ring-1 ring-accent-base": dropFolder() === item.path }} style={{ "padding-left": `${item.depth * TREE_INDENT_PX}px` }} data-memory-folder={item.path} aria-expanded={!collapsed().has(item.path)} aria-label={t(collapsed().has(item.path) ? "workbench.memory.tree.expand" : "workbench.memory.tree.collapse", { name: item.name })} onContextMenu={(event) => openMenu(event, "folder", item.path, item.name)} onClick={() => toggleFolder(item.path)} onDragOver={(event) => overFolder(event, item.path)} onDragLeave={() => { if (dropFolder() === item.path) setDropFolder(undefined) }} onDrop={(event) => void dropOnFolder(event, item.path)}>
                  <span class="w-3 shrink-0 text-text-weak" aria-hidden="true">{collapsed().has(item.path) ? "▸" : "⌄"}</span>
                  <span class="min-w-0 flex-1 truncate">{item.name}</span>
                  <Show when={item.count > 0}><span class="text-11-regular text-text-weak">{item.count}</span></Show>
                </button>
              </Match>
              <Match when={item.kind === "note"}>
                <Show when={renaming() === item.path} fallback={<button type="button" class="mb-1 block w-full rounded px-2 py-2 text-left text-12-regular hover:bg-background-base" classList={{ "bg-background-base text-text-strong": selectedPath() === item.path, "opacity-50": dragPath() === item.path }} style={{ "padding-left": `${item.depth * TREE_INDENT_PX + 12}px` }} draggable="true" data-memory-note={item.path} title={item.path} onDragStart={(event) => startDrag(event, item.path)} onContextMenu={(event) => openMenu(event, "note", item.path, item.name)} onClick={() => { if (saveState() === "unsaved") void persistNote("auto"); setSelectedPath(item.path); setMobilePane("note") }}><span class="mr-1 text-text-weak" aria-hidden="true">◈</span>{item.name}</button>}>
                  <input class="mb-1 w-full rounded border border-border-base bg-background-base px-2 py-1.5 text-12-regular" style={{ "padding-left": `${item.depth * TREE_INDENT_PX + 12}px` }} value={renameDraft()} aria-label={t("workbench.memory.actions.rename")} ref={(element) => element.focus()} onInput={(event) => setRenameDraft(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") void commitRename(); if (event.key === "Escape") setRenaming(undefined) }} onBlur={() => { if (renaming() === item.path) void commitRename() }} />
                </Show>
              </Match>
            </Switch>}</For>
            <Show when={!!connection() && !files.isLoading && !files.error && visibleRows().length === 0 && !query().trim()}><p class="p-2 text-12-regular text-text-weak">{t("workbench.memory.vault.empty", { root: MEMORY_ROOT })}</p></Show>
          </div>
        </aside>
        <article class="min-h-0 overflow-hidden rounded-lg border border-border-base bg-background-stronger" classList={{ hidden: narrow() && mobilePane() !== "note" }} data-memory-note-pane>
          <header class="flex items-center gap-2 border-b border-border-base px-3 py-2"><Show when={narrow()}><button type="button" class="rounded px-2 py-1 text-11-medium" data-memory-back-to-vault onClick={() => setMobilePane("vault")}>← Vault</button></Show><span class="text-12-medium">Memory</span><span class="ml-auto text-11-regular text-text-weak" data-memory-save-state={saveState()}>{t(`workbench.memory.status.${saveState()}`)}</span><Show when={narrow()}><button type="button" class="rounded px-2 py-1 text-11-medium" data-memory-open-links onClick={() => setMobilePane("links")}>Links</button></Show><button type="button" class="rounded px-2 py-1 text-11-medium" classList={{ "bg-background-base": view() === "preview" }} onClick={() => setView("preview")}>Preview</button><button type="button" class="rounded px-2 py-1 text-11-medium" classList={{ "bg-background-base": view() === "source" }} onClick={() => setView("source")}>Edit</button><button type="button" class="rounded px-2 py-1 text-11-medium" classList={{ "bg-background-base": view() === "split", hidden: viewport() === "phone-portrait" }} onClick={() => setView("split")}>Split</button><button type="button" class="rounded bg-accent-base px-2 py-1 text-11-medium text-text-on-accent disabled:opacity-50" disabled={saving() || saveState() !== "unsaved"} onClick={() => void persistNote("manual")}>{saving() ? "Saving…" : "Save"}</button></header>
          <div class="h-[calc(100%-43px)] overflow-y-auto p-5">
            <Show when={noteFile.isLoading}><p class="text-12-regular text-text-weak">Loading note…</p></Show>
            <Show when={noteFile.error}><p class="text-12-regular text-text-danger">Unable to read this note.</p></Show>
            <Show when={note()}>{(current) => <><p class="text-11-regular text-text-weak">{current().path}</p><Show when={view() === "source"} fallback={<Show when={view() === "split"} fallback={<MemoryPreview note={current()} />}><div class="mt-3 grid min-h-[calc(100%-28px)] grid-cols-2 gap-3"><MemoryEditor value={draft()} onInput={onDraftChange} /><div class="min-w-0 overflow-y-auto rounded border border-border-base bg-background-base p-3"><MemoryPreview note={parseMemoryNote(current().path, draft())} /></div></div></Show>}><div class="mt-3 h-[calc(100%-28px)]"><MemoryEditor value={draft()} onInput={onDraftChange} /></div></Show></>}</Show>
            <Show when={!note() && !noteFile.isLoading && !noteFile.error}><p class="text-12-regular text-text-weak">Choose a note from the vault.</p></Show>
          </div>
        </article>
        <aside class="min-h-0 overflow-hidden rounded-lg border border-border-base bg-background-stronger" classList={{ hidden: narrow() && mobilePane() !== "links" }} data-memory-links>
          <header class="border-b border-border-base p-3"><Show when={narrow()}><button type="button" class="mb-2 rounded px-2 py-1 text-11-medium" data-memory-back-to-note onClick={() => setMobilePane("note")}>← Note</button></Show><h2 class="text-14-medium">Links &amp; context</h2><div class="mt-2 flex gap-1"><button type="button" class="rounded px-2 py-1 text-11-medium" classList={{ "bg-background-base": contextView() === "links" }} onClick={() => setContextView("links")}>Links</button><button type="button" class="rounded px-2 py-1 text-11-medium" classList={{ "bg-background-base": contextView() === "graph" }} onClick={() => setContextView("graph")}>Local graph</button></div></header>
          <div class="overflow-y-auto p-3"><Show when={contextView() === "links"} fallback={<Show when={graph().nodes.length > 0} fallback={<p class="text-12-regular text-text-weak">Choose a note to inspect its graph.</p>}><div class="flex flex-wrap items-center gap-1" data-memory-graph-controls><button type="button" class="rounded bg-background-base px-2 py-1 text-11-medium" data-memory-graph-depth onClick={() => setGraphDepth(graphDepth() >= 3 ? 1 : graphDepth() + 1)}>{t("workbench.memory.graph.depth", { depth: graphDepth() })}</button><button type="button" class="rounded px-2 py-1 text-11-medium" classList={{ "bg-background-base": graphTags() }} data-memory-graph-tags aria-pressed={graphTags()} onClick={() => setGraphTags(!graphTags())}>{t("workbench.memory.graph.tags")}</button><button type="button" class="rounded px-2 py-1 text-11-medium" classList={{ "bg-background-base": graphOrphans() }} data-memory-graph-orphans aria-pressed={graphOrphans()} onClick={() => setGraphOrphans(!graphOrphans())}>{t("workbench.memory.graph.orphans")}</button></div><svg ref={graphSvg} class="mt-2 h-56 w-full cursor-grab touch-none" classList={{ "cursor-grabbing": graphPanning() }} viewBox="0 0 100 100" role="img" aria-label="Local memory graph" data-memory-graph-viewport onWheel={onGraphWheel} onPointerDown={onGraphPointerDown} onPointerMove={onGraphPointerMove} onPointerUp={endGraphPan} onPointerCancel={endGraphPan} onDblClick={() => fitGraph()}><g ref={graphWorld} data-memory-graph-world transform={`translate(${graphView().x} ${graphView().y}) scale(${graphView().zoom})`}><g ref={graphContent}><For each={graph().edges}>{(edge) => { const from = () => edge.kind === "tag" ? graph().tags.find((tag) => `tag:${tag.tag}` === edge.from) : graph().nodes.find((node) => node.path === edge.from); const to = () => graph().nodes.find((node) => node.path === edge.to); return <Show when={from() && to()}><line x1={from()!.x} y1={from()!.y} x2={to()!.x} y2={to()!.y} stroke="currentColor" opacity={edge.kind === "tag" ? "0.2" : "0.35"} stroke-dasharray={edge.kind === "tag" ? "2 2" : undefined} /></Show> }}</For><For each={graph().tags}>{(tag) => <g data-memory-graph-tag={tag.tag}><circle cx={tag.x} cy={tag.y} r="4" class="fill-background-strong" stroke="currentColor" /><text x={tag.x} y={tag.y + 8} text-anchor="middle" class="fill-text-base text-[4px]">#{tag.tag.slice(0, 12)}</text></g>}</For><For each={graph().nodes}>{(node) => <g class="cursor-pointer" role="button" tabindex="0" data-memory-graph-node={node.path} onClick={() => { setSelectedPath(node.path); setMobilePane("note") }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedPath(node.path) }}><circle cx={node.x} cy={node.y} r={node.path === selectedPath() ? 8 : 6} class={node.path === selectedPath() ? "fill-accent-base" : "fill-background-strong"} stroke="currentColor" /><text x={node.x} y={node.y + 13} text-anchor="middle" class="fill-text-base text-[5px]">{node.title.slice(0, 16)}</text></g>}</For></g></g></svg><p class="mt-1 text-11-regular text-text-weak" data-memory-graph-summary>{t("workbench.memory.graph.summary", { notes: graph().nodes.length, links: graph().edges.filter((edge) => edge.kind === "note").length })}</p></Show>}><Show when={note() && linked().length > 0} fallback={<p class="text-12-regular text-text-weak">No resolved links for this note.</p>}><For each={linked()}>{(item) => <button type="button" class="mb-2 block w-full rounded border border-border-base p-2 text-left text-12-regular hover:bg-background-base" title={`${item.title}\n${linkedExcerpt().get(item.path) ?? ""}`} onClick={() => { setSelectedPath(item.path); setMobilePane("note") }}>{item.title}</button>}</For></Show><Show when={backlinks().length}><h3 class="mt-4 text-12-medium">Backlinks</h3><For each={backlinks()}>{(item) => <button type="button" class="mt-2 block w-full rounded border border-border-base p-2 text-left text-12-regular hover:bg-background-base" title={`${item.title}\n${backlinksExcerpt().get(item.path) ?? ""}`} onClick={() => { setSelectedPath(item.path); setMobilePane("note") }}>{item.title}</button>}</For></Show></Show></div>
        </aside>
      </div>
      <Show when={menu()}>{(current) => <>
        <div class="fixed inset-0 z-40" data-memory-menu-backdrop onClick={closeMenu} onContextMenu={(event) => { event.preventDefault(); closeMenu() }} />
        <div class="fixed z-50 min-w-44 rounded-lg border border-border-base bg-background-stronger p-1 shadow-lg" style={{ left: `${current().x}px`, top: `${current().y}px` }} data-memory-menu role="menu">
          <Show when={!moving()} fallback={<>
            <button type="button" class="block w-full truncate rounded px-2 py-1.5 text-left text-12-regular hover:bg-background-base" data-memory-menu-item="move-root" onClick={() => void moveNoteTo(current().target, MEMORY_ROOT)}>{t("workbench.memory.vault.title")}</button>
            <For each={folders()}>{(folder) => <button type="button" class="block w-full truncate rounded px-2 py-1.5 text-left text-12-regular hover:bg-background-base" data-memory-menu-item="move-folder" onClick={() => void moveNoteTo(current().target, folder.path)}>{folder.name}</button>}</For>
          </>}>
            <For each={memoryMenuActions(current().kind)}>{(action) => <button type="button" class="block w-full rounded px-2 py-1.5 text-left text-12-regular hover:bg-background-base" classList={{ "text-text-danger": action === "delete" }} data-memory-menu-item={action} onClick={() => runAction(action)}>{t(`workbench.memory.actions.${action}`)}</button>}</For>
          </Show>
        </div>
      </>}</Show>
    </section>
  )
}