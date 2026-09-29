/* SPDX-License-Identifier: MIT */

import { For, Match, Show, Switch, createEffect, createMemo, createSignal, on, onCleanup, type JSX } from "solid-js"
import { createQuery, useQueryClient } from "@tanstack/solid-query"
import { showToast } from "@unifia/ui/toast"
import { Markdown } from "@unifia/ui/markdown"
import { Icon } from "@unifia/ui/icon"
import type { WorkbenchConnection } from "@unifia/workbench-shell"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import { useModeInspector } from "@/context/mode-inspector"
import { useModeNavigation } from "@/context/mode-navigation"
import { usePrompt } from "@/context/prompt"
import { useWorkspaceWorkbench } from "@/context/workbench/provider"
import { workbenchQueryKey } from "@/context/workbench/query-keys"
import { ConnectionBanner } from "@/pages/workbench/connection-banner"
import { useViewport } from "@/shell/v110-store"
import { memoryInspectorCards } from "./memory-inspector-cards"
import { memoryNavSections } from "./memory-nav-sections"
import { MemoryGraph, type MemoryGraphFilters } from "./memory-graph"
import { MemoryKnowledgeGraph } from "./memory-knowledge-graph"
import { memoryDisplayPath, memoryDraftParts, memoryDraftTags, memoryLinkTarget, memoryPreviewMarkdown, withMemoryBody, withMemoryTags, withMemoryTitle } from "./memory-note-draft"
import { buildMemoryTree, isMemoryMarkdown, linkedMemoryNotes, memoryBacklinks, memoryExcerpt, memoryGraphAtDepth, memoryMenuActions, memoryMovePath, memoryParentFolder, memoryRenamePath, memorySaveState, memoryTitle, memoryTitleIsAmbiguous, memoryUniquePath, parseMemoryNote, rewriteMemoryWikilinks, visibleMemoryRows, type MemoryAction, type MemoryFileEntry, type MemoryNoteDocument } from "./memory-panel-model"

const MEMORY_ROOT = ".unifia/memory"
// The mockup expands a collapsed folder after 620 ms of drag-hover; the panel
// mirrors that so a deep drop target is reachable without stopping the drag.
const AUTO_EXPAND_DELAY_MS = 620
// INTERACTIONS.md: the Memory editor autosaves 700 ms after the last keystroke;
// the save-state chip flushes immediately instead of resetting the delay.
const AUTOSAVE_DELAY_MS = 700
const TREE_INDENT_PX = 18
const MAX_MEMORY_PAGES = 20
// Maquette resizer clamp: vault/links columns never collapse below 16% or
// grow past 38% of the grid width.
const RESIZE_MIN_PCT = 16
const RESIZE_MAX_PCT = 38

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

