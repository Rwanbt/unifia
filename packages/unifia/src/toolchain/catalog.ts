// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

import z from "zod"

// Hosts a toolchain artifact may be downloaded from. Adding a host is a trust decision that the
// owner ratifies; it is not configurable at runtime.
const TRUSTED_HOSTS = [
  "dl-cdn.alpinelinux.org",
  "registry.npmjs.org",
  "proxy.golang.org",
  "nodejs.org",
  "archive.ubuntu.com",
  "ports.ubuntu.com",
]

// ADR-027 section 8: permissive licences are allowed; copyleft needs a documented exception.
const PERMISSIVE = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"]

export const PLATFORMS = ["linux-arm64", "linux-x64"] as const
export type Platform = (typeof PLATFORMS)[number]

const id = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/, "id must be lowercase kebab-case")
const exact = z.string().regex(/^\d[0-9A-Za-z._+-]*$/, "version must be an exact pin, not a range")
const bin = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]*$/, "bin must be a bare file name")
const digest = z.string().regex(/^[a-f0-9]{64}$/, "sha256 must be 64 lowercase hex digits")
const sri = z.string().regex(/^sha512-[A-Za-z0-9+/]{86}==$/, "sha512 must be an npm-style SRI string")
const dirhash = z.string().regex(/^h1:[A-Za-z0-9+/]{43}=$/, "h1 must be a Go module dirhash")

function trusted(value: string) {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  return url.protocol === "https:" && TRUSTED_HOSTS.includes(url.hostname)
}

// A relative path inside the install root: no leading slash and no "." or ".." segment.
function relative(value: string) {
  return value.split("/").every((seg) => /^[A-Za-z0-9@._+-]+$/.test(seg) && seg !== "." && seg !== "..")
}

// A package of a deb-set, pinned by the sha256 of the .deb file in its signed repository index.
const debPackage = z
  .object({
    name: z.string().regex(/^[a-z0-9][a-z0-9+.-]*$/, "package name must be a Debian name"),
    version: z.string().min(1),
    url: z.string().refine(trusted, "source must be https on a trusted host"),
    size: z.number().int().positive(),
    sha256: digest,
  })
  .strict()

// `.` is the install root itself, which a deb-set uses; any other prefix must be relative and clean.
const prefixOk = (value: string) => value === "." || relative(value)

// One artifact is either a single archive (url, size and digest) or a deb-set (packages only).
const artifact = z
  .object({
    platform: z.enum(PLATFORMS),
    archive: z.enum(["tar.gz", "tar.xz", "zip", "deb-set"]),
    url: z.string().refine(trusted, "source must be https on a trusted host").optional(),
    prefix: z.string().refine(prefixOk, "prefix must be a relative path without . or .. segments").default("."),
    size: z.number().int().positive().optional(),
    sha256: digest.optional(),
    sha512: sri.optional(),
    h1: dirhash.optional(),
    packages: z.array(debPackage).min(1).optional(),
  })
  .strict()
  .refine(
    (item) => (item.archive === "deb-set") === (item.packages !== undefined),
    "deb-set artifacts list packages, and only deb-set artifacts do",
  )
  .refine(
    (item) =>
      item.archive === "deb-set" ? item.url === undefined && item.size === undefined : item.url !== undefined && item.size !== undefined,
    "a single archive needs a url and size",
  )
  .refine(
    (item) => item.archive === "deb-set" || item.sha256 !== undefined || item.sha512 !== undefined || item.h1 !== undefined,
    "artifact needs a digest",
  )

const Entry = z
  .object({
    id,
    name: z.string().min(1),
    version: exact,
    license: z.string().min(1),
    exception: z.string().regex(/^ADR-\d{3,4}\b/, "exception must cite an ADR number").optional(),
    bindir: z.string().refine(relative, "bindir must be a relative path without . or .. segments").default("bin"),
    bins: z.array(bin).min(1),
    libdirs: z.array(z.string().refine(relative, "libdirs must be relative paths inside the install root")).default([]),
    depends: z.array(id).default([]),
    probe: z.object({ args: z.array(z.string().min(1)).min(1), expect: z.string().min(1) }).strict(),
    artifacts: z.array(artifact).min(1),
  })
  .strict()
  .refine(
    (entry) => PERMISSIVE.includes(entry.license) || entry.exception !== undefined,
    "copyleft licence needs an ADR exception",
  )

export type Entry = z.infer<typeof Entry>
export type Artifact = Entry["artifacts"][number]

export function parse(input: unknown): Entry[] {
  const entries = z.array(Entry).parse(input)
  unique(entries)
  owners(entries)
  entries.forEach(platforms)
  entries.forEach((entry) => closure(entries, entry.id))
  return entries
}

// The artifact an entry ships for one platform, if it has one.
export function artifactFor(entry: Entry, platform: Platform): Artifact | undefined {
  return entry.artifacts.find((item) => item.platform === platform)
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

// At most one artifact per platform, so the choice of artifact is never ambiguous.
function platforms(entry: Entry) {
  const seen = entry.artifacts.map((item) => item.platform)
  const dup = seen.find((item, i) => seen.indexOf(item) !== i)
  if (dup) throw new Error(`more than one artifact for ${dup} in ${entry.id}`)
}
