/* SPDX-License-Identifier: MIT */

/**
 * Artifact Studio — Plan V3 section 26.
 *
 * Three surfaces the phase requires and that nothing implemented: stripping
 * format-level metadata, producing a preview that cannot execute anything, and
 * diffing two revisions semantically rather than by bytes.
 *
 * Everything here is pure and offline. No worker is spawned, no document is
 * rendered by a format engine, and no content is ever evaluated — the preview
 * extracts inert text and the diff compares extracted units. A document that
 * carries an execution surface is refused rather than previewed, because the
 * safe thing to do with a macro is not to render it carefully.
 */

import { createStoredZipFromBytes, readStoredZip, type ZipBinaryEntry } from "@unifia/document-packs/zip"
import { isJpeg, isPng, isSupportedImage, stripImageMetadata, type ImageStripResult } from "./images.js"
import { attribute, filterElements, textOf } from "./xml.js"

export type StudioFormat = "docx" | "pptx" | "xlsx" | "pdf" | "text" | "binary"

const OOXML: ReadonlySet<StudioFormat> = new Set<StudioFormat>(["docx", "pptx", "xlsx"])

/** Package prefixes that carry authoring metadata rather than content. */
const METADATA_PREFIXES = ["docProps/", "customXml/"]

/** Parts that can execute. Their presence disqualifies a document from preview. */
const EXECUTABLE_SUFFIXES = ["vbaProject.bin", ".bin"]

/** PDF tokens that make a document active rather than inert. */
const ACTIVE_PDF_TOKENS = ["/JavaScript", "/JS", "/Launch", "/OpenAction", "/EmbeddedFile", "/AA"]

const MAX_PREVIEW_CHARS = 8192

export class UnsafeDocumentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UnsafeDocumentError"
  }
}

export class UnsupportedFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UnsupportedFormatError"
  }
}

// --- Metadata stripping ------------------------------------------------------

export type StripResult = {
  content: Uint8Array
  removedParts: readonly string[]
  /** Embedded images whose metadata was removed, with what came out of each. */
  sanitisedImages?: readonly { part: string; removed: readonly string[] }[]
  /**
   * Embedded images left byte-for-byte intact because their format is not
   * parsed here. Non-empty means the strip was **partial** — the caller must
   * not report the document as sanitised.
   */
  unsanitisedImages?: readonly string[]
}

/** Where OOXML packages keep embedded pictures. */
const MEDIA_PREFIXES = ["word/media/", "ppt/media/", "xl/media/", "word/embeddings/", "ppt/embeddings/"]
const isMediaPart = (name: string): boolean => MEDIA_PREFIXES.some((prefix) => name.startsWith(prefix))

const isMetadataPart = (name: string): boolean => METADATA_PREFIXES.some((prefix) => name.startsWith(prefix))

/**
 * Removes format-level metadata.
 *
 * For OOXML this deletes the metadata parts *and* the references to them, so
 * the result is a consistent package: a stripped archive that still declares an
 * Override or a Relationship for a part that is gone is corrupt, and a corrupt
 * export is worse than an unstripped one.
 *
 * Embedded pictures are stripped too. Removing the author from `docProps` while
 * shipping a phone JPEG with its GPS coordinates is worse than not stripping at
 * all, because the caller then believes the document is clean. Images whose
 * format is not parsed here are reported in `unsanitisedImages` instead of
 * being counted as clean.
 *
 * For PDF it refuses rather than pretends. Our own generator emits no /Info
 * dictionary, so a PDF that has one did not come from here, and editing an
 * arbitrary PDF needs a real parser. Failing closed keeps the caller from
 * believing a document was sanitised when it was not.
 */
export function stripFormatMetadata(format: StudioFormat, bytes: Uint8Array): StripResult {
  if (format === "text" || format === "binary") return { content: bytes, removedParts: [] }
  if (format === "pdf") return stripPdfMetadata(bytes)
  if (!OOXML.has(format)) throw new UnsupportedFormatError(`unsupported format: ${format}`)
  const entries = readStoredZip(bytes)
  const removedParts = entries.map((entry) => entry.name).filter(isMetadataPart)
  const sanitisedImages: { part: string; removed: readonly string[] }[] = []
  const unsanitisedImages: string[] = []
  const kept = entries
    .filter((entry) => !isMetadataPart(entry.name))
    .map(rewriteReferences)
    .map((entry) => {
      if (!isMediaPart(entry.name)) return entry
      const stripped = stripImageMetadata(entry.content)
      if (!stripped) {
        unsanitisedImages.push(entry.name)
        return entry
      }
      if (stripped.removed.length > 0) sanitisedImages.push({ part: entry.name, removed: stripped.removed })
      return { name: entry.name, content: stripped.content }
    })
  if (removedParts.length === 0 && sanitisedImages.length === 0) {
    return { content: bytes, removedParts: [], sanitisedImages: [], unsanitisedImages }
  }
  return { content: createStoredZipFromBytes(kept), removedParts, sanitisedImages, unsanitisedImages }
}

