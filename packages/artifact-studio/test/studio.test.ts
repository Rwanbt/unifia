/* SPDX-License-Identifier: MIT */
import { createStoredZip, docxWorker, inspectStoredZip, pdfWorker, pptxWorker, readStoredZip, xlsxWorker } from "@unifia/document-packs"
import { UnsafeDocumentError, UnsupportedFormatError, diffArtifacts, previewArtifact, stripFormatMetadata } from "../src/index.js"

let checks = 0
const check = (condition: boolean, message: string): void => {
  checks += 1
  if (!condition) throw new Error(message)
}
const refuses = (run: () => unknown, expected: typeof UnsafeDocumentError | typeof UnsupportedFormatError, message: string): void => {
  checks += 1
  try {
    run()
  } catch (error) {
    if (error instanceof expected) return
    throw new Error(`${message} (threw ${String(error)})`)
  }
  throw new Error(`${message} (did not refuse)`)
}

const bytes = (input: string | Uint8Array): Uint8Array => (typeof input === "string" ? new TextEncoder().encode(input) : input)
const asBytes = async (produce: Promise<{ content: string | Uint8Array }>): Promise<Uint8Array> => bytes((await produce).content)

// --- Preview extracts inert text ---------------------------------------------
const docx = await asBytes(docxWorker("Quarterly report"))
const preview = previewArtifact("docx", docx)
check(preview.text === "Quarterly report", `docx preview produced ${JSON.stringify(preview.text)}`)
check(preview.parts.includes("word/document.xml"), "docx preview did not report the parts it read")

check(previewArtifact("pptx", await asBytes(pptxWorker("Slide body"))).text === "Slide body", "pptx preview did not extract slide text")
check(previewArtifact("xlsx", await asBytes(xlsxWorker("Cell value"))).text === "Cell value", "xlsx preview did not extract cell text")
check(previewArtifact("pdf", await asBytes(pdfWorker("Printed line"))).text === "Printed line", "pdf preview did not extract text runs")
check(previewArtifact("text", bytes("plain")).text === "plain", "text preview did not pass content through")

// Entities must come back decoded, not as markup.
check(previewArtifact("docx", await asBytes(docxWorker("a < b & c"))).text === "a < b & c", "docx preview did not decode XML entities")
refuses(() => previewArtifact("binary", bytes("x")), UnsupportedFormatError, "binary was given a textual preview")

// --- Preview refuses anything that can execute -------------------------------
const macroDoc = createStoredZip([
  { name: "[Content_Types].xml", content: "<Types/>" },
  { name: "word/document.xml", content: "<w:document><w:body><w:p><w:r><w:t>harmless</w:t></w:r></w:p></w:body></w:document>" },
  { name: "word/vbaProject.bin", content: "MZ-fake-macro" },
])
refuses(() => previewArtifact("docx", macroDoc), UnsafeDocumentError, "a macro-bearing document was previewed")

const externalDoc = createStoredZip([
  { name: "[Content_Types].xml", content: "<Types/>" },
  { name: "word/_rels/document.xml.rels", content: '<Relationships><Relationship Id="rId9" Target="http://evil.example/x" TargetMode="External"/></Relationships>' },
  { name: "word/document.xml", content: "<w:document><w:body><w:t>text</w:t></w:body></w:document>" },
])
refuses(() => previewArtifact("docx", externalDoc), UnsafeDocumentError, "a document with an external relationship was previewed")

const activePdf = new TextEncoder().encode("%PDF-1.4\n<< /OpenAction << /S /JavaScript >> >>\n(hi) Tj\n%%EOF")
refuses(() => previewArtifact("pdf", activePdf), UnsafeDocumentError, "a PDF with an OpenAction was previewed")
refuses(() => previewArtifact("pdf", bytes("not a pdf")), UnsupportedFormatError, "a non-PDF was previewed as a PDF")

// --- Metadata stripping -------------------------------------------------------
const withMetadata = createStoredZip([
  { name: "[Content_Types].xml", content: '<Types><Override PartName="/word/document.xml" ContentType="main"/><Override PartName="/docProps/core.xml" ContentType="core"/></Types>' },
  { name: "_rels/.rels", content: '<Relationships><Relationship Id="rId1" Target="word/document.xml"/><Relationship Id="rId2" Target="docProps/core.xml"/></Relationships>' },
  { name: "docProps/core.xml", content: "<cp:coreProperties><dc:creator>Erwan</dc:creator></cp:coreProperties>" },
  { name: "docProps/app.xml", content: "<Properties><Company>Secret Corp</Company></Properties>" },
  { name: "customXml/item1.xml", content: "<item>tracking</item>" },
  { name: "word/document.xml", content: "<w:document><w:body><w:p><w:r><w:t>content</w:t></w:r></w:p></w:body></w:document>" },
])
const stripped = stripFormatMetadata("docx", withMetadata)
check(stripped.removedParts.length === 3, `stripping removed ${stripped.removedParts.join(", ")}`)
const remaining = inspectStoredZip(stripped.content).entries
check(!remaining.some((name) => name.startsWith("docProps/")), "a docProps part survived stripping")
check(!remaining.some((name) => name.startsWith("customXml/")), "a customXml part survived stripping")
check(remaining.includes("word/document.xml"), "stripping removed the content part")

// The package must stay consistent: no reference may point at a removed part.
const decoder = new TextDecoder()
const strippedEntries = new Map(remaining.map((name, index) => [name, index]))
check(strippedEntries.has("[Content_Types].xml") && strippedEntries.has("_rels/.rels"), "stripping removed the package descriptors")
const rebuilt = previewArtifact("docx", stripped.content)
check(rebuilt.text === "content", "the stripped package is no longer previewable")
const types = decoder.decode(readEntry(stripped.content, "[Content_Types].xml"))
check(!types.includes("docProps"), "a Content_Types override still references a removed part")
check(types.includes("/word/document.xml"), "stripping dropped the override of a kept part")
const rels = decoder.decode(readEntry(stripped.content, "_rels/.rels"))
check(!rels.includes("docProps"), "a relationship still references a removed part")
check(rels.includes("word/document.xml"), "stripping dropped the relationship of a kept part")

// Nothing to strip must not rewrite the archive.
const clean = stripFormatMetadata("docx", docx)
check(clean.removedParts.length === 0 && clean.content === docx, "stripping rewrote an archive that had no metadata")
check(stripFormatMetadata("text", bytes("plain")).removedParts.length === 0, "text stripping reported removals")

// PDF fails closed rather than pretending.
check(stripFormatMetadata("pdf", await asBytes(pdfWorker("clean"))).removedParts.length === 0, "a generated PDF was reported as carrying metadata")
refuses(() => stripFormatMetadata("pdf", new TextEncoder().encode("%PDF-1.4\ntrailer\n<< /Info 9 0 R >>\n%%EOF")), UnsafeDocumentError, "a PDF with an /Info dictionary was reported as stripped")

// --- Semantic diff -------------------------------------------------------------
const before = await asBytes(docxWorker("line one"))
const after = await asBytes(docxWorker("line two"))
const changed = diffArtifacts("docx", before, after)
check(!changed.identical, "a changed document was reported identical")
check(changed.added === 1 && changed.removed === 1, `diff reported +${changed.added}/-${changed.removed}`)
check(changed.units.some((unit) => unit.op === "added" && unit.value === "line two"), "the diff did not report the new text")

const same = diffArtifacts("docx", before, await asBytes(docxWorker("line one")))
check(same.identical && same.added === 0 && same.removed === 0, "two equal documents were reported as different")

const multi = diffArtifacts("text", bytes("a\nb\nc"), bytes("a\nc\nd"))
check(multi.unchanged === 2 && multi.removed === 1 && multi.added === 1, `text diff reported =${multi.unchanged} -${multi.removed} +${multi.added}`)
check(multi.units.filter((unit) => unit.op === "unchanged").map((unit) => unit.value).join(",") === "a,c", "the diff kept the wrong common units")
refuses(() => diffArtifacts("docx", macroDoc, docx), UnsafeDocumentError, "a macro document was diffed instead of refused")

console.log(`ArtifactStudio: ${checks}/${checks} passed`)

function readEntry(archive: Uint8Array, name: string): Uint8Array {
  const entry = readStoredZip(archive).find((candidate) => candidate.name === name)
  if (!entry) throw new Error(`entry ${name} is missing from the archive`)
  return entry.content
}
