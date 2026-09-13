/* SPDX-License-Identifier: MIT */

/** Pure Markdown presentation helpers for the read-only Memory inspector. */

export type MemoryNoteSummary = {
  readonly path: string
  readonly title: string
}

export type MemoryNoteDocument = MemoryNoteSummary & {
  readonly body: string
  readonly tags: readonly string[]
  readonly links: readonly string[]
}

export type MemoryGraphNode = MemoryNoteSummary & {
  readonly x: number
  readonly y: number
}

const MEMORY_PREFIX = ".unifia/memory/"

export function isMemoryMarkdown(path: string): boolean {
  return path.startsWith(MEMORY_PREFIX) && path.toLowerCase().endsWith(".md")
}

export function memoryTitle(path: string): string {
  const filename = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "")
  return filename || path
}

/** First non-empty paragraph of the body, truncated to a single line. Used
 * for hover previews in the vault and the links-context panel. */
export function memoryExcerpt(body: string, max = 120): string {
  const collapsed = body
    .replace(/!\[[^\]]*]\([^)]*\)/g, "") // strip images
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1") // unwrap links to text
    .replace(/[`*_>#~-]+/g, " ") // strip inline markdown noise
    .replace(/\s+/g, " ")
    .trim()
  if (collapsed.length <= max) return collapsed
  const slice = collapsed.slice(0, max)
  const lastSpace = slice.lastIndexOf(" ")
  return (lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice).trimEnd() + "…"
}

export function parseMemoryNote(path: string, raw: string): MemoryNoteDocument {
  const withoutFrontmatter = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
  const headingMatch = withoutFrontmatter.match(/^#\s+(.+)(?:\r?\n|$)/)
  const heading = headingMatch?.[1]?.trim()
  const tags = [...new Set([...withoutFrontmatter.matchAll(/(^|\s)#([\p{L}\p{N}_-]+)/gu)].map((match) => match[2]))]
  const links = [...new Set([...withoutFrontmatter.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)].map((match) => match[1].trim()).filter(Boolean))]
  const body = headingMatch ? withoutFrontmatter.slice(headingMatch[0].length) : withoutFrontmatter
  return { path, title: heading || memoryTitle(path), body, tags, links }
}

export function linkedMemoryNotes(
  links: readonly string[],
  notes: readonly MemoryNoteSummary[],
): readonly MemoryNoteSummary[] {
  const normalized = new Set(links.map((link) => link.replace(/\.md$/i, "").toLocaleLowerCase()))
  return notes.filter((note) => normalized.has(memoryTitle(note.path).toLocaleLowerCase()))
}

export function memoryBacklinks(
  selected: MemoryNoteSummary,
  documents: readonly MemoryNoteDocument[],
): readonly MemoryNoteSummary[] {
  const target = memoryTitle(selected.path).replace(/\.md$/i, "").toLocaleLowerCase()
  return documents
    .filter((document) => document.path !== selected.path && document.links.some((link) => link.replace(/\.md$/i, "").toLocaleLowerCase() === target))
    .map(({ path, title }) => ({ path, title }))
}

/** A deterministic local graph: the selected note and its resolved neighbours. */
export function localMemoryGraph(
  selected: MemoryNoteSummary,
  linked: readonly MemoryNoteSummary[],
): readonly MemoryGraphNode[] {
  if (linked.length === 0) return [{ ...selected, x: 50, y: 50 }]
  return [
    { ...selected, x: 50, y: 50 },
    ...linked.map((note, index) => {
      const angle = (Math.PI * 2 * index) / linked.length - Math.PI / 2
      return { ...note, x: 50 + Math.cos(angle) * 34, y: 50 + Math.sin(angle) * 34 }
    }),
  ]
}

/** A vault row: one folder or one note, in pre-order render order. */
export type MemoryTreeRow = {
  readonly kind: "folder" | "note"
  readonly path: string
  readonly name: string
  /** 0 for a direct child of the memory root. */
  readonly depth: number
  /** Notes in the folder's subtree; always 0 for note rows. */
  readonly count: number
}

/** The subset of `WorkspaceFileEntry` the vault tree needs - structural, so the
 * panel passes the real listing without this model depending on workbench-shell. */
export type MemoryFileEntry = {
  readonly path: string
  readonly kind: "file" | "directory"
}

type MemoryFolderDraft = {
  path: string
  name: string
  depth: number
  count: number
  folders: MemoryFolderDraft[]
  notes: MemoryNoteSummary[]
}

export function memoryParentFolder(path: string): string {
  const index = path.lastIndexOf("/")
  return index === -1 ? "" : path.slice(0, index)
}

/** New path when `notePath` is dropped on `folderPath`. `undefined` when the
 * move is a no-op (same folder) or the target is not a vault folder. */
export function memoryMovePath(notePath: string, folderPath: string): string | undefined {
  if (!isMemoryMarkdown(notePath)) return undefined
  if (!folderPath.startsWith(MEMORY_PREFIX) || folderPath.endsWith(".md")) return undefined
  if (memoryParentFolder(notePath) === folderPath) return undefined
  return folderPath + "/" + notePath.slice(notePath.lastIndexOf("/") + 1)
}

/** Flat pre-order vault tree (folders before notes, alphabetical). Directory
 * entries keep empty folders visible; note parent segments are added
 * defensively so a paginated listing still reconstructs the shape. */
export function buildMemoryTree(entries: readonly MemoryFileEntry[]): readonly MemoryTreeRow[] {
  const root: MemoryFolderDraft = { path: "", name: "", depth: -1, count: 0, folders: [], notes: [] }
  const folders = new Map<string, MemoryFolderDraft>([["", root]])

  function ensureFolder(path: string): MemoryFolderDraft {
    // The vault root is implicit: anything at or above it maps to the root
    // draft, so recursion never climbs into `.unifia` itself.
    if (!path.startsWith(MEMORY_PREFIX)) return root
    const existing = folders.get(path)
    if (existing) return existing
    const parent = ensureFolder(memoryParentFolder(path))
    const folder: MemoryFolderDraft = { path, name: path.slice(path.lastIndexOf("/") + 1), depth: parent.depth + 1, count: 0, folders: [], notes: [] }
    folders.set(path, folder)
    parent.folders.push(folder)
    return folder
  }

  for (const entry of entries) {
    if (entry.kind === "directory" && entry.path.startsWith(MEMORY_PREFIX)) ensureFolder(entry.path)
  }
  const seen = new Set<string>()
  for (const entry of entries) {
    if (entry.kind !== "file" || !isMemoryMarkdown(entry.path) || seen.has(entry.path)) continue
    seen.add(entry.path)
    ensureFolder(memoryParentFolder(entry.path)).notes.push({ path: entry.path, title: memoryTitle(entry.path) })
  }

  const rows: MemoryTreeRow[] = []
  function countNotes(folder: MemoryFolderDraft): number {
    folder.count = folder.notes.length + folder.folders.reduce((sum, child) => sum + countNotes(child), 0)
    return folder.count
  }
  countNotes(root)
  function flatten(folder: MemoryFolderDraft): void {
    folder.folders.sort((left, right) => left.name.localeCompare(right.name))
    folder.notes.sort((left, right) => left.title.localeCompare(right.title))
    for (const child of folder.folders) {
      rows.push({ kind: "folder", path: child.path, name: child.name, depth: child.depth, count: child.count })
      flatten(child)
    }
    for (const note of folder.notes) rows.push({ kind: "note", path: note.path, name: note.title, depth: folder.depth + 1, count: 0 })
  }
  flatten(root)
  return rows
}

/** Rows whose ancestor folders are all expanded. */
export function visibleMemoryRows(rows: readonly MemoryTreeRow[], collapsed: ReadonlySet<string>): readonly MemoryTreeRow[] {
  if (collapsed.size === 0) return rows
  return rows.filter((row) => ![...collapsed].some((folder) => row.path.startsWith(folder + "/")))
}

/** v110 Memory editor: the mockup shows one status chip next to the note
 * ("Saved" / "Saving..." / "Unsaved") and debounces writes by 700 ms. */
export type MemorySaveState = "saved" | "unsaved" | "saving"

export function memorySaveState(draft: string, diskContent: string | undefined, saving: boolean): MemorySaveState {
  if (saving) return "saving"
  if (diskContent === undefined) return "saved"
  return draft === diskContent ? "saved" : "unsaved"
}

/** Context-menu actions the vault offers per row kind. `pin`, `archive`,
 * folder rename/move/delete are absent on purpose: the runtime has no
 * capability behind them, and the port must not fake one. */
export type MemoryAction = "open" | "rename" | "duplicate" | "move" | "export" | "delete" | "newNote" | "newFolder"

export function memoryMenuActions(kind: "note" | "folder"): readonly MemoryAction[] {
  return kind === "folder" ? ["newNote", "newFolder"] : ["open", "rename", "duplicate", "move", "export", "delete"]
}

/** Unique destination inside a vault folder, maquette style: `name.md`,
 * `name-2.md`, ... (`name`, `name-2`, ... when the extension is empty). */
export function memoryUniquePath(existing: readonly string[], folder: string, stem: string, extension = ".md"): string {
  const clean = stem.replace(/[\\/]/g, "-").replace(/^\.+/, "").trim() || "note"
  for (let index = 1; ; index += 1) {
    const candidate = folder + "/" + (index === 1 ? clean : clean + "-" + index) + extension
    if (!existing.includes(candidate)) return candidate
  }
}

/** Exact rename target for a note stem; `undefined` when the stem is empty
 * or the source is not a vault note. Collisions are the caller's guard. */
export function memoryRenamePath(notePath: string, stem: string): string | undefined {
  if (!isMemoryMarkdown(notePath)) return undefined
  const clean = stem.replace(/[\\/]/g, "-").replace(/^\.+/, "").trim()
  if (!clean) return undefined
  return memoryParentFolder(notePath) + "/" + clean + ".md"
}

/** Graph edges are either resolvable note-to-note links or tag-to-note
 * membership edges (`from` is `tag:<name>` for the latter). */
export type MemoryGraphEdge = { readonly from: string; readonly to: string; readonly kind: "note" | "tag" }
export type MemoryGraphTag = { readonly tag: string; readonly x: number; readonly y: number }
export type MemoryGraphData = {
  readonly nodes: readonly MemoryGraphNode[]
  readonly tags: readonly MemoryGraphTag[]
  readonly edges: readonly MemoryGraphEdge[]
}

const GRAPH_NOTE_RADIUS = 30
const GRAPH_TAG_RADIUS = 44
const GRAPH_MAX_TAGS = 8
const GRAPH_TAG_NOTES = 3

function graphKey(value: string): string {
  return value.replace(/\.md$/i, "").toLocaleLowerCase()
}

/** Depth-N knowledge graph around the selected note (maquette defaults:
 * depth 2, tags on, orphans on). Reachability walks resolved links in both
 * directions; `orphans: false` drops nodes without any edge, the selected
 * one included, exactly like the reference filter. Tags render as an outer
 * ring of the 8 most frequent tags with up to 3 note membership edges. */
export function memoryGraphAtDepth(
  selected: MemoryNoteSummary,
  notes: readonly MemoryNoteSummary[],
  documents: readonly MemoryNoteDocument[],
  depth: number,
  options: { readonly orphans: boolean; readonly tags: boolean },
): MemoryGraphData {
  const byKey = new Map(notes.map((note) => [graphKey(memoryTitle(note.path)), note.path]))
  const byPath = new Map(notes.map((note) => [note.path, note]))
  const documentByPath = new Map(documents.map((document) => [document.path, document]))

  const adjacency = new Map<string, Set<string>>()
  const connect = (left: string, right: string): void => {
    if (left === right) return
    if (!adjacency.has(left)) adjacency.set(left, new Set())
    if (!adjacency.has(right)) adjacency.set(right, new Set())
    adjacency.get(left)!.add(right)
    adjacency.get(right)!.add(left)
  }
  for (const note of notes) {
    const document = documentByPath.get(note.path)
    if (!document) continue
    for (const link of document.links) {
      const target = byKey.get(graphKey(link))
      if (target) connect(note.path, target)
    }
  }

  const start = byPath.has(selected.path) ? selected.path : (byKey.get(graphKey(memoryTitle(selected.path))) ?? selected.path)
  const hops = Math.max(1, Math.min(3, Math.trunc(depth)))
  const reachable = new Set<string>([start])
  let front = [start]
  for (let step = 0; step < hops; step += 1) {
    const next: string[] = []
    for (const path of front) {
      for (const neighbour of adjacency.get(path) ?? []) {
        if (reachable.has(neighbour)) continue
        reachable.add(neighbour)
        next.push(neighbour)
      }
    }
    front = next
  }

  const included = notes.filter((note) => {
    if (!reachable.has(note.path)) return false
    if (options.orphans) return true
    return (adjacency.get(note.path)?.size ?? 0) > 0
  })
  const includedPaths = new Set(included.map((note) => note.path))

  const others = included.filter((note) => note.path !== start)
  const positions = new Map<string, { x: number; y: number }>([[start, { x: 50, y: 50 }]])
  others.forEach((note, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(1, others.length) - Math.PI / 2
    positions.set(note.path, { x: 50 + Math.cos(angle) * GRAPH_NOTE_RADIUS, y: 50 + Math.sin(angle) * GRAPH_NOTE_RADIUS })
  })
  const nodes: MemoryGraphNode[] = included.map((note) => ({ ...note, ...positions.get(note.path)! }))

  const countByTag = new Map<string, number>()
  for (const note of included) {
    for (const tag of documentByPath.get(note.path)?.tags ?? []) countByTag.set(tag, (countByTag.get(tag) ?? 0) + 1)
  }
  const tags: MemoryGraphTag[] = []
  const tagEdges: MemoryGraphEdge[] = []
  if (options.tags) {
    const top = [...countByTag.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, GRAPH_MAX_TAGS)
    top.forEach(([tag], index) => {
      const angle = (Math.PI * 2 * index) / Math.max(1, top.length) - Math.PI / 2
      tags.push({ tag, x: 50 + Math.cos(angle) * GRAPH_TAG_RADIUS, y: 50 + Math.sin(angle) * GRAPH_TAG_RADIUS })
      const tagged = included.filter((note) => (documentByPath.get(note.path)?.tags ?? []).includes(tag)).slice(0, GRAPH_TAG_NOTES)
      for (const note of tagged) tagEdges.push({ from: 'tag:' + tag, to: note.path, kind: 'tag' })
    })
  }

  const edges: MemoryGraphEdge[] = []
  for (const [from, neighbours] of adjacency) {
    if (!includedPaths.has(from)) continue
    for (const to of neighbours) if (includedPaths.has(to) && from < to) edges.push({ from, to, kind: 'note' })
  }
  return { nodes, tags, edges: [...edges, ...tagEdges] }
}