function rewriteReferences(entry: ZipBinaryEntry): ZipBinaryEntry {
  if (!entry.name.endsWith("[Content_Types].xml") && !entry.name.endsWith(".rels")) return entry
  const decoder = new TextDecoder()
  let xml = decoder.decode(entry.content)
  xml = filterElements(xml, "Override", (attributes) => {
    const part = attribute(attributes, "PartName") ?? ""
    return !isMetadataPart(part.replace(/^\//, ""))
  })
  xml = filterElements(xml, "Relationship", (attributes) => {
    const target = attribute(attributes, "Target") ?? ""
    return !isMetadataPart(target.replace(/^\//, ""))
  })
  return { name: entry.name, content: new TextEncoder().encode(xml) }
}

function stripPdfMetadata(bytes: Uint8Array): StripResult {
  const text = new TextDecoder().decode(bytes)
  if (!text.startsWith("%PDF-")) throw new UnsupportedFormatError("not a PDF document")
  if (text.includes("/Info")) {
    throw new UnsafeDocumentError("this PDF carries an /Info dictionary; stripping it needs a real PDF parser and is not implemented")
  }
  return { content: bytes, removedParts: [] }
}

// --- Preview -----------------------------------------------------------------

export type PreviewResult = { text: string; parts: readonly string[]; truncated: boolean }

/**
 * Produces an inert textual preview.
 *
 * @throws UnsafeDocumentError when the document carries an execution surface or
 * an external reference. Refusing is the point: a preview that renders a macro
 * document "carefully" is still a preview that opened it.
 */
export function previewArtifact(format: StudioFormat, bytes: Uint8Array): PreviewResult {
  if (format === "text") return truncate(new TextDecoder().decode(bytes), [])
  if (format === "binary") throw new UnsupportedFormatError("binary artefacts have no textual preview")
  if (format === "pdf") return previewPdf(bytes)
  if (!OOXML.has(format)) throw new UnsupportedFormatError(`unsupported format: ${format}`)
  const entries = readStoredZip(bytes)
  assertInertPackage(entries)
  const tag = format === "docx" ? "w:t" : format === "pptx" ? "a:t" : "t"
  const decoder = new TextDecoder()
  const collected: string[] = []
  for (const entry of entries) if (isContentPart(format, entry.name)) collected.push(...textOf(decoder.decode(entry.content), tag))
  return truncate(collected.join("\n"), entries.map((entry) => entry.name))
}

function assertInertPackage(entries: readonly ZipBinaryEntry[]): void {
  for (const entry of entries) {
    if (EXECUTABLE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) throw new UnsafeDocumentError(`document carries an executable part: ${entry.name}`)
    if (!entry.name.endsWith(".rels")) continue
    if (new TextDecoder().decode(entry.content).includes('TargetMode="External"')) throw new UnsafeDocumentError(`document declares an external relationship in ${entry.name}`)
  }
}

function isContentPart(format: StudioFormat, name: string): boolean {
  if (format === "docx") return name === "word/document.xml"
  if (format === "pptx") return name.startsWith("ppt/slides/") && name.endsWith(".xml")
  return name.startsWith("xl/worksheets/") && name.endsWith(".xml")
}

function previewPdf(bytes: Uint8Array): PreviewResult {
  const text = new TextDecoder().decode(bytes)
  if (!text.startsWith("%PDF-")) throw new UnsupportedFormatError("not a PDF document")
  for (const token of ACTIVE_PDF_TOKENS) if (text.includes(token)) throw new UnsafeDocumentError(`PDF carries an active element: ${token}`)
  return truncate(pdfTextRuns(text).join("\n"), ["%PDF"])
}

function pdfTextRuns(text: string): string[] {
  const runs: string[] = []
  for (const match of text.matchAll(/\((?:[^()\\]|\\.)*\)\s*Tj/g)) {
    const literal = match[0].slice(1, match[0].lastIndexOf(")"))
    runs.push(literal.replaceAll("\\(", "(").replaceAll("\\)", ")").replaceAll("\\\\", "\\"))
  }
  return runs
}

function truncate(text: string, parts: readonly string[]): PreviewResult {
  const truncated = text.length > MAX_PREVIEW_CHARS
  return { text: truncated ? text.slice(0, MAX_PREVIEW_CHARS) : text, parts, truncated }
}

// --- Semantic diff -----------------------------------------------------------

export type DiffOperation = { op: "added" | "removed" | "unchanged"; value: string }
export type SemanticDiff = { units: readonly DiffOperation[]; added: number; removed: number; unchanged: number; identical: boolean }

/**
 * Compares two revisions by their extracted content units rather than bytes.
 *
 * Two OOXML packages that say the same thing differ in bytes for reasons the
 * reader does not care about, so a byte diff answers the wrong question. Both
 * sides go through `previewArtifact`, which means a document carrying an
 * execution surface is refused here too.
 */
export function diffArtifacts(format: StudioFormat, left: Uint8Array, right: Uint8Array): SemanticDiff {
  const before = previewArtifact(format, left).text.split("\n").filter((line) => line.length > 0)
  const after = previewArtifact(format, right).text.split("\n").filter((line) => line.length > 0)
  const units = diffUnits(before, after)
  const count = (op: DiffOperation["op"]) => units.filter((unit) => unit.op === op).length
  const added = count("added")
  const removed = count("removed")
  return { units, added, removed, unchanged: count("unchanged"), identical: added === 0 && removed === 0 }
}

/** Longest-common-subsequence diff. Quadratic, which is fine for document units. */
function diffUnits(before: readonly string[], after: readonly string[]): DiffOperation[] {
  const lengths: number[][] = Array.from({ length: before.length + 1 }, () => new Array<number>(after.length + 1).fill(0))
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      lengths[i][j] = before[i] === after[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1])
    }
  }
  const units: DiffOperation[] = []
  let i = 0
  let j = 0
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) { units.push({ op: "unchanged", value: before[i] }); i += 1; j += 1 }
    else if (lengths[i + 1][j] >= lengths[i][j + 1]) { units.push({ op: "removed", value: before[i] }); i += 1 }
    else { units.push({ op: "added", value: after[j] }); j += 1 }
  }
  while (i < before.length) { units.push({ op: "removed", value: before[i] }); i += 1 }
  while (j < after.length) { units.push({ op: "added", value: after[j] }); j += 1 }
  return units
}

export { isJpeg, isPng, isSupportedImage, stripImageMetadata, type ImageStripResult }
