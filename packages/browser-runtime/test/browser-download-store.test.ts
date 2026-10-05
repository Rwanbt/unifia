/* SPDX-License-Identifier: MIT */

import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import type { BrowserSession } from "@unifia/contracts/browser"
import { BrowserDownloadStore } from "../src/browser-download-store.ts"
import { browserQuarantineTarget } from "../src/quarantine-path.ts"

describe("BrowserDownloadStore", () => {
  test("quarantines first and releases only the matching session's file", async () => {
    const root = await mkdtemp(join(tmpdir(), "unifia-browser-download-test-"))
    const session = { id: "session-a", workspaceId: "workspace-a" } as BrowserSession
    const pdf = "%PDF-1.7\nreport"
    const store = new BrowserDownloadStore({
      quarantineRoot: join(root, "quarantine"),
      releasedRoot: join(root, "released"),
      createId: () => "download-a",
      scanner: { async scan() { return "clean" } },
      now: () => 123,
    })
    try {
      const quarantined = await store.quarantine(session, "tab-a", {
        suggestedFilename: () => "../quarterly report.pdf",
        async saveAs(path) { await writeFile(path, pdf) },
      })
      expect(quarantined).toMatchObject({ filename: "quarterly report.pdf", size: pdf.length, status: "quarantined", createdAt: 123 })
      expect(quarantined.inspection).toMatchObject({ mediaType: "application/pdf", classification: "document", extensionStatus: "match" })
      expect(store.list(session.id)).toEqual([quarantined])
      await expect(store.release({ ...session, id: "session-b" }, quarantined.id)).rejects.toThrow("unavailable")

      const released = await store.release(session, quarantined.id)
      expect(released.status).toBe("released")
      expect(released.releasedFilename).toBe("download-a-quarterly report.pdf")
      expect(store.list(session.id)).toEqual([released])
      const workspaceDirectory = createHash("sha256").update(session.workspaceId).digest("hex")
      expect(await readFile(join(root, "released", workspaceDirectory, "downloads", released.releasedFilename!), "utf8")).toBe(pdf)
      expect(await store.release(session, quarantined.id)).toEqual(released)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("does not release executable or type-mismatched downloads", async () => {
    const root = await mkdtemp(join(tmpdir(), "unifia-browser-download-types-"))
    const session = { id: "session-a", workspaceId: "workspace-a" } as BrowserSession
    const store = new BrowserDownloadStore({ quarantineRoot: join(root, "quarantine"), releasedRoot: join(root, "released"), createId: () => "download-a", scanner: { async scan() { return "clean" } } })
    try {
      const executable = await store.quarantine(session, "tab-a", {
        suggestedFilename: () => "payload.exe",
        async saveAs(path) { await writeFile(path, "MZ executable payload") },
      })
      expect(executable.inspection.classification).toBe("executable")
      await expect(store.release(session, executable.id)).rejects.toThrow(/file type validation/)

      const mismatchStore = new BrowserDownloadStore({ quarantineRoot: join(root, "mismatch"), releasedRoot: join(root, "released"), createId: () => "download-b", scanner: { async scan() { return "clean" } } })
      const mismatch = await mismatchStore.quarantine(session, "tab-a", {
        suggestedFilename: () => "report.txt",
        async saveAs(path) { await writeFile(path, "%PDF-1.7\nnot plain text") },
      })
      expect(mismatch.inspection.extensionStatus).toBe("mismatch")
      await expect(mismatchStore.release(session, mismatch.id)).rejects.toThrow(/file type validation/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("verifies quarantined file integrity again before release", async () => {
    const root = await mkdtemp(join(tmpdir(), "unifia-browser-download-integrity-"))
    const session = { id: "session-a", workspaceId: "workspace-a" } as BrowserSession
    const store = new BrowserDownloadStore({ quarantineRoot: join(root, "quarantine"), releasedRoot: join(root, "released"), createId: () => "download-a", scanner: { async scan() { return "clean" } } })
    try {
      const download = await store.quarantine(session, "tab-a", {
        suggestedFilename: () => "report.pdf",
        async saveAs(path) { await writeFile(path, "%PDF-1.7\nreport") },
      })
      const quarantine = browserQuarantineTarget(join(root, "quarantine"), session.workspaceId, "download-a.download")
      await writeFile(quarantine.target, "%PDF-1.7\ntampered")
      await expect(store.release(session, download.id)).rejects.toThrow(/integrity check failed/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("fails closed when malware scanning is unavailable or detects a threat", async () => {
    const root = await mkdtemp(join(tmpdir(), "unifia-browser-download-scan-"))
    const session = { id: "session-a", workspaceId: "workspace-a" } as BrowserSession
    const source = {
      suggestedFilename: () => "notes.txt",
      async saveAs(path: string) { await writeFile(path, "ordinary notes") },
    }
    const unavailableStore = new BrowserDownloadStore({ quarantineRoot: join(root, "unavailable"), releasedRoot: join(root, "released"), createId: () => "unavailable" })
    const maliciousStore = new BrowserDownloadStore({ quarantineRoot: join(root, "malicious"), releasedRoot: join(root, "released"), createId: () => "malicious", scanner: { async scan() { return "malicious" } } })
    try {
      const unavailable = await unavailableStore.quarantine(session, "tab-a", source)
      expect(unavailable.inspection.malwareScan).toBe("unavailable")
      await expect(unavailableStore.release(session, unavailable.id)).rejects.toThrow(/malware scan is not clean/)

      const malicious = await maliciousStore.quarantine(session, "tab-a", source)
      expect(malicious.inspection.malwareScan).toBe("malicious")
      await expect(maliciousStore.release(session, malicious.id)).rejects.toThrow(/malware scan is not clean/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