// The reference's .m69-note-meta: the note's tags, then when it was last
// written (the file stamp). Its type and confidence have no runtime source.
function MemoryMeta(props: { tags: readonly string[]; modified?: string }): JSX.Element {
  return (
    <div data-memory-meta>
      <For each={props.tags}>{(tag) => <span data-memory-tag>#{tag}</span>}</For>
      <Show when={props.modified}>{(modified) => <span data-memory-modified>{modified()}</span>}</Show>
    </div>
  )
}

function MemoryPreview(props: {
  note: MemoryNoteDocument
  raw: string
  modified?: string
  onOpenLink: (target: string) => void
}): JSX.Element {
  return (
    <div
      data-memory-preview
      onClick={(event) => {
        const anchor = (event.target as Element).closest("a")
        const target = memoryLinkTarget(anchor?.getAttribute("href"))
        if (!target) return
        event.preventDefault()
        props.onOpenLink(target)
      }}
    >
      <h1>{props.note.title}</h1>
      <MemoryMeta tags={props.note.tags} modified={props.modified} />
      <Markdown text={memoryPreviewMarkdown(props.raw)} />
    </div>
  )
}

function MemoryEditor(props: { value: string; onInput: (value: string) => void }): JSX.Element {
  const language = useLanguage()
  return <textarea data-memory-editor value={props.value} onInput={(event) => props.onInput(event.currentTarget.value)} aria-label={language.t("memory.ui.editNote")} />
}

// The reference's .m69-editor-head: the title rewrites the `# heading`, the
// tags rewrite the tag line (ADR-084). Tags apply on blur or Enter, so a
// half-typed "a," is not normalized away under the caret.
function MemoryEditorHead(props: { raw: string; onChange: (raw: string) => void; titleLabel: string; tagsLabel: string }): JSX.Element {
  const [tagsText, setTagsText] = createSignal<string>()
  const savedTags = () => memoryDraftTags(props.raw).join(", ")
  const commitTags = (text: string) => {
    setTagsText(undefined)
    if (text.trim() === savedTags()) return
    props.onChange(withMemoryTags(props.raw, text))
  }
  return (
    <div data-memory-editor-head>
      <input
        data-memory-title-input
        value={memoryDraftParts(props.raw).title}
        aria-label={props.titleLabel}
        placeholder={props.titleLabel}
        onInput={(event) => props.onChange(withMemoryTitle(props.raw, event.currentTarget.value))}
      />
      <input
        data-memory-tags-input
        value={tagsText() ?? savedTags()}
        aria-label={props.tagsLabel}
        placeholder={props.tagsLabel}
        onInput={(event) => setTagsText(event.currentTarget.value)}
        onBlur={(event) => commitTags(event.currentTarget.value)}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur() }}
      />
    </div>
  )
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
  const [hideVault, setHideVault] = createSignal(false)
  const [hideLinks, setHideLinks] = createSignal(false)
  const [vaultPct, setVaultPct] = createSignal(24)
  const [linksPct, setLinksPct] = createSignal(28)
  let expandTimer: ReturnType<typeof setTimeout> | undefined
  let vaultScroll: HTMLDivElement | undefined
  let autosaveTimer: ReturnType<typeof setTimeout> | undefined
  let draftPath: string | undefined
  let gridView: HTMLDivElement | undefined
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
  // Phones (ADR-084): the note stays on screen and the vault and the links
  // open over it as drawers, like the reference's m70 overlays; Note/Graph
  // swaps the note for the knowledge graph.
  const [drawer, setDrawer] = createSignal<"vault" | "links">()
  const toggleDrawer = (side: "vault" | "links") => setDrawer(drawer() === side ? undefined : side)
  const [surface, setSurface] = createSignal<"note" | "graph">("note")

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
    // Every layout opens on a note, as the reference does; on phones the
    // vault is one tap away in its drawer.
    if (!selectedPath() && notes()[0]) setSelectedPath(notes()[0].path)
  })
  const noteQueryOptions = createMemo(() => {
    const path = selectedPath()
    return {
      queryKey: ["memory-note", sdk.directory, path] as const,
      enabled: !!path,
      queryFn: async () => {
        const result = await sdk.client.file.readRaw({ path: path! })
        // WHY: parseMemoryNote runs in a memo; a payload without text used to
        // throw there and take the whole app down instead of this pane.
        if (typeof result.data?.content !== "string") throw new Error("Memory note was not found")
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
          return typeof result.data?.content === "string" ? parseMemoryNote(candidate.path, result.data.content) : undefined
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
  const graphFilters: MemoryGraphFilters = {
    get depth() { return graphDepth() },
    get tags() { return graphTags() },
    get orphans() { return graphOrphans() },
    onDepth: setGraphDepth,
    onTags: setGraphTags,
    onOrphans: setGraphOrphans,
  }
  const openFromGraph = (path: string) => { setSelectedPath(path); setDrawer(undefined); setSurface("note") }
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

  // #m69Back / #m69Forward: the notes opened in this panel, in order.
  const [history, setHistory] = createSignal<readonly string[]>([])
  const [historyIndex, setHistoryIndex] = createSignal(-1)
  let walking = false
  createEffect(
    on(selectedPath, (path) => {
      if (!path) return
      if (walking) {
        walking = false
        return
      }
      const kept = history().slice(0, historyIndex() + 1)
      if (kept[kept.length - 1] === path) return
      setHistory([...kept, path])
      setHistoryIndex(kept.length)
    }),
  )
  const canWalk = (step: -1 | 1) => {
    const path = history()[historyIndex() + step]
    return !!path && notes().some((item) => item.path === path)
  }
  function walk(step: -1 | 1): void {
    if (!canWalk(step)) return
    const index = historyIndex() + step
    const path = history()[index]
    if (saveState() === "unsaved") void persistNote("auto")
    setHistoryIndex(index)
    if (path === selectedPath()) return
    walking = true
    setSelectedPath(path)
  }

  // #m69Attach: the note as a file in the prompt's context, the way the
  // editor attaches a file (ADR-084).
  const prompt = usePrompt()
  const attachedKey = createMemo(() => {
    const path = selectedPath()
    if (!path) return undefined
    return prompt.context.items().find((item) => item.type === "file" && item.path === path && !item.selection && !item.commentID)?.key
  })
  function toggleAttached(): void {
    const path = selectedPath()
    if (!path) return
    const key = attachedKey()
    if (key) prompt.context.remove(key)
    else prompt.context.add({ type: "file", path })
  }

  const modified = createMemo(() => {
    const mtime = noteFile.data?.stamp?.mtime
    if (!mtime) return undefined
    const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }
    // WHY: some app locale ids ("zht") are not BCP 47 tags; Intl throws on them.
    const format = (() => {
      try {
        return new Intl.DateTimeFormat(language.locale(), options)
      } catch {
        return new Intl.DateTimeFormat(undefined, options)
      }
    })()
    return t("workbench.memory.modified", { date: format.format(mtime) })
  })

  useModeInspector().publish("memory", () =>
    memoryInspectorCards(
      {
        note: note(),
        location: memoryDisplayPath(selectedPath() ?? "", MEMORY_ROOT),
        modified: modified(),
        backlinkCount: backlinks().length,
        attached: !!attachedKey(),
        onToggleAttached: toggleAttached,
      },
      t,
    ),
  )

  useModeNavigation().publish("memory", () =>
    memoryNavSections(
      {
        surface: surface(),
        noteCount: notes().length,
        backlinkCount: backlinks().length,
        onShowNotes: () => setSurface("note"),
        onShowGraph: () => setSurface("graph"),
        onShowBacklinks: () => {
          setContextView("links")
          if (narrow()) setDrawer("links")
          else setHideLinks(false)
        },
      },
      t,
    ),
  )

  function openLinkedNote(target: string): void {
    const match = linkedMemoryNotes([target], notes())[0]
    if (!match || match.path === selectedPath()) return
    if (saveState() === "unsaved") void persistNote("auto")
    setSelectedPath(match.path)
  }

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
      setDrawer(undefined)
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
      setDrawer(undefined)
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
        setDrawer(undefined)
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

  // Maquette resize script: pointer drag writes the column % custom property
  // on the grid; vault grows to the right, links grows to the left.
  function resize(event: PointerEvent, edge: "vault" | "links"): void {
    if (narrow()) return
    event.preventDefault()
    const grid = gridView
    if (!grid) return
    const width = grid.clientWidth || 1
    const start = event.clientX
    const startValue = edge === "vault" ? vaultPct() : linksPct()
    const direction = edge === "vault" ? 1 : -1
    const move = (moveEvent: PointerEvent) => {
      const delta = ((moveEvent.clientX - start) / width) * 100 * direction
      const next = Math.max(RESIZE_MIN_PCT, Math.min(RESIZE_MAX_PCT, startValue + delta))
      if (edge === "vault") setVaultPct(next)
      else setLinksPct(next)
    }
    const stop = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", stop)
      window.removeEventListener("pointercancel", stop)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", stop)
    window.addEventListener("pointercancel", stop)
  }

  return (
    <section data-v110="memory-panel" data-parity="memory.panel">
      <Show when={workbench.uiPhase() !== "ready"}>
        <ConnectionBanner dataAttr="memory-connection" dataRetryAttr="memory-retry" />
      </Show>
      <div
        ref={(element) => { gridView = element }}
        data-v110="memory-grid"
        data-memory-layout={narrow() ? "single" : "triptych"}
        data-hide-vault={hideVault() && !narrow() ? "" : undefined}
        data-hide-links={hideLinks() && !narrow() ? "" : undefined}
        style={{ "--memory-vault-width": `${vaultPct()}%`, "--memory-links-width": `${linksPct()}%` }}
      >
        <aside data-memory-vault data-drawer-open={narrow() && drawer() === "vault" ? "" : undefined} onDragEnd={endDrag}>
          <div data-memory-head>
            <div data-memory-head-row>
              <Show when={narrow()}>
                <button type="button" data-memory-close-drawer title={t("memory.ui.hideVault")} aria-label={t("memory.ui.hideVault")} onClick={() => setDrawer(undefined)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 18-6-6 6-6" /></svg>
                </button>
              </Show>
              <h2>{t("workbench.memory.vault.title")}</h2>
              <div data-memory-spacer />
              <button type="button" data-memory-new-note title={t("workbench.memory.actions.newNote")} aria-label={t("workbench.memory.actions.newNote")} onClick={() => void createNote(MEMORY_ROOT)}><Icon name="plus" size="small" /></button>
              <button type="button" data-memory-new-folder title={t("workbench.memory.actions.newFolder")} aria-label={t("workbench.memory.actions.newFolder")} onClick={() => void createFolder(MEMORY_ROOT)}><Icon name="folder-add-left" size="small" /></button>
              <Show when={!narrow()}><button type="button" data-memory-hide-vault title={t("memory.ui.hideVault")} aria-label={t("memory.ui.hideVault")} onClick={() => setHideVault(true)}>◂</button></Show>
            </div>
            <div data-memory-search-wrap>
              <div data-memory-search>
                <span aria-hidden="true">⌕</span>
                <input value={query()} onInput={(event) => setQuery(event.currentTarget.value)} aria-label={t("workbench.memory.vault.searchLabel")} placeholder={t("workbench.memory.vault.searchPlaceholder")} />
              </div>
            </div>
          </div>
          <div ref={(element) => { vaultScroll = element }} data-memory-tree>
            <Show when={files.error}><p>{t("workbench.memory.vault.loadError")}</p></Show>
            <For each={visibleRows()}>{(item) => <Switch>
              <Match when={item.kind === "folder"}>
                <button type="button" data-memory-folder={item.path} data-drop={dropFolder() === item.path ? "" : undefined} style={{ "padding-left": `${item.depth * TREE_INDENT_PX}px` }} aria-expanded={!collapsed().has(item.path)} aria-label={t(collapsed().has(item.path) ? "workbench.memory.tree.expand" : "workbench.memory.tree.collapse", { name: item.name })} onContextMenu={(event) => openMenu(event, "folder", item.path, item.name)} onClick={() => toggleFolder(item.path)} onDragOver={(event) => overFolder(event, item.path)} onDragLeave={() => { if (dropFolder() === item.path) setDropFolder(undefined) }} onDrop={(event) => void dropOnFolder(event, item.path)}>
                  <span aria-hidden="true">{collapsed().has(item.path) ? "▸" : "⌄"}</span>
                  <span>{item.name}</span>
                  <Show when={item.count > 0}><span data-memory-count>{item.count}</span></Show>
                </button>
              </Match>
              <Match when={item.kind === "note"}>
                <Show when={renaming() === item.path} fallback={<button type="button" data-memory-note={item.path} data-active={selectedPath() === item.path ? "" : undefined} data-drag={dragPath() === item.path ? "" : undefined} style={{ "padding-left": `${item.depth * TREE_INDENT_PX + 12}px` }} draggable="true" title={item.path} onDragStart={(event) => startDrag(event, item.path)} onContextMenu={(event) => openMenu(event, "note", item.path, item.name)} onClick={() => { if (saveState() === "unsaved") void persistNote("auto"); setSelectedPath(item.path); setDrawer(undefined) }}><span aria-hidden="true">◈</span>{item.name}</button>}>
                  <input data-memory-rename style={{ "padding-left": `${item.depth * TREE_INDENT_PX + 12}px` }} value={renameDraft()} aria-label={t("workbench.memory.actions.rename")} ref={(element) => element.focus()} onInput={(event) => setRenameDraft(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") void commitRename(); if (event.key === "Escape") setRenaming(undefined) }} onBlur={() => { if (renaming() === item.path) void commitRename() }} />
                </Show>
              </Match>
            </Switch>}</For>
            <Show when={!!connection() && !files.isLoading && !files.error && visibleRows().length === 0 && !query().trim()}><p>{t("workbench.memory.vault.empty", { root: MEMORY_ROOT })}</p></Show>
          </div>
        </aside>
        <div data-memory-resizer="vault" title={t("memory.ui.resizeVault")} onPointerDown={(event) => resize(event, "vault")} />
        <article data-memory-note-pane>
          {/* The reference's .note-toolbar (ADR-084): note history, the save
              state (a click saves now), the context toggle, the Edit/Preview/
              Split switch, the note's actions and the links toggle. */}
          <header data-memory-toolbar>
            <Show when={hideVault() && !narrow()}>
              <button type="button" data-memory-show-vault data-memory-toolbar-btn title={t("workbench.memory.toolbar.showVault")} aria-label={t("workbench.memory.toolbar.showVault")} onClick={() => setHideVault(false)}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 18 6-6-6-6" /></svg>
              </button>
            </Show>
            <Show when={narrow()}>
              <button type="button" data-memory-back-to-vault data-memory-toolbar-btn title={t("workbench.memory.toolbar.showVault")} aria-label={t("workbench.memory.toolbar.showVault")} aria-expanded={drawer() === "vault"} onClick={() => toggleDrawer("vault")}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 18 6-6-6-6" /></svg>
              </button>
            </Show>
            <div data-memory-nav>
              <button type="button" data-memory-toolbar-btn data-memory-back title={t("workbench.memory.toolbar.back")} aria-label={t("workbench.memory.toolbar.back")} disabled={!canWalk(-1)} onClick={() => walk(-1)}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 18-6-6 6-6" /></svg>
              </button>
              <button type="button" data-memory-toolbar-btn data-memory-forward title={t("workbench.memory.toolbar.forward")} aria-label={t("workbench.memory.toolbar.forward")} disabled={!canWalk(1)} onClick={() => walk(1)}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 18 6-6-6-6" /></svg>
              </button>
            </div>
            <button type="button" data-memory-status data-memory-save data-memory-save-state={saveState()} title={t("workbench.memory.toolbar.save")} disabled={saving() || saveState() !== "unsaved"} onClick={() => void persistNote("manual")}>
              <i />
              <span>{t(`workbench.memory.status.${saveState()}`)}</span>
            </button>
            <div data-memory-spacer />
            <Show when={note()}>
              <button
                type="button"
                data-memory-toolbar-btn
                data-memory-attach
                data-attached={attachedKey() ? "" : undefined}
                aria-pressed={!!attachedKey()}
                title={attachedKey() ? t("workbench.memory.toolbar.detach") : t("workbench.memory.toolbar.attach")}
                onClick={toggleAttached}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" /></svg>
                <span>{attachedKey() ? t("workbench.memory.toolbar.attached") : t("workbench.memory.toolbar.context")}</span>
              </button>
            </Show>
            <div data-memory-switches>
            <div data-memory-mode-switch classList={{ hidden: narrow() && surface() === "graph" }}>
              <button type="button" data-v110="segment" aria-pressed={view() === "source"} onClick={() => setView("source")}>{t("common.edit")}</button>
              <button type="button" data-v110="segment" aria-pressed={view() === "preview"} onClick={() => setView("preview")}>{t("memory.ui.preview")}</button>
              <button type="button" data-v110="segment" aria-pressed={view() === "split"} classList={{ hidden: viewport() === "phone-portrait" }} onClick={() => setView("split")}>{t("memory.ui.split")}</button>
            </div>
            <Show when={narrow()}>
              <div data-memory-surface-switch>
                <button type="button" data-v110="segment" aria-pressed={surface() === "note"} onClick={() => setSurface("note")}>{t("memory.ui.note")}</button>
                <button type="button" data-v110="segment" aria-pressed={surface() === "graph"} onClick={() => setSurface("graph")}>{t("memory.ui.graph")}</button>
              </div>
            </Show>
            </div>
            <Show when={note()}>
              {(current) => (
                <button type="button" data-memory-toolbar-btn data-memory-more title={t("workbench.memory.toolbar.more")} aria-label={t("workbench.memory.toolbar.more")} onClick={(event) => openMenu(event, "note", current().path, current().title)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>
                </button>
              )}
            </Show>
            <Show when={hideLinks() && !narrow()}>
              <button type="button" data-memory-show-links data-memory-toolbar-btn title={t("workbench.memory.toolbar.showLinks")} aria-label={t("workbench.memory.toolbar.showLinks")} onClick={() => setHideLinks(false)}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 18-6-6 6-6" /></svg>
              </button>
            </Show>
            <Show when={narrow()}>
              <button type="button" data-memory-open-links data-memory-toolbar-btn title={t("workbench.memory.toolbar.showLinks")} aria-label={t("workbench.memory.toolbar.showLinks")} aria-expanded={drawer() === "links"} onClick={() => toggleDrawer("links")}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 18-6-6 6-6" /></svg>
              </button>
            </Show>
          </header>
          <div data-memory-body>
            <Show when={narrow() && surface() === "graph"} fallback={<>
            <Show when={noteFile.isLoading}><p>Loading note…</p></Show>
            <Show when={noteFile.error}><p data-error>Unable to read this note.</p></Show>
            <Show when={note()}>{(current) => (
              <div data-v110="memory-doc" data-memory-view={view()}>
                <div data-memory-topline>
                  <span data-memory-path title={current().path}>{memoryDisplayPath(current().path, MEMORY_ROOT)}</span>
                </div>
                <Show when={view() !== "preview"} fallback={
                  <MemoryPreview note={current()} raw={noteFile.data?.content ?? ""} modified={modified()} onOpenLink={openLinkedNote} />
                }>
                  <MemoryEditorHead raw={draft()} onChange={onDraftChange} titleLabel={t("workbench.memory.editor.title")} tagsLabel={t("workbench.memory.editor.tags")} />
                  <Show when={view() === "split"} fallback={
                    <MemoryEditor value={memoryDraftParts(draft()).body} onInput={(value) => onDraftChange(withMemoryBody(draft(), value))} />
                  }>
                    <div data-memory-split>
                      <MemoryEditor value={memoryDraftParts(draft()).body} onInput={(value) => onDraftChange(withMemoryBody(draft(), value))} />
                      <div data-memory-preview-pane>
                        <MemoryPreview note={parseMemoryNote(current().path, draft())} raw={draft()} modified={modified()} onOpenLink={openLinkedNote} />
                      </div>
                    </div>
                  </Show>
                </Show>
              </div>
            )}</Show>
            <Show when={!note() && !noteFile.isLoading && !noteFile.error}><p data-memory-empty>Choose a note from the vault.</p></Show>
            </>}>
              <MemoryKnowledgeGraph graph={graph()} selectedPath={selectedPath()} filters={graphFilters} onOpen={openFromGraph} />
            </Show>
          </div>
        </article>
        <div data-memory-resizer="links" title={t("memory.ui.resizeLinks")} onPointerDown={(event) => resize(event, "links")} />
        <aside data-memory-links data-drawer-open={narrow() && drawer() === "links" ? "" : undefined}>
          <div data-memory-head>
            <div data-memory-head-row>
              <b>Links &amp; context</b>
              <div data-memory-spacer />
              <Show when={!narrow()}><button type="button" data-memory-hide-links title={t("memory.ui.hideLinks")} aria-label={t("memory.ui.hideLinks")} onClick={() => setHideLinks(true)}>▸</button></Show>
              <Show when={narrow()}>
                <button type="button" data-memory-back-to-note data-memory-close-drawer title={t("memory.ui.hideLinks")} aria-label={t("memory.ui.hideLinks")} onClick={() => setDrawer(undefined)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 18 6-6-6-6" /></svg>
                </button>
              </Show>
            </div>
            <div data-memory-tabs>
              <button type="button" aria-pressed={contextView() === "links"} data-active={contextView() === "links" ? "" : undefined} onClick={() => setContextView("links")}>{t("memory.ui.links")}</button>
              <button type="button" aria-pressed={contextView() === "graph"} data-active={contextView() === "graph" ? "" : undefined} onClick={() => setContextView("graph")}>{t("memory.ui.localGraph")}</button>
            </div>
          </div>
          <div data-memory-side-scroll>
            <Show when={contextView() === "links"} fallback={
              <MemoryGraph graph={graph()} selectedPath={selectedPath()} filters={graphFilters} onOpen={openFromGraph} />
            }>
              <Show when={note() && linked().length > 0} fallback={<p>No resolved links for this note.</p>}>
                <For each={linked()}>{(item) => (
                  <button type="button" data-memory-link-card title={`${item.title}\n${linkedExcerpt().get(item.path) ?? ""}`} onClick={() => { setSelectedPath(item.path); setDrawer(undefined) }}>
                    <b>{item.title}</b>
                    <p>{linkedExcerpt().get(item.path) ?? ""}</p>
                  </button>
                )}</For>
              </Show>
              <Show when={backlinks().length}>
                <h3>Backlinks</h3>
                <For each={backlinks()}>{(item) => (
                  <button type="button" data-memory-link-card title={`${item.title}\n${backlinksExcerpt().get(item.path) ?? ""}`} onClick={() => { setSelectedPath(item.path); setDrawer(undefined) }}>
                    <b>{item.title}</b>
                    <p>{backlinksExcerpt().get(item.path) ?? ""}</p>
                  </button>
                )}</For>
              </Show>
            </Show>
          </div>
        </aside>
        <Show when={narrow() && drawer()}>
          <button type="button" data-memory-scrim tabindex="-1" aria-label={t("common.close")} onClick={() => setDrawer(undefined)} />
        </Show>
      </div>
      <Show when={menu()}>{(current) => <>
        <div class="fixed inset-0 z-40" data-memory-menu-backdrop onClick={closeMenu} onContextMenu={(event) => { event.preventDefault(); closeMenu() }} />
        <div class="fixed z-50" data-memory-menu style={{ left: `${current().x}px`, top: `${current().y}px` }} role="menu">
          <Show when={!moving()} fallback={<>
            <button type="button" data-memory-menu-item="move-root" onClick={() => void moveNoteTo(current().target, MEMORY_ROOT)}>{t("workbench.memory.vault.title")}</button>
            <For each={folders()}>{(folder) => <button type="button" data-memory-menu-item="move-folder" onClick={() => void moveNoteTo(current().target, folder.path)}>{folder.name}</button>}</For>
          </>}>
            <For each={memoryMenuActions(current().kind)}>{(action) => <button type="button" data-memory-menu-item={action} data-danger={action === "delete" ? "" : undefined} onClick={() => runAction(action)}>{t(`workbench.memory.actions.${action}`)}</button>}</For>
          </Show>
        </div>
      </>}</Show>
    </section>
  )
}
