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

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { REPO_ROOT, hashCanonical } from "./shared"
import { assertBrandCssSync, canonicalTokens } from "./tokens-canonical"

const stylesDir = join(REPO_ROOT, "packages", "app", "src")
const emitArg = process.argv.find((a) => a.startsWith("--emit="))
const emit = emitArg ? emitArg.split("=")[1] : "artifact"

const cssFiles: string[] = []
function walk(dir: string): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full)
    else if (entry.endsWith(".css")) cssFiles.push(full)
  }
}
walk(stylesDir)
cssFiles.sort()
if (cssFiles.length === 0) throw new Error(`Token audit found no CSS files in ${stylesDir}`)
assertBrandCssSync(REPO_ROOT)

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
    const value = content
      .slice(idx + match[0].length, lineEnd === -1 ? content.length : lineEnd)
      .trim()
      .replace(/;$/, "")
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

// Dead-CSS detector: every `[data-v110="x"]` selector in the CSS layers must
// be referenced by at least one marker in the app source. A selector with no
// matching marker is speculative chrome and must be removed or wired, per the
// AGENTS.md "no dead code" rule and the consolidated plan §9 (unclassified
// and dead paths must surface, never be hidden).
const cssDir = join(REPO_ROOT, "packages", "app", "src", "styles")
const srcDir = join(REPO_ROOT, "packages", "app", "src")
const selectorPattern2 = /\[data-v110="([^"]+)"\]/g
const dataV110InCss: string[] = []
for (const file of cssFiles) {
  const content = readFileSync(file, "utf8")
  const rel = file.replace(cssDir, "packages/app/src/styles").replaceAll("\\", "/")
  let m: RegExpExecArray | null
  const re = new RegExp(selectorPattern2.source, "g")
  while ((m = re.exec(content)) !== null) {
    dataV110InCss.push(m[1]!)
  }
  void rel
}

// Collect every data-v110 marker key referenced in the app source, covering
// both the JSX form `data-v110="x"` and the object-literal form
// `"data-v110": "x"`.
const dataV110InApp = new Set<string>()
const appMarkerPattern = /["']?(data-v110)["']?\s*[:=]\s*["']([a-zA-Z0-9_.\-:/ ]+)["']/g
function walkSrc(dir: string): void {
  for (const dirent of readdirSync(dir, { withFileTypes: true })) {
    const entry = dirent.name
    const full = join(dir, entry)
    if (dirent.isDirectory()) {
      walkSrc(full)
    } else if (/\.(tsx?|jsx?)$/.test(entry)) {
      const content = readFileSync(full, "utf8")
      let m: RegExpExecArray | null
      const re = new RegExp(appMarkerPattern.source, "g")
      while ((m = re.exec(content)) !== null) {
        dataV110InApp.add(m[2]!)
      }
    }
  }
}
walkSrc(srcDir)

const uniqueCssSelectors = [...new Set(dataV110InCss)].sort()
const deadSelectors = uniqueCssSelectors.filter((s) => !dataV110InApp.has(s))
const unStyledMarkers = [...dataV110InApp].filter((s) => !uniqueCssSelectors.includes(s)).sort()

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
  cssDataV110Selectors: uniqueCssSelectors.length,
  appDataV110Markers: dataV110InApp.size,
  deadDataV110Selectors: deadSelectors.length,
  unStyledDataV110Markers: unStyledMarkers.length,
}

if (!v110Properties.length) throw new Error("Token audit found no v110 token declarations")
const canonical = canonicalTokens({ declarations, usages, selectors, counts })
const canonicalHash = hashCanonical(canonical)

const report = {
  schemaVersion: 1,
  capturedAt: "PIPELINE",
  root: "packages/app/src",
  counts,
  declarations: canonical.declarations,
  usages: canonical.usages,
  selectors: canonical.selectors,
  undeclaredUsed: undeclaredUsed.sort(),
  v110Tokens: Array.from(new Set(v110Properties.map((v) => v.property))).sort(),
  deadDataV110Selectors: deadSelectors,
  unStyledDataV110Markers: unStyledMarkers,
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
