// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

import z from "zod"

// Hosts a toolchain may be downloaded from. Adding a host is a trust decision and
// must be ratified by the owner; it is not configurable at runtime.
const TRUSTED_HOSTS = ["dl-cdn.alpinelinux.org"]

const id = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/, "id must be lowercase kebab-case")
const exact = z.string().regex(/^\d[0-9A-Za-z._+-]*$/, "version must be an exact pin, not a range")
const bin = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]*$/, "bin must be a bare file name")
const digest = z.string().regex(/^[a-f0-9]{64}$/, "sha256 must be 64 lowercase hex digits")

function trusted(value: string) {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  return url.protocol === "https:" && TRUSTED_HOSTS.includes(url.hostname)
}

const Entry = z
  .object({
    id,
    name: z.string().min(1),
    version: exact,
    arch: z.enum(["aarch64", "x86_64"]),
    license: z.string().min(1),
    source: z
      .object({
        url: z.string().refine(trusted, "source must be https on a trusted host"),
        sha256: digest,
      })
      .strict(),
    bins: z.array(bin).min(1),
    depends: z.array(id).default([]),
  })
  .strict()

export type Entry = z.infer<typeof Entry>

export function parse(input: unknown): Entry[] {
  const entries = z.array(Entry).parse(input)
  unique(entries)
  owners(entries)
  entries.forEach((entry) => closure(entries, entry.id))
  return entries
}

// Returns the entries needed to install `root`, dependencies first.
export function closure(entries: Entry[], root: string): Entry[] {
  const index = new Map(entries.map((entry) => [entry.id, entry]))
  const done = new Set<string>()
  const order: Entry[] = []
  const visit = (id: string, path: string[]): void => {
    const entry = index.get(id)
    if (!entry) throw new Error(`unknown toolchain: ${id}`)
    if (path.includes(id)) throw new Error(`dependency cycle: ${[...path, id].join(" -> ")}`)
    if (done.has(id)) return
    entry.depends.forEach((dep) => visit(dep, [...path, id]))
    done.add(id)
    order.push(entry)
  }
  visit(root, [])
  return order
}

function unique(entries: Entry[]) {
  const ids = entries.map((entry) => entry.id)
  const dup = ids.find((item, i) => ids.indexOf(item) !== i)
  if (dup) throw new Error(`duplicate toolchain id: ${dup}`)
}

// A binary name may be provided by one entry only, so PATH resolution is unambiguous.
function owners(entries: Entry[]) {
  const claims = entries.flatMap((entry) => entry.bins.map((name) => ({ name, id: entry.id })))
  claims.forEach((own, i) => {
    const other = claims.find((claim, j) => j !== i && claim.name === own.name && claim.id !== own.id)
    if (other) throw new Error(`binary ${own.name} provided by ${own.id} and ${other.id}`)
  })
}
