// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// Static + interaction census for packages/app/src/**.
//
// Runs at F0 bootstrap (no Docker, no Playwright). It walks the file list,
// harvests data-v110= and data-parity= markers, plus reads the TS/TSX source
// to enumerate addEventListener / onClick / onInput / onFocus / onChange /
// onSubmit / onKeyDown handlers. The output feeds parity:census and is the
// static counterpart of the runtime census the harness ships in the F0 image.
//
// Two identical runs on identical fixtures must produce byte-identical
// canonical hashes (timestamps excluded). See parity/census-merge-policy.json.
//
// Usage from packages/app:
//   bun run scripts/parity/census-run.ts [--emit=stdout|artifact]

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { join, relative as relPath } from "node:path"
import { createHash } from "node:crypto"
import { REPO_ROOT } from "./shared"

const root = join(REPO_ROOT, "packages", "app", "src")
const emitArg = process.argv.find((a) => a.startsWith("--emit="))
const emit = emitArg ? emitArg.split("=")[1] : "artifact"

if (!existsSync(root)) {
  process.stderr.write(`missing directory: ${root}\n`)
  process.exit(1)
}

interface MarkerHit {
  kind: "data-v110" | "data-parity" | "data-component" | "data-action"
  key: string
  file: string
  line: number
}

interface HandlerHit {
  handler: string
  file: string
  line: number
  signature: string
}

interface Anchor {
  semanticTargetId: string
  file: string
  line: number
  selector: string
  disposition: string | null
}

const markerPattern = /\[?(data-(?:v110|parity|component|action))[= ]\s*["']?([a-zA-Z0-9_.\-:/]+)["']?\]?/g
const handlerPattern = /\b(on(?:Click|Input|Change|Focus|Blur|Submit|KeyDown|KeyUp|KeyPress|Click|MouseDown|MouseUp|Click|ContextMenu|PointerDown|PointerUp|PointerMove|Drop|DragOver|DragStart|DragEnd|CompositionStart|CompositionEnd|Scroll|Resize|Load|Error|AnimationStart|AnimationEnd|AnimationIteration))\b/g

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

const markers: MarkerHit[] = []
const handlers: HandlerHit[] = []
const anchors: Anchor[] = []

const fileRel = (abs: string) => relPath(root, abs).replaceAll("\\", "/")

for (const file of files) {
  const content = readFileSync(file, "utf8")
  const lines = content.split("\n")

  let match: RegExpExecArray | null
  const markerRe = new RegExp(markerPattern.source, "g")
  while ((match = markerRe.exec(content)) !== null) {
    const before = content.slice(0, match.index)
    const lineNumber = before.split("\n").length
    const kind = match[1] as MarkerHit["kind"]
    const key = match[2]
    if (!key) continue
    markers.push({ kind, key, file: fileRel(file), line: lineNumber })
    if (kind === "data-parity") {
      anchors.push({
        semanticTargetId: key,
        file: fileRel(file),
        line: lineNumber,
        selector: `[data-parity="${key}"]`,
        disposition: null,
      })
    }
  }

  const handlerRe2 = new RegExp(handlerPattern.source, "g")
  while ((match = handlerRe2.exec(content)) !== null) {
    const lineNumber = content.slice(0, match.index).split("\n").length
    const line = lines[lineNumber - 1] ?? ""
    handlers.push({
      handler: match[1]!,
      file: fileRel(file),
      line: lineNumber,
      signature: line.trim().slice(0, 120),
    })
  }
}

markers.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
handlers.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
anchors.sort((a, b) => a.semanticTargetId.localeCompare(b.semanticTargetId) || a.file.localeCompare(b.file))

const counts = {
  files: files.length,
  markers: markers.length,
  byKind: markers.reduce<Record<string, number>>((acc, m) => {
    acc[m.kind] = (acc[m.kind] ?? 0) + 1
    return acc
  }, {}),
  handlers: handlers.length,
  byHandler: handlers.reduce<Record<string, number>>((acc, h) => {
    acc[h.handler] = (acc[h.handler] ?? 0) + 1
    return acc
  }, {}),
  anchors: anchors.length,
}

const canonical = stableStringify({ markers, handlers, anchors })
const canonicalHash = hash(canonical)

const report = {
  schemaVersion: 1,
  capturedAt: "PIPELINE",
  root: "packages/app/src",
  counts,
  markers,
  handlers,
  anchors,
  canonicalHash,
  determinismRequirements: [
    "Two identical runs on identical fixtures produce identical canonicalHash.",
    "capturedAt is PIPELINE so timestamps do not pollute the canonical hash.",
  ],
}

const reportJson = JSON.stringify(report, null, 2)
if (emit === "artifact") {
  const outPath = join(REPO_ROOT, "parity", "artifacts", "census-static.json")
  writeFileSync(outPath, reportJson + "\n")
  process.stderr.write(`wrote ${outPath} (${reportJson.length} bytes, hash ${canonicalHash.slice(0, 12)})\n`)
} else {
  process.stdout.write(reportJson + "\n")
}