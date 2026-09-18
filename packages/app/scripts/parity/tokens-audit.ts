// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// S2 tokens pre-freeze audit. Reads every CSS layer that lands on the v110
// shell contract, enumerates the CSS custom properties, and reports per-
// property usage counts. The host-only counterpart of the F0 PostCSS +
// TypeScript Compiler API audit the harness ships in the image.
//
// Two identical runs on identical fixtures must produce identical canonical
// hashes. Used by parity:s0:audit before the QF0 lock lands.

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { REPO_ROOT } from "./shared"

const stylesDir = join(REPO_ROOT, "packages", "app", "src")
const emitArg = process.argv.find((a) => a.startsWith("--emit="))
const emit = emitArg ? emitArg.split("=")[1] : "artifact"

const cssFiles: string[] = []
function walk(dir: string): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    try {
      const stat = require("node:fs").statSync(full)
      if (stat.isDirectory()) walk(full)
      else if (entry.endsWith(".css")) cssFiles.push(full)
    } catch {
      // ignore
    }
  }
}
walk(stylesDir)

const propertyPattern = /--([a-z][a-z0-9-]*)\s*:/gi
const usagePattern = /var\(--([a-z][a-z0-9-]*)\)/gi
const selectorPattern = /\[data-(?:v110|parity|component|action)[= ]\s*["']?([a-zA-Z0-9_.\-:/]+)["']?\]?/g

const declarations: { property: string; file: string; value: string }[] = []
const usages: { property: string; file: string; count: number }[] = []
const selectors: { selector: string; file: string }[] = []

for (const file of cssFiles) {
  const content = readFileSync(file, "utf8")
  const rel = file.replace(stylesDir, "packages/app/src").replaceAll("\\", "/")
  let match: RegExpExecArray | null
  const declRe = new RegExp(propertyPattern.source, "g")
  while ((match = declRe.exec(content)) !== null) {
    const idx = match.index
    const lineEnd = content.indexOf("\n", idx)
    const value = content.slice(idx + match[0].length, lineEnd === -1 ? content.length : lineEnd).trim().replace(/;$/, "")
    declarations.push({ property: match[1]!.toLowerCase(), file: rel, value: value.slice(0, 60) })
  }
  const usageRe = new RegExp(usagePattern.source, "g")
  const fileUsages = new Map<string, number>()
  while ((match = usageRe.exec(content)) !== null) {
    const key = match[1]!.toLowerCase()
    fileUsages.set(key, (fileUsages.get(key) ?? 0) + 1)
  }
  for (const [property, count] of fileUsages) {
    usages.push({ property, file: rel, count })
  }
  const selRe = new RegExp(selectorPattern.source, "g")
  while ((match = selRe.exec(content)) !== null) {
    selectors.push({ selector: match[1]!, file: rel })
  }
}

const declaredSet = new Set(declarations.map((d) => d.property))
const usedSet = new Set(usages.map((u) => u.property))
const undeclaredUsed: string[] = []
for (const used of usedSet) {
  if (!declaredSet.has(used)) undeclaredUsed.push(used)
}

const v110Properties = declarations.filter((d) => d.property.startsWith("v110-"))

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`
}

const counts = {
  files: cssFiles.length,
  declarations: declarations.length,
  usages: usages.length,
  uniqueDeclared: declaredSet.size,
  uniqueUsed: usedSet.size,
  v110Properties: v110Properties.length,
  uniqueV110Declared: new Set(v110Properties.map((v) => v.property)).size,
  undeclaredUsed: undeclaredUsed.length,
  selectors: selectors.length,
}

const canonical = stableStringify({ declarations, usages, selectors, counts })
const canonicalHash = createHash("sha256").update(canonical).digest("hex")

const report = {
  schemaVersion: 1,
  capturedAt: "PIPELINE",
  root: "packages/app/src",
  counts,
  declarations: declarations.sort((a, b) => (a.file + a.property).localeCompare(b.file + b.property)),
  usages: usages.sort((a, b) => (a.file + a.property).localeCompare(b.file + b.property)),
  selectors: selectors.sort((a, b) => a.file.localeCompare(b.file)),
  undeclaredUsed: undeclaredUsed.sort(),
  v110Tokens: Array.from(new Set(v110Properties.map((v) => v.property))).sort(),
  canonicalHash,
}

const json = JSON.stringify(report, null, 2)
if (emit === "artifact") {
  const outPath = join(REPO_ROOT, "parity", "artifacts", "tokens-audit.json")
  writeFileSync(outPath, json + "\n")
  process.stderr.write(`wrote ${outPath} (${json.length} bytes, hash ${canonicalHash.slice(0, 12)})\n`)
} else {
  process.stdout.write(json + "\n")
}