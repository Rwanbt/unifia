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
