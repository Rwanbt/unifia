/* SPDX-License-Identifier: MIT */

// The Memory editor's view of a note's Markdown (ADR-059): the reference
// edits the title, the tags and the body in three fields. The note stays one
// Markdown file, so each field maps to a slice of it -- the `# heading`, one
// tag-only line under it, and the rest -- and every setter rebuilds the file
// from the untouched slices. A note is never normalized: joining the parts of
// any text gives that text back.

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/
const HEADING = /^#[ \t]+(.*)(\r?\n|$)/
const TAG = /#[\p{L}\p{N}_-]+/gu
const TAG_LINE = /^[ \t]*#[\p{L}\p{N}_-]+(?:[ \t]+#[\p{L}\p{N}_-]+)*[ \t]*(?:\r?\n|$)/u
const BLANK_LINES = /^(?:[ \t]*\r?\n)*/

export type MemoryDraftParts = {
  readonly front: string
  /** The whole heading line, end of line included; "" when there is none. */
  readonly heading: string
  readonly title: string
  /** Blank lines between the heading and the tag line. */
  readonly lead: string
  /** The tag-only line, end of line included; "" when there is none. */
  readonly tagLine: string
  /** Blank lines after the tag line. */
  readonly trail: string
  readonly body: string
}

export function memoryDraftParts(raw: string): MemoryDraftParts {
  const front = raw.match(FRONTMATTER)?.[0] ?? ""
  let rest = raw.slice(front.length)
  const headingMatch = rest.match(HEADING)
  const heading = headingMatch?.[0] ?? ""
  const title = headingMatch?.[1] ?? ""
  rest = rest.slice(heading.length)
  const lead = rest.match(BLANK_LINES)?.[0] ?? ""
  const tagLine = rest.slice(lead.length).match(TAG_LINE)?.[0] ?? ""
  if (!tagLine) return { front, heading, title, lead: "", tagLine: "", trail: "", body: rest }
  rest = rest.slice(lead.length + tagLine.length)
  const trail = rest.match(BLANK_LINES)?.[0] ?? ""
  return { front, heading, title, lead, tagLine, trail, body: rest.slice(trail.length) }
}

function joinParts(parts: MemoryDraftParts): string {
  return parts.front + parts.heading + parts.lead + parts.tagLine + parts.trail + parts.body
}

function lineEnd(parts: MemoryDraftParts): string {
  return /\r\n/.test(parts.heading || parts.tagLine || parts.body) ? "\r\n" : "\n"
}

/** The tags written on the tag line, without their `#`. */
export function memoryDraftTags(raw: string): readonly string[] {
  return [...memoryDraftParts(raw).tagLine.matchAll(TAG)].map((match) => match[0].slice(1))
}

export function withMemoryTitle(raw: string, title: string): string {
  const parts = memoryDraftParts(raw)
  const eol = lineEnd(parts)
  if (parts.heading) {
    const ending = parts.heading.match(/\r?\n$/)?.[0] ?? ""
    return joinParts({ ...parts, heading: `# ${title}${ending}` })
  }
  if (!title) return raw
  const gap = parts.tagLine || parts.body ? eol : ""
  return joinParts({ ...parts, heading: `# ${title}${eol}${gap}` })
}

export function withMemoryBody(raw: string, body: string): string {
  return joinParts({ ...memoryDraftParts(raw), body })
}

/** Rewrites the tag line from free text ("unifia, architecture" or "#a #b");
 * an empty list removes the line and the blank lines that followed it. */
export function withMemoryTags(raw: string, text: string): string {
  const parts = memoryDraftParts(raw)
  const eol = lineEnd(parts)
  const tags = [
    ...new Set(
      text
        .split(/[\s,]+/)
        .map((tag) => tag.replace(/^#+/, ""))
        .filter((tag) => /^[\p{L}\p{N}_-]+$/u.test(tag)),
    ),
  ]
  if (tags.length === 0) return joinParts({ ...parts, lead: parts.tagLine ? parts.lead : "", tagLine: "", trail: "" })
  const tagLine = tags.map((tag) => `#${tag}`).join(" ") + eol
  if (parts.tagLine) return joinParts({ ...parts, tagLine })
  // A new tag line goes one blank line under the heading; the blank lines
  // that opened the body now separate it from the tag line instead.
  const heading = parts.heading && !parts.heading.endsWith("\n") ? parts.heading + eol : parts.heading
  const opening = parts.body.match(BLANK_LINES)?.[0] ?? ""
  const body = parts.body.slice(opening.length)
  return joinParts({
    ...parts,
    heading,
    lead: heading ? eol : "",
    tagLine,
    trail: opening || (body ? eol : ""),
    body,
  })
}

/** Preview Markdown for a note body: the tag line is shown in the meta row,
 * not as text, and `[[target|label]]` becomes a link the pane resolves
 * (`#memory:` fragment). Fenced code keeps its wikilinks verbatim. */
export function memoryPreviewMarkdown(raw: string): string {
  const parts = memoryDraftParts(raw)
  const segments = parts.body.split(/(^```[\s\S]*?^```[ \t]*$)/m)
  return segments
    .map((segment, index) =>
      index % 2 === 1
        ? segment
        : segment.replace(
            /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g,
            (_match, target: string, label?: string) => {
              const name = target.trim()
              return `[${(label ?? name).trim()}](#memory:${encodeURIComponent(name)})`
            },
          ),
    )
    .join("")
}

/** The target of a `#memory:` preview link, or undefined for any other href. */
export function memoryLinkTarget(href: string | null | undefined): string | undefined {
  if (!href?.startsWith("#memory:")) return undefined
  // WHY: a hand-written "#memory:%" link is malformed URI text; it is not a
  // note link, so it opens nothing rather than throwing in the click handler.
  try {
    return decodeURIComponent(href.slice("#memory:".length)) || undefined
  } catch {
    return undefined
  }
}

/** "10 — Projects/Unifia / Vision produit.md": the vault-relative folder,
 * then the file name, as the reference's path line reads. */
export function memoryDisplayPath(path: string, root: string): string {
  const relative = path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
  const slash = relative.lastIndexOf("/")
  return slash < 0 ? relative : `${relative.slice(0, slash)} / ${relative.slice(slash + 1)}`
}
