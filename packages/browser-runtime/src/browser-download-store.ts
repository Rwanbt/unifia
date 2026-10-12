/* SPDX-License-Identifier: MIT */
import { createHash } from "node:crypto"
import { constants } from "node:fs"
import { copyFile, mkdir, readFile, stat, unlink } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, extname, join, resolve } from "node:path"
import { BrowserDownloadSchema, type BrowserDownload, type BrowserDownloadInspection, type BrowserSession } from "@unifia/contracts/browser"
import { browserQuarantineTarget } from "./quarantine-path.ts"

const MAX_QUARANTINED_DOWNLOAD_BYTES = 50 * 1024 * 1024
const MIME_EXTENSIONS: Record<string, readonly string[]> = {
  "application/pdf": [".pdf"], "application/zip": [".zip", ".jar", ".docx", ".xlsx", ".pptx"],
  "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"], "image/gif": [".gif"], "image/webp": [".webp"],
  "text/plain": [".txt", ".log", ".csv"], "application/json": [".json"],
}
const EXECUTABLE_EXTENSIONS = new Set([".app", ".bat", ".cmd", ".com", ".dll", ".dmg", ".exe", ".hta", ".htm", ".html", ".jar", ".js", ".lnk", ".msi", ".ps1", ".scr", ".sh", ".svg", ".vbs"])

export type BrowserDownloadSource = {
  suggestedFilename(): string
  saveAs(path: string): Promise<void>
}

type StoredDownload = { metadata: BrowserDownload; quarantinePath: string; workspaceId: string }
export type BrowserDownloadScanVerdict = "clean" | "malicious" | "unavailable"
export type BrowserDownloadScanner = { scan(path: string): Promise<BrowserDownloadScanVerdict> }
type BrowserDownloadStoreOptions = {
  quarantineRoot: string
  releasedRoot?: string
  createId: () => string
  scanner?: BrowserDownloadScanner
  now?: () => number
}

/** Owns quarantined Browser files separately from page and UI lifetimes. */
export class BrowserDownloadStore {
  readonly #quarantineRoot: string
  readonly #releasedRoot: string
  readonly #createId: () => string
  readonly #scanner: BrowserDownloadScanner | undefined
  readonly #now: () => number
  readonly #records = new Map<string, StoredDownload>()

  constructor(options: BrowserDownloadStoreOptions) {
    this.#quarantineRoot = resolve(options.quarantineRoot)
    this.#releasedRoot = resolve(options.releasedRoot ?? join(homedir(), "Downloads", "Unifia"))
    this.#createId = options.createId
    this.#scanner = options.scanner
    this.#now = options.now ?? Date.now
  }

  async quarantine(session: BrowserSession, tabId: string, source: BrowserDownloadSource): Promise<BrowserDownload> {
    const id = this.#createId()
    const originalFilename = safeOriginalFilename(source.suggestedFilename())
    const { directory, target } = browserQuarantineTarget(this.#quarantineRoot, session.workspaceId, `${id}.download`)
    await mkdir(directory, { recursive: true })
    try {
      await source.saveAs(target)
      const file = await stat(target)
      if (!file.isFile() || file.size > MAX_QUARANTINED_DOWNLOAD_BYTES) throw new Error("browser download exceeds quarantine limits")
      const inspection = await inspectDownload(target, originalFilename, this.#scanner)
      const metadata = BrowserDownloadSchema.parse({
        id, sessionId: session.id, tabId, filename: originalFilename, size: file.size,
        status: "quarantined", inspection, createdAt: this.#now(),
      })
      this.#records.set(id, { metadata, quarantinePath: target, workspaceId: session.workspaceId })
      return metadata
    } catch (error) {
      await unlink(target).catch((cleanupError: unknown) => {
        if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") throw cleanupError
      })
      throw error
    }
  }

  list(sessionId: string): readonly BrowserDownload[] {
    return [...this.#records.values()]
      .filter((record) => record.metadata.sessionId === sessionId)
      .map((record) => record.metadata)
  }

  async release(session: BrowserSession, downloadId: string): Promise<BrowserDownload> {
    const record = this.#records.get(downloadId)
    if (!record || record.metadata.sessionId !== session.id || record.workspaceId !== session.workspaceId) throw new Error("browser download is unavailable")
    if (record.metadata.status === "released") return record.metadata
    if (record.metadata.inspection.classification === "executable" || record.metadata.inspection.extensionStatus === "mismatch") {
      throw new Error("browser download failed file type validation")
    }
    if (record.metadata.inspection.malwareScan !== "clean") throw new Error("browser download malware scan is not clean")
    const currentInspection = await inspectDownload(record.quarantinePath, record.metadata.filename)
    if (currentInspection.sha256 !== record.metadata.inspection.sha256) throw new Error("browser quarantine integrity check failed")

    const releasedFilename = `${downloadId}-${safeReleaseFilename(record.metadata.filename)}`
    const { directory, target } = browserQuarantineTarget(this.#releasedRoot, session.workspaceId, releasedFilename)
    await mkdir(directory, { recursive: true })
    await copyFile(record.quarantinePath, target, constants.COPYFILE_EXCL)
    const metadata = BrowserDownloadSchema.parse({ ...record.metadata, status: "released", releasedFilename })
    record.metadata = metadata
    return metadata
  }
}

async function inspectDownload(path: string, filename: string, scanner?: BrowserDownloadScanner): Promise<BrowserDownloadInspection> {
  const bytes = await readFile(path)
  const mediaType = sniffMediaType(bytes)
  const extension = extname(filename).toLowerCase()
  const classification = classify(mediaType, extension)
  const acceptedExtensions = MIME_EXTENSIONS[mediaType]
  const extensionStatus = EXECUTABLE_EXTENSIONS.has(extension) || classification === "executable"
    ? "mismatch"
    : !acceptedExtensions ? "unknown" : acceptedExtensions.includes(extension) ? "match" : "mismatch"
  let malwareScan: BrowserDownloadScanVerdict = "unavailable"
  if (scanner) {
    try { malwareScan = await scanner.scan(path) }
    catch { malwareScan = "unavailable" }
  }
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"), mediaType, classification, extensionStatus, malwareScan,
  }
}

function sniffMediaType(bytes: Buffer): string {
  if (bytes.subarray(0, 5).toString() === "%PDF-") return "application/pdf"
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png"
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return "image/jpeg"
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString())) return "image/gif"
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return "image/webp"
  if (bytes.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]))) return "application/zip"
  return sniffText(bytes)
}

function sniffText(bytes: Buffer): string {
  if (bytes.subarray(0, 2).toString() === "MZ" || bytes.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])) || bytes.subarray(0, 2).toString() === "#!") return "application/x-executable"
  if (bytes.includes(0)) return "application/octet-stream"
  const text = bytes.toString("utf8").trimStart()
  if (text.startsWith("{") || text.startsWith("[")) return "application/json"
  if (/^<!doctype html|^<html\b/i.test(text)) return "text/html"
  return "text/plain"
}

function classify(mediaType: string, extension: string): BrowserDownloadInspection["classification"] {
  if (mediaType === "application/x-executable" || EXECUTABLE_EXTENSIONS.has(extension)) return "executable"
  if (mediaType === "text/html") return "executable"
  if (mediaType.startsWith("image/")) return "image"
  if (mediaType === "application/zip") return "archive"
  if (mediaType === "application/pdf") return "document"
  if (mediaType === "text/plain" || mediaType === "application/json") return "text"
  return "unknown"
}

function safeOriginalFilename(filename: string): string {
  const value = basename(filename).replace(/[\u0000-\u001f]/g, "").trim().slice(0, 255)
  return value || "download"
}

function safeReleaseFilename(filename: string): string {
  const value = basename(filename)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/^\.+/, "_")
    .replace(/[. ]+$/, "")
    .trim()
    .slice(0, 143)
  return value || "download"
}
