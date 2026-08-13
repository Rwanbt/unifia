import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

const roots = ["packages"]
const allowed = new Set([
  path.normalize("packages/workbench-shell/src/modes.ts"),
  path.normalize("packages/spec-runtime/src/index.ts"),
])
const pattern = /(?:=|new Set<[^>]+>\()\s*\[?["'`]code["'`],\s*["'`]work["'`],\s*["'`]design["'`],\s*["'`]automate["'`]/
const found = []

async function visit(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "dist" && entry.name !== "build") await visit(file)
      continue
    }
    if (!/\.(?:ts|tsx|js|mjs)$/.test(entry.name)) continue
    const source = await readFile(file, "utf8")
    if (pattern.test(source) && !allowed.has(path.normalize(file))) found.push(file)
  }
}

for (const root of roots) await visit(root)
if (found.length > 0) {
  console.error(`third mode registry detected:\n${found.join("\n")}`)
  process.exit(1)
}
console.log("ModeRegistryGuard: no third registry detected")
