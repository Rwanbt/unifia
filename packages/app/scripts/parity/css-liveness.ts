// SPDX-License-Identifier: MIT
// One-shot: list class selectors defined in packages/app/src/styles/v110-*.css
// that no source file (app or ui) references. Used to decide which v110 layers
// are inert contract chrome vs real chrome.

import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { execSync } from "node:child_process"

const repo = "D:/App/unifia/_a7-automate-memory"
const stylesDir = join(repo, "packages", "app", "src", "styles")

const cssFiles = readdirSync(stylesDir).filter((f) => f.startsWith("v110-") && f.endsWith(".css"))

const classPattern = /\.([a-z][a-z0-9-]*(?:-{1,2}[a-z0-9-]+)*)/gi

const defined = new Map<string, string[]>()
for (const file of cssFiles) {
  const content = readFileSync(join(stylesDir, file), "utf8")
  const withoutComments = content.replace(/\/\*[\s\S]*?\*\//g, "")
  let m: RegExpExecArray | null
  const re = new RegExp(classPattern.source, "g")
  while ((m = re.exec(withoutComments)) !== null) {
    const cls = m[1]!.toLowerCase()
    const list = defined.get(cls) ?? []
    if (!list.includes(file)) list.push(file)
    defined.set(cls, list)
  }
}

const tracked = execSync("git ls-files", { cwd: repo, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(tsx?|jsx?)$/.test(f) && (f.startsWith("packages/app/src") || f.startsWith("packages/ui/src")))

const corpus = tracked.map((f) => readFileSync(join(repo, f), "utf8")).join("\n")

const inert: Array<{ cls: string; files: string[] }> = []
const live: Array<{ cls: string; files: string[] }> = []
for (const [cls, files] of defined) {
  const re = new RegExp(`(^|[^a-z0-9-])${cls.replace(/[-]/g, "\\-")}([^a-z0-9-]|$)`, "i")
  if (re.test(corpus)) live.push({ cls, files })
  else inert.push({ cls, files })
}

inert.sort((a, b) => a.cls.localeCompare(b.cls))
live.sort((a, b) => a.cls.localeCompare(b.cls))

console.log(`defined class selectors: ${defined.size}`)
console.log(`live (referenced in app/ui source): ${live.length}`)
console.log(`inert (referenced nowhere): ${inert.length}`)
console.log("")
console.log("=== INERT ===")
for (const { cls, files } of inert) console.log(`${cls}  <- ${files.join(", ")}`)
console.log("")
console.log("=== LIVE (first 60) ===")
for (const { cls } of live.slice(0, 60)) console.log(cls)
