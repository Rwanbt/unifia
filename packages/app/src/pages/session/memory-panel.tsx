/* SPDX-License-Identifier: MIT */

import { For, Match, Show, Switch, createEffect, createMemo, createSignal, type JSX } from "solid-js"
import { createQuery } from "@tanstack/solid-query"
import { showToast } from "@unifia/ui/toast"
import { Markdown } from "@unifia/ui/markdown"
import type { WorkbenchConnection } from "@unifia/workbench-shell"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import { useWorkspaceWorkbench } from "@/context/workbench/provider"
import { workbenchQueryKey } from "@/context/workbench/query-keys"
import { ConnectionBanner } from "@/pages/workbench/connection-banner"
import { useViewport } from "@/shell/v110-store"
import { buildMemoryTree, isMemoryMarkdown, linkedMemoryNotes, localMemoryGraph, memoryBacklinks, memoryExcerpt, memoryMovePath, memoryTitle, parseMemoryNote, visibleMemoryRows, type MemoryFileEntry, type MemoryNoteDocument } from "./memory-panel-model"

const MEMORY_ROOT = ".unifia/memory"
// The mockup expands a collapsed folder after 620 ms of drag-hover; the panel
// mirrors that so a deep drop target is reachable without stopping the drag.
const AUTO_EXPAND_DELAY_MS = 620
const TREE_INDENT_PX = 18
const MAX_MEMORY_PAGES = 20

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
  const [selectedPath, setSelectedPath] = createSignal<string>()
  const [query, setQuery] = createSignal("")
  const [view, setView] = createSignal<"preview" | "source" | "split">("preview")
  const [contextView, setContextView] = createSignal<"links" | "graph">("links")
  const [draft, setDraft] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set())
  const [dragPath, setDragPath] = createSignal<string>()
  const [dropFolder, setDropFolder] = createSignal<string>()
  let expandTimer: ReturnType<typeof setTimeout> | undefined
  let vaultScroll: HTMLDivElement | undefined
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
  const backlinksQueryOptions = createMemo(() => {
    const selected = selectedPath()
    const candidates = notes()
    return {
      queryKey: ["memory-backlinks", sdk.directory, selected ?? "", candidates.map((candidate) => candidate.path).join("|")] as const,
      enabled: !!selected && candidates.length > 0,
      queryFn: async () => {
        const documents = await Promise.all(candidates.map(async (candidate) => {
          const result = await sdk.client.file.readRaw({ path: candidate.path })
          return result.data ? parseMemoryNote(candidate.path, result.data.content) : undefined
        }))
        return memoryBacklinks({ path: selected!, title: memoryTitle(selected!) }, documents.filter((document): document is MemoryNoteDocument => !!document))
      },
    }
  })
  const backlinks = createQuery(backlinksQueryOptions)
  const relatedNotes = createMemo(() => [...new Map([...linked(), ...(backlinks.data ?? [])].map((related) => [related.path, related])).values()])
  const graph = createMemo(() => note() ? localMemoryGraph(note()!, relatedNotes()) : [])
  const linkedExcerpt = createMemo(() => {
    const current = note()
    if (!current) return new Map<string, string>()
    return new Map(linked().map((item) => [item.path, memoryExcerpt(current.body, 120)]))
  })
  const backlinksExcerpt = createMemo(() => {
    const current = note()
    if (!current) return new Map<string, string>()
    return new Map((backlinks.data ?? []).map((item) => [item.path, memoryExcerpt(current.body, 120)]))
  })
  createEffect(() => {
    const content = noteFile.data?.content
    if (content !== undefined) setDraft(content)
  })

  async function saveNote(): Promise<void> {
    const path = selectedPath()
    const current = noteFile.data
    if (!path || !current || saving()) return
    setSaving(true)
    try {
      const result = await sdk.client.file.write({ path, content: draft(), expectedHash: current.stamp.hash })
      if (result.response?.status === 409) {
        showToast({ variant: "error", title: t("workbench.memory.save.conflict") })
        return
      }
      if (!result.data) throw new Error(t("workbench.memory.save.failed"))
      await noteFile.refetch()
      showToast({ variant: "success", title: t("workbench.memory.save.saved") })
    } catch (error) {
      showToast({ variant: "error", title: t("workbench.memory.save.failed"), description: error instanceof Error ? error.message : String(error) })
    } finally {
      setSaving(false)
    }
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

  return (
    <section class="flex size-full min-w-0 flex-col gap-2 bg-background-base p-3" data-v110="memory-panel">
      <ConnectionBanner dataAttr="memory-connection" dataRetryAttr="memory-retry" />
      <div
        class={narrow()
          ? "grid min-h-0 flex-1 grid-cols-1 gap-3"
          : "grid min-h-0 flex-1 grid-cols-[minmax(180px,0.8fr)_minmax(0,1.7fr)_minmax(180px,0.8fr)] gap-3"}
        data-memory-layout={narrow() ? "single" : "triptych"}
      >
        <aside class="min-h-0 overflow-hidden rounded-lg border border-border-base bg-background-stronger" classList={{ hidden: narrow() && mobilePane() !== "vault" }} data-memory-vault onDragEnd={endDrag}>
          <div class="border-b border-border-base p-3"><h2 class="text-14-medium">{t("workbench.memory.vault.title")}</h2><input class="mt-2 w-full rounded border border-border-base bg-background-base px-2 py-1 text-12-regular" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} aria-label={t("workbench.memory.vault.searchLabel")} placeholder={t("workbench.memory.vault.searchPlaceholder")} /></div>
          <div ref={(element) => { vaultScroll = element }} class="h-[calc(100%-76px)] overflow-y-auto p-2">
            <Show when={files.error}><p class="text-12-regular text-text-danger">{t("workbench.memory.vault.loadError")}</p></Show>
            <For each={visibleRows()}>{(item) => <Switch>
              <Match when={item.kind === "folder"}>
                <button type="button" class="mb-1 flex w-full items-center gap-1 rounded px-2 py-2 text-left text-12-regular hover:bg-background-base" classList={{ "bg-background-base ring-1 ring-accent-base": dropFolder() === item.path }} style={{ "padding-left": `${item.depth * TREE_INDENT_PX}px` }} data-memory-folder={item.path} aria-expanded={!collapsed().has(item.path)} aria-label={t(collapsed().has(item.path) ? "workbench.memory.tree.expand" : "workbench.memory.tree.collapse", { name: item.name })} onClick={() => toggleFolder(item.path)} onDragOver={(event) => overFolder(event, item.path)} onDragLeave={() => { if (dropFolder() === item.path) setDropFolder(undefined) }} onDrop={(event) => void dropOnFolder(event, item.path)}>
                  <span class="w-3 shrink-0 text-text-weak" aria-hidden="true">{collapsed().has(item.path) ? "▸" : "⌄"}</span>
                  <span class="min-w-0 flex-1 truncate">{item.name}</span>
                  <Show when={item.count > 0}><span class="text-11-regular text-text-weak">{item.count}</span></Show>
                </button>
              </Match>
              <Match when={item.kind === "note"}>
                <button type="button" class="mb-1 block w-full rounded px-2 py-2 text-left text-12-regular hover:bg-background-base" classList={{ "bg-background-base text-text-strong": selectedPath() === item.path, "opacity-50": dragPath() === item.path }} style={{ "padding-left": `${item.depth * TREE_INDENT_PX + 12}px` }} draggable="true" data-memory-note={item.path} title={item.path} onDragStart={(event) => startDrag(event, item.path)} onClick={() => { setSelectedPath(item.path); setMobilePane("note") }}><span class="mr-1 text-text-weak" aria-hidden="true">◈</span>{item.name}</button>
              </Match>
            </Switch>}</For>
            <Show when={!!connection() && !files.isLoading && !files.error && visibleRows().length === 0 && !query().trim()}><p class="p-2 text-12-regular text-text-weak">{t("workbench.memory.vault.empty", { root: MEMORY_ROOT })}</p></Show>
          </div>
        </aside>
        <article class="min-h-0 overflow-hidden rounded-lg border border-border-base bg-background-stronger" classList={{ hidden: narrow() && mobilePane() !== "note" }} data-memory-note-pane>
          <header class="flex items-center gap-2 border-b border-border-base px-3 py-2"><Show when={narrow()}><button type="button" class="rounded px-2 py-1 text-11-medium" data-memory-back-to-vault onClick={() => setMobilePane("vault")}>← Vault</button></Show><span class="text-12-medium">Memory</span><span class="ml-auto text-11-regular text-text-weak">CAS-protected</span><Show when={narrow()}><button type="button" class="rounded px-2 py-1 text-11-medium" data-memory-open-links onClick={() => setMobilePane("links")}>Links</button></Show><button type="button" class="rounded px-2 py-1 text-11-medium" classList={{ "bg-background-base": view() === "preview" }} onClick={() => setView("preview")}>Preview</button><button type="button" class="rounded px-2 py-1 text-11-medium" classList={{ "bg-background-base": view() === "source" }} onClick={() => setView("source")}>Edit</button><button type="button" class="rounded px-2 py-1 text-11-medium" classList={{ "bg-background-base": view() === "split", hidden: viewport() === "phone-portrait" }} onClick={() => setView("split")}>Split</button><button type="button" class="rounded bg-accent-base px-2 py-1 text-11-medium text-text-on-accent disabled:opacity-50" disabled={saving() || draft() === noteFile.data?.content} onClick={() => void saveNote()}>{saving() ? "Saving…" : "Save"}</button></header>
          <div class="h-[calc(100%-43px)] overflow-y-auto p-5">
            <Show when={noteFile.isLoading}><p class="text-12-regular text-text-weak">Loading note…</p></Show>
            <Show when={noteFile.error}><p class="text-12-regular text-text-danger">Unable to read this note.</p></Show>
            <Show when={note()}>{(current) => <><p class="text-11-regular text-text-weak">{current().path}</p><Show when={view() === "source"} fallback={<Show when={view() === "split"} fallback={<MemoryPreview note={current()} />}><div class="mt-3 grid min-h-[calc(100%-28px)] grid-cols-2 gap-3"><MemoryEditor value={draft()} onInput={setDraft} /><div class="min-w-0 overflow-y-auto rounded border border-border-base bg-background-base p-3"><MemoryPreview note={parseMemoryNote(current().path, draft())} /></div></div></Show>}><div class="mt-3 h-[calc(100%-28px)]"><MemoryEditor value={draft()} onInput={setDraft} /></div></Show></>}</Show>
            <Show when={!note() && !noteFile.isLoading && !noteFile.error}><p class="text-12-regular text-text-weak">Choose a note from the vault.</p></Show>
          </div>
        </article>
        <aside class="min-h-0 overflow-hidden rounded-lg border border-border-base bg-background-stronger" classList={{ hidden: narrow() && mobilePane() !== "links" }} data-memory-links>
          <header class="border-b border-border-base p-3"><Show when={narrow()}><button type="button" class="mb-2 rounded px-2 py-1 text-11-medium" data-memory-back-to-note onClick={() => setMobilePane("note")}>← Note</button></Show><h2 class="text-14-medium">Links &amp; context</h2><div class="mt-2 flex gap-1"><button type="button" class="rounded px-2 py-1 text-11-medium" classList={{ "bg-background-base": contextView() === "links" }} onClick={() => setContextView("links")}>Links</button><button type="button" class="rounded px-2 py-1 text-11-medium" classList={{ "bg-background-base": contextView() === "graph" }} onClick={() => setContextView("graph")}>Local graph</button></div></header>
          <div class="overflow-y-auto p-3"><Show when={contextView() === "links"} fallback={<Show when={graph().length > 0} fallback={<p class="text-12-regular text-text-weak">Choose a note to inspect its graph.</p>}><svg class="h-56 w-full" viewBox="0 0 100 100" role="img" aria-label="Local memory graph"> <For each={graph().slice(1)}>{(node) => <line x1="50" y1="50" x2={node.x} y2={node.y} stroke="currentColor" opacity="0.35" />}</For><For each={graph()}>{(node, index) => <g class="cursor-pointer" role="button" tabindex="0" onClick={() => { setSelectedPath(node.path); setMobilePane("note") }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedPath(node.path) }}><circle cx={node.x} cy={node.y} r={index() === 0 ? 8 : 6} class={index() === 0 ? "fill-accent-base" : "fill-background-strong"} stroke="currentColor" /><text x={node.x} y={node.y + 13} text-anchor="middle" class="fill-text-base text-[5px]">{node.title.slice(0, 16)}</text></g>}</For></svg></Show>}><Show when={note() && linked().length > 0} fallback={<p class="text-12-regular text-text-weak">No resolved links for this note.</p>}><For each={linked()}>{(item) => <button type="button" class="mb-2 block w-full rounded border border-border-base p-2 text-left text-12-regular hover:bg-background-base" title={`${item.title}\n${linkedExcerpt().get(item.path) ?? ""}`} onClick={() => { setSelectedPath(item.path); setMobilePane("note") }}>{item.title}</button>}</For></Show><Show when={backlinks.data?.length}><h3 class="mt-4 text-12-medium">Backlinks</h3><For each={backlinks.data}>{(item) => <button type="button" class="mt-2 block w-full rounded border border-border-base p-2 text-left text-12-regular hover:bg-background-base" title={`${item.title}\n${backlinksExcerpt().get(item.path) ?? ""}`} onClick={() => { setSelectedPath(item.path); setMobilePane("note") }}>{item.title}</button>}</For></Show></Show></div>
        </aside>
      </div>
    </section>
  )
}