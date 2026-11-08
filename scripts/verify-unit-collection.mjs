// SPDX-License-Identifier: MIT
// A structural collection gate, not a line/branch coverage metric.
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { resolve, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

export const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
export const UNIT_TEST_NAME = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/
export const EXCEPTIONS = new Map([
  ["packages/unifia/test/session/structured-output-integration.test.ts", "real Gemini API quota; non-blocking integration workflow"],
  ["packages/workbench-server/test/real-transport.test.ts", "Chromium E2E, untracked browser harness missing"],
])
export function discoverManifests(root = ROOT) {
  const base = resolve(root, "packages")
  const result = []
  if (!existsSync(base)) return result
  for (const parent of readdirSync(base, { withFileTypes: true })) {
    if (!parent.isDirectory()) continue
    const dir = resolve(base, parent.name)
    if (existsSync(resolve(dir, "package.json"))) result.push(resolve(dir, "package.json"))
    for (const child of readdirSync(dir, { withFileTypes: true })) {
      if (!child.isDirectory() || child.name === "node_modules") continue
      const nested = resolve(dir, child.name, "package.json")
      if (existsSync(nested)) result.push(nested)
    }
  }
  return result
}
export function findOwner(file, manifests) {
  return manifests.filter((m) => file.startsWith(m.dir + "/")).sort((a, b) => b.dir.length - a.dir.length)[0]
}
function bunTestSelects(file, command) {
  const run = /\bbun\s+test(?:\s|$)/.exec(command)
  const tail = command.slice(run.index + run[0].length)
    .replace(/--[\w-]+(?:=(?:'[^']*'|"[^"]*"|\S+))?/g, " ")
    .replace(/^\s*\d+\s*/, " ")
  const candidates = tail.split(/\s+/).map((s) => s.replace(/^\.\//, ""))
    .filter((s) => s === "test" || s === "tests" || s === "src" || s === "script" || /^(?:src|test|tests|script)\//.test(s))
  if (!candidates.length) return true
  return candidates.some((c) => file === c || file.startsWith(c.replace(/\/$/, "") + "/"))
}

export function scriptCovers(file, script) {
  if (!script) return false
  if (script.includes(file)) return true
  // A Bun CLI invocation with positional roots selects only those roots.
  // Runtime flags (preload, timeout, reporters, ignore-patterns) are not test selectors.
  // A script may chain several runs (`bun test ./src && bun test ./test/component`);
  // the file is collected when any of them selects it.
  const runs = script.split(/&&|;/).filter((command) => /\bbun\s+test(?:\s|$)/.test(command))
  if (runs.length) return runs.some((command) => bunTestSelects(file, command))
  // Some scripts directly execute a named Bun test module, not "bun test".
  return script.includes(file) || script.includes("./" + file)
}

export function audit(manifests, paths, exceptions = EXCEPTIONS) {
  const missing = [], invalid = [], excluded = []
  let covered = 0
  for (const file of paths.filter((p) => UNIT_TEST_NAME.test(p) && !p.includes("/e2e/"))) {
    const owner = findOwner(file, manifests)
    if (!owner) continue
    const note = exceptions.get(file)
    if (note) { excluded.push({file, note}); continue }
    const local = file.slice(owner.dir.length + 1)
    const scripts = owner.scripts ?? {}
    if (!scripts["test:ci"]) { missing.push({file, reason:"missing test:ci"}); continue }
    const ci = scripts["test:ci"]
    const runner = (/\bbun run test(?:\s|$)/.test(ci) || /node \.\.\/\.\.\/scripts\/run-legacy-unit\.mjs/.test(ci)) ? scripts.test : ci
    if (!scriptCovers(local, runner)) missing.push({file, reason:"not selected by test:ci"})
    else covered++
  }
  for (const m of manifests) if (m.scripts?.test && !m.scripts["test:ci"]) invalid.push({dir:m.dir, reason:"test exists without test:ci"})
  for (const key of exceptions.keys()) if (!paths.includes(key)) invalid.push({dir:key, reason:"stale exception"})
  return { covered, missing, invalid, excluded }
}
export function readWorkspaceManifests(root = ROOT) {
  return discoverManifests(root).map((filename) => {
    const pkg=JSON.parse(readFileSync(filename,"utf8"))
    return { dir: relative(root,resolve(filename,"..")).split(sep).join("/"), scripts:pkg.scripts??{} }
  })
}
export function trackedFiles(root = ROOT) {
  return execFileSync("git",["ls-files","-z","--","packages"],{cwd:root,encoding:"utf8",maxBuffer:16*1024*1024})
    .split("\0").filter(Boolean).map((s)=>s.replaceAll("\\","/"))
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result=audit(readWorkspaceManifests(),trackedFiles())
  console.log("Unit test collection: "+result.covered+" covered, "+result.excluded.length+" explicit exceptions, "+result.missing.length+" missing, "+result.invalid.length+" configuration errors")
  for (const x of result.excluded) console.log("EXCLUDED "+x.file+": "+x.note)
  for (const x of result.missing) console.error("UNCOLLECTED "+x.file+": "+x.reason)
  for (const x of result.invalid) console.error("CONFIG "+x.dir+": "+x.reason)
  if (!result.covered || result.missing.length || result.invalid.length) process.exitCode=1
}
