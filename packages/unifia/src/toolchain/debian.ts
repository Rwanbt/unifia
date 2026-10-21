// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

export type Pkg = {
  name: string
  version: string
  filename: string
  size: number
  sha256: string
  depends: string[][]
  provides: string[]
}

// One control paragraph as a map. Continuation lines belong to a multi-line field and are not needed.
function fields(paragraph: string) {
  const out = new Map<string, string>()
  for (const line of paragraph.split("\n")) {
    if (line.startsWith(" ") || line.startsWith("\t")) continue
    const at = line.indexOf(":")
    if (at > 0) out.set(line.slice(0, at), line.slice(at + 1).trim())
  }
  return out
}

// "a (>= 1) | b, c" becomes [["a", "b"], ["c"]]: version constraints, arch qualifiers and blanks go.
function alternatives(value: string) {
  return value
    .split(",")
    .map((group) =>
      group
        .split("|")
        .map((alt) => alt.replace(/\(.*?\)/g, "").replace(/\[.*?\]/g, "").replace(/:any\b/, "").trim())
        .filter((alt) => alt.length > 0),
    )
    .filter((group) => group.length > 0)
}

function names(value: string | undefined) {
  if (value === undefined || value.length === 0) return []
  return value.split(",").map((item) => item.replace(/\(.*?\)/g, "").trim()).filter((item) => item.length > 0)
}

// Reads a Packages index. The first paragraph for a name wins, as apt does for one architecture.
export function parseIndex(text: string) {
  const index = new Map<string, Pkg>()
  for (const paragraph of text.split(/\n\s*\n/)) {
    const f = fields(paragraph)
    const name = f.get("Package")
    if (name === undefined || index.has(name)) continue
    index.set(name, {
      name,
      version: f.get("Version") ?? "",
      filename: f.get("Filename") ?? "",
      size: Number(f.get("Size")),
      sha256: f.get("SHA256") ?? "",
      depends: alternatives([f.get("Pre-Depends"), f.get("Depends")].filter((item) => item !== undefined).join(",")),
      provides: names(f.get("Provides")),
    })
  }
  return index
}

// Which indexed packages provide each virtual name, sorted so the choice is deterministic.
function providersOf(index: Map<string, Pkg>) {
  const out = new Map<string, string[]>()
  for (const pkg of index.values()) {
    for (const virtual of pkg.provides) out.set(virtual, [...(out.get(virtual) ?? []), pkg.name].sort())
  }
  return out
}

// The closure of `roots`. A dependency group is satisfied by its first alternative that the index
// can supply (directly or through Provides). Groups satisfied by `host` are left to the host.
export function resolve(index: Map<string, Pkg>, roots: string[], host: string[]) {
  const providers = providersOf(index)
  const pick = (name: string) => (index.has(name) ? name : providers.get(name)?.[0])
  const chosen = new Map<string, Pkg>()
  const visit = (name: string) => {
    const pkg = index.get(name)
    if (pkg === undefined) throw new Error(`unresolved package: ${name}`)
    if (chosen.has(name)) return
    chosen.set(name, pkg)
    for (const group of pkg.depends) {
      if (group.some((alt) => host.includes(alt))) continue
      const next = group.map(pick).find((item) => item !== undefined)
      if (next === undefined) throw new Error(`unresolved dependency: ${group.join(" | ")} (needed by ${name})`)
      visit(next)
    }
  }
  roots.forEach((root) => visit(pick(root) ?? root))
  return [...chosen.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}
