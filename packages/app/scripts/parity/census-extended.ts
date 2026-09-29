// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// Extended census: enumerates data-* markers, role, aria-*, event handlers,
// and CSS class hooks (.btn / .card / .chip / .input / .badge / .switch /
// .tooltip etc.). Two identical runs on identical fixtures produce
// identical canonical hashes (timestamps excluded).
//
// Output: parity/artifacts/census-extended.json. Feeds S0 census union
// with the F0 image-side runtime census.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { REPO_ROOT } from "./shared"

const root = join(REPO_ROOT, "packages", "app", "src")
const emitArg = process.argv.find((a) => a.startsWith("--emit="))
const emit = emitArg ? emitArg.split("=")[1] : "artifact"

if (!existsSync(root)) {
  process.stderr.write(`missing directory: ${root}\n`)
  process.exit(1)
}

function listFiles(dir: string): string[] {
  const out: string[] = []
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    let entries: string[]
    try {
      entries = readdirSync(current)
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = join(current, entry)
      let stat
      try {
        stat = statSync(full)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        stack.push(full)
      } else if (/\.(tsx?|jsx?)$/.test(entry)) {
        out.push(full)
      }
    }
  }
  return out.sort()
}

const dataAttributePattern = /\bdata-([a-z][a-z0-9-]*)\s*=\s*(["'])([^"']*?)\2/g
const ariaAttributePattern = /\baria-([a-z][a-z0-9-]*)\s*=\s*(["'])([^"']*?)\2/g
const rolePattern = /\brole\s*=\s*(["'])([^"']+?)\1/g
const handlerPattern = /\b(on(?:Click|Input|Change|Focus|Blur|Submit|KeyDown|KeyUp|KeyPress|MouseDown|MouseUp|PointerDown|PointerUp|PointerMove|Drop|DragOver|DragStart|DragEnd|CompositionStart|CompositionEnd|Scroll|Resize|Load|Error|AnimationStart|AnimationEnd|AnimationIteration|ContextMenu|Click))\b/g
const classHookPattern = /\bclass(?:Name)?\s*=\s*(["'`])([^"'`]*?)\1/g

interface MarkerHit {
  kind: "data" | "aria" | "role" | "handler" | "class"
  key: string
  value: string
  file: string
  line: number
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

const files = listFiles(root)
const hits: MarkerHit[] = []

for (const file of files) {
  const content = readFileSync(file, "utf8")
  const rel = file.replace(root, "packages/app/src").replaceAll("\\", "/")

  let match: RegExpExecArray | null
  const dataRe = new RegExp(dataAttributePattern.source, "g")
  while ((match = dataRe.exec(content)) !== null) {
    const lineNumber = content.slice(0, match.index).split("\n").length
    hits.push({ kind: "data", key: match[1]!, value: match[3] ?? "", file: rel, line: lineNumber })
  }

  const ariaRe = new RegExp(ariaAttributePattern.source, "g")
  while ((match = ariaRe.exec(content)) !== null) {
    const lineNumber = content.slice(0, match.index).split("\n").length
    hits.push({ kind: "aria", key: match[1]!, value: match[3] ?? "", file: rel, line: lineNumber })
  }

  const roleRe = new RegExp(rolePattern.source, "g")
  while ((match = roleRe.exec(content)) !== null) {
    const lineNumber = content.slice(0, match.index).split("\n").length
    hits.push({ kind: "role", key: match[2]!, value: "", file: rel, line: lineNumber })
  }

  const handlerRe = new RegExp(handlerPattern.source, "g")
  while ((match = handlerRe.exec(content)) !== null) {
    const lineNumber = content.slice(0, match.index).split("\n").length
    hits.push({ kind: "handler", key: match[1]!, value: "", file: rel, line: lineNumber })
  }

  const classRe = new RegExp(classHookPattern.source, "g")
  while ((match = classRe.exec(content)) !== null) {
    const lineNumber = content.slice(0, match.index).split("\n").length
    const raw = match[2] ?? ""
    for (const token of raw.split(/\s+/)) {
      if (!token) continue
      hits.push({ kind: "class", key: token, value: "", file: rel, line: lineNumber })
    }
  }
}

hits.sort((a, b) => (a.kind + a.key + a.file).localeCompare(b.kind + b.key + b.file))

const counts = {
  files: files.length,
  hits: hits.length,
  byKind: hits.reduce<Record<string, number>>((acc, h) => {
    acc[h.kind] = (acc[h.kind] ?? 0) + 1
    return acc
  }, {}),
  uniqueKeys: hits.reduce<Record<string, Set<string>>>((acc, h) => {
    const set = acc[h.kind] ?? new Set<string>()
    set.add(h.key)
    acc[h.kind] = set
    return acc
  }, {}),
}

const canonical = stableStringify(hits)
const canonicalHash = hash(canonical)

const uniqueByKind: Record<string, string[]> = {}
for (const [kind, set] of Object.entries(counts.uniqueKeys)) {
  uniqueByKind[kind] = [...set].sort()
}

const report = {
  schemaVersion: 1,
  capturedAt: "PIPELINE",
  root: "packages/app/src",
  counts: {
    files: counts.files,
    hits: counts.hits,
    byKind: counts.byKind,
    uniqueByKind,
  },
  hits,
  canonicalHash,
  notes: [
    "Extended census runs alongside parity:census (the basic census).",
    "data-* and aria-* enumerate every JSX attribute the harness can match at runtime.",
    "role-* enumerates explicit ARIA roles (role=button / role=tab / role=tabpanel / role=dialog / role=log / role=feed etc.).",
    "on* enumerates event handlers.",
    "className tokens enumerate the CSS class hooks the v110 layers bind to.",
    "Pipeline markers preserve the deterministic ordering so two runs on identical fixtures produce identical canonicalHash.",
  ],
}

const json = JSON.stringify(report, null, 2)
if (emit === "artifact") {
  const outPath = join(REPO_ROOT, "parity", "artifacts", "census-extended.json")
  writeFileSync(outPath, json + "\n")
  process.stderr.write(`wrote ${outPath} (${json.length} bytes, hash ${canonicalHash.slice(0, 12)})\n`)
} else {
  process.stdout.write(json + "\n")
}