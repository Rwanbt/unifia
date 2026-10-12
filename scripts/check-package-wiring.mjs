/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

// Fails when a workspace package is not reachable from what the product ships,
// unless scripts/package-wiring.json lists it as intentionally not shipped.
// WHY: a green suite says a package works, never that anything calls it; the
// runtime packages behind release-hardening gates looked "implemented" while
// no shipped code imported them. Reachability is by non-test source imports.
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const packagesDir = path.join(repoRoot, "packages")
const manifestFile = path.join(repoRoot, "scripts", "package-wiring.json")
const skippedDirectories = new Set(["node_modules", "dist", "build", "out", "gen", "generated", "test", "tests", "e2e", "__tests__", "script", "scripts", "stories", "target"])
const sourceFile = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/
const testFile = /\.(?:test|spec|stories)\.[a-z]+$/
const importSpecifier = /(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s+)["'](@unifia\/[a-z0-9-]+)(?:\/[^"']*)?["']/g

async function listSources(dir) {
  const files = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) files.push(...(await listSources(file)))
    } else if (sourceFile.test(entry.name) && !testFile.test(entry.name)) files.push(file)
  }
  return files
}

async function loadPackages() {
  const packages = new Map()
  for (const entry of await readdir(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = path.join(packagesDir, entry.name)
    let manifest
    try {
      manifest = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"))
    } catch (error) {
      if (error.code === "ENOENT") continue
      throw error
    }
    packages.set(manifest.name, { dir, imports: new Set() })
  }
  return packages
}

export async function computeWiring(shippedRoots) {
  const packages = await loadPackages()
  for (const [name, info] of packages) {
    for (const file of await listSources(info.dir)) {
      for (const match of (await readFile(file, "utf8")).matchAll(importSpecifier)) {
        if (match[1] !== name && packages.has(match[1])) info.imports.add(match[1])
      }
    }
  }
  const reached = new Set()
  const queue = shippedRoots.filter((name) => packages.has(name))
  while (queue.length > 0) {
    const name = queue.pop()
    if (reached.has(name)) continue
    reached.add(name)
    for (const next of packages.get(name).imports) queue.push(next)
  }
  return { all: [...packages.keys()], reached }
}

async function main() {
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"))
  const { all, reached } = await computeWiring(manifest.shippedRoots)
  const notShipped = new Map(manifest.notShipped.map((item) => [item.package, item.reason]))
  const problems = []
  for (const name of all) {
    const shipped = reached.has(name)
    if (!shipped && !notShipped.has(name)) problems.push(`${name}: no shipped code imports it; wire it or list it in scripts/package-wiring.json with a reason`)
    if (shipped && notShipped.has(name)) problems.push(`${name}: is imported by shipped code but still listed as not shipped; remove the entry`)
  }
  for (const name of notShipped.keys()) if (!all.includes(name)) problems.push(`${name}: listed as not shipped but the package no longer exists`)
  if (problems.length > 0) {
    console.error(problems.join("\n"))
    process.exit(1)
  }
  console.log(`package wiring ok: ${reached.size} reached from the shipped roots, ${notShipped.size} declared not shipped`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
