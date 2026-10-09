/* SPDX-License-Identifier: MIT */
import { expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * The Browser host runs under Node with type stripping (ADR-089). Node resolves
 * `./runtime.js` literally, so it cannot load the `@unifia/contracts` package
 * root, whose `.js` specifiers point at `.ts` sources; only its subpaths are
 * importable. A value import of the root passes every Bun test and every
 * typecheck, then kills the host the first time that code path runs (it did, on
 * the first navigation). Type-only imports are erased and are fine.
 */
const roots = [join(import.meta.dir, "../src"), join(import.meta.dir, "../../network-authority/src")]

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sources(join(directory, entry.name)) : entry.name.endsWith(".ts") ? [join(directory, entry.name)] : [],
  )
}

function valueImportsOfContractsRoot(text: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s*from\s*"@unifia\/contracts"/g)) {
    if (match[1]) continue
    const names = match[2]!.split(",").map((name) => name.trim()).filter(Boolean)
    found.push(...names.filter((name) => !name.startsWith("type ")))
  }
  return found
}

test("code the Node host loads never value-imports the contracts package root", () => {
  const offenders = roots.flatMap((root) =>
    sources(root).flatMap((file) => {
      const names = valueImportsOfContractsRoot(readFileSync(file, "utf8"))
      return names.length ? [`${file}: ${names.join(", ")}`] : []
    }),
  )
  expect(offenders).toEqual([])
})
