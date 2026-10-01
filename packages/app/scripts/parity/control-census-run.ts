// SPDX-License-Identifier: MIT
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { scanControlCandidates } from "./control-census"
import { REPO_ROOT } from "./shared"

const git = (...args: string[]) => execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim()
const tracked = git("ls-files", "-z", "packages/app/src").split("\0").filter(Boolean).sort()
const sources = tracked.filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
const exclusions = sources.filter((file) => /\.(test|spec|stories)\./.test(file) || file.endsWith(".d.ts"))
const excluded = new Set(exclusions)
const manifest = sources.filter((file) => !excluded.has(file)).map((file) => {
  const source = readFileSync(join(REPO_ROOT, file), "utf8")
  return {
    file,
    sha256: createHash("sha256").update(source).digest("hex"),
    bytes: Buffer.byteLength(source),
    candidates: scanControlCandidates(file, source),
  }
})
const dirty = git("status", "--porcelain", "--", "packages/app/src")
process.stdout.write(JSON.stringify({
  schema: 1,
  sourceSha: git("rev-parse", "HEAD"),
  sourceDirty: dirty !== "",
  scope: "packages/app/src tracked TypeScript; structural candidates, not a behavioral or runtime audit",
  exclusions,
  files: manifest.length,
  candidateCount: manifest.reduce((count, file) => count + file.candidates.length, 0),
  bytes: manifest.reduce((count, file) => count + file.bytes, 0),
  manifest,
}, null, 2) + "\n")
