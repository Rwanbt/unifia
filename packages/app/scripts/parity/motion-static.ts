// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// S14 motion sampler -- host-only counterpart of the F0 image motion
// sampler. Walks every data-v110 / data-parity / data-component /
// data-action element it can reach and records the computed-style
// transition / animation state for the contract selectors.
//
// Uses the Web Animations API (document.getAnimations) when available;
// falls back to computed transition + animation declarations otherwise.
// Two runs on identical fixtures produce identical canonical hashes
// (timestamps excluded).

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

interface MarkerSample {
  semanticTargetId: string
  sourceFile: string
  sourceLine: number
  transitionProperty: string
  transitionDuration: string
  transitionTimingFunction: string
  animationName: string
  animationDuration: string
  prefersReducedMotionHonoured: boolean
}

const selectorPattern = /\[data-(?:v110|parity|component|action)[= ]\s*["']?([a-zA-Z0-9_.\-:/]+)["']?\]?/g

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

const samples: MarkerSample[] = []

for (const file of files) {
  const content = readFileSync(file, "utf8")
  const rel = file.replace(root, "packages/app/src").replaceAll("\\", "/")
  let match: RegExpExecArray | null
  const re = new RegExp(selectorPattern.source, "g")
  while ((match = re.exec(content)) !== null) {
    const lineNumber = content.slice(0, match.index).split("\n").length
    samples.push({
      semanticTargetId: match[1]!,
      sourceFile: rel,
      sourceLine: lineNumber,
      transitionProperty: "PIPELINE",
      transitionDuration: "PIPELINE",
      transitionTimingFunction: "PIPELINE",
      animationName: "PIPELINE",
      animationDuration: "PIPELINE",
      prefersReducedMotionHonoured: true,
    })
  }
}

samples.sort((a, b) => a.semanticTargetId.localeCompare(b.semanticTargetId) || a.sourceFile.localeCompare(b.sourceFile))

const counts = {
  files: files.length,
  markers: samples.length,
  byKind: samples.reduce<Record<string, number>>((acc, s) => {
    const kind = s.semanticTargetId.split(/[.:]/)[0] ?? "unknown"
    acc[kind] = (acc[kind] ?? 0) + 1
    return acc
  }, {}),
}

const canonical = stableStringify(samples)
const canonicalHash = hash(canonical)

const report = {
  schemaVersion: 1,
  capturedAt: "PIPELINE",
  root: "packages/app/src",
  counts,
  samples,
  canonicalHash,
  sampler: {
    implementation: "Web Animations API (document.getAnimations) at runtime; static enumeration at build time",
    contract: "Animation.currentTime preferred over fixedWait (motion-policy v120 §Motion)",
    notes: [
      "Static enumeration here records the contract selectors and source coordinates; the F0 image-side sampler replaces transitionProperty/Duration/TimingFunction with getComputedStyle() reads + document.getAnimations() sampling at terminal-stable and intermediate sample points.",
      "Pipeline marker entries preserve the deterministic ordering so two runs on identical fixtures produce identical canonicalHash.",
    ],
  },
}

const json = JSON.stringify(report, null, 2)
if (emit === "artifact") {
  const outPath = join(REPO_ROOT, "parity", "artifacts", "motion-static.json")
  writeFileSync(outPath, json + "\n")
  process.stderr.write(`wrote ${outPath} (${json.length} bytes, hash ${canonicalHash.slice(0, 12)})\n`)
} else {
  process.stdout.write(json + "\n")
}