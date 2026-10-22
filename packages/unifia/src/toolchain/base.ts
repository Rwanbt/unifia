/* SPDX-License-Identifier: MIT */
// The rootfs bundled in the APK was populated by apk at build time, so its
// files are owned by packages this manager never installed. Their apk
// database is adopted once as a pinned base (ADR-097): base packages satisfy
// dependencies as they are, are never removed by a change, and do not count
// against the quota, since the user never asked for them.
import fs from "node:fs"
import path from "node:path"
import type { ExtractedFile } from "./archive"
import { parseIndex } from "./repository"
import type { Database, PackageRecord } from "./transaction"

export const INSTALLED_DATABASE = "lib/apk/db/installed"

// Same block format as APKINDEX, plus F: (directory) and R: (file in the last F:) lines.
export function parseInstalledDatabase(text: string): PackageRecord[] {
  const blocks = text.split(/\n\s*\n/).filter((block) => block.trim() !== "")
  return blocks.map((block) => {
    const [entry] = parseIndex(block)
    const files: ExtractedFile[] = []
    let directory = ""
    for (const line of block.split("\n")) {
      if (line.startsWith("F:")) {
        directory = line.slice(2)
        files.push({ path: directory, type: "directory" })
      } else if (line.startsWith("R:")) {
        files.push({ path: path.posix.join(directory, line.slice(2)), type: "file" })
      }
    }
    return { entry: entry!, apkSha256: "", files, explicit: false, base: true }
  })
}

export function adoptBase(root: string): Database | undefined {
  const file = path.join(root, INSTALLED_DATABASE)
  if (!fs.existsSync(file)) return undefined
  const packages: Record<string, PackageRecord> = {}
  for (const record of parseInstalledDatabase(fs.readFileSync(file, "utf8"))) packages[record.entry.name] = record
  return { version: 1, packages }
}
