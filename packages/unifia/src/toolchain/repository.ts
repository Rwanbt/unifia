/* SPDX-License-Identifier: MIT */
// Alpine package repository trust chain, verified without apk-tools:
//   APKINDEX  --RSA signature by a pinned Alpine key-->  trusted index
//   index C:  --SHA-1 of the package control member-->  control member
//   control   --RSA signature by the same pinned key (checked again)-->
//   .PKGINFO datahash  --SHA-256 of the data member-->  installed files
// Alpine signs with RSA over SHA-1 (apk-tools v2). The SHA-256 datahash is
// what binds the bytes we extract; the signature binds the datahash.
import { createHash, verify } from "node:crypto"
import { ArchiveError, type GzipMember, readTar, splitGzipMembers, type TarEntry } from "./archive"

export class RepositoryError extends Error {
  override name = "RepositoryError"
}

export interface SigningKey {
  readonly name: string
  readonly pem: string
}

// Copied from https://alpinelinux.org/keys/ and checked byte-identical to
// aports main/alpine-keys on gitlab.alpinelinux.org (2026-10-22); the test
// pins the SHA-256 of each file so an edit here cannot go unnoticed.
export const ALPINE_KEYS = {
  aarch64: {
    name: "alpine-devel@lists.alpinelinux.org-616ae350.rsa.pub",
    pem: `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAyduVzi1mWm+lYo2Tqt/0
XkCIWrDNP1QBMVPrE0/ZlU2bCGSoo2Z9FHQKz/mTyMRlhNqTfhJ5qU3U9XlyGOPJ
piM+b91g26pnpXJ2Q2kOypSgOMOPA4cQ42PkHBEqhuzssfj9t7x47ppS94bboh46
xLSDRff/NAbtwTpvhStV3URYkxFG++cKGGa5MPXBrxIp+iZf9GnuxVdST5PGiVGP
ODL/b69sPJQNbJHVquqUTOh5Ry8uuD2WZuXfKf7/C0jC/ie9m2+0CttNu9tMciGM
EyKG1/Xhk5iIWO43m4SrrT2WkFlcZ1z2JSf9Pjm4C2+HovYpihwwdM/OdP8Xmsnr
DzVB4YvQiW+IHBjStHVuyiZWc+JsgEPJzisNY0Wyc/kNyNtqVKpX6dRhMLanLmy+
f53cCSI05KPQAcGj6tdL+D60uKDkt+FsDa0BTAobZ31OsFVid0vCXtsbplNhW1IF
HwsGXBTVcfXg44RLyL8Lk/2dQxDHNHzAUslJXzPxaHBLmt++2COa2EI1iWlvtznk
Ok9WP8SOAIj+xdqoiHcC4j72BOVVgiITIJNHrbppZCq6qPR+fgXmXa+sDcGh30m6
9Wpbr28kLMSHiENCWTdsFij+NQTd5S47H7XTROHnalYDuF1RpS+DpQidT5tUimaT
JZDr++FjKrnnijbyNF8b98UCAwEAAQ==
-----END PUBLIC KEY-----
`,
  },
  x86_64: {
    name: "alpine-devel@lists.alpinelinux.org-6165ee59.rsa.pub",
    pem: `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAutQkua2CAig4VFSJ7v54
ALyu/J1WB3oni7qwCZD3veURw7HxpNAj9hR+S5N/pNeZgubQvJWyaPuQDm7PTs1+
tFGiYNfAsiibX6Rv0wci3M+z2XEVAeR9Vzg6v4qoofDyoTbovn2LztaNEjTkB+oK
tlvpNhg1zhou0jDVYFniEXvzjckxswHVb8cT0OMTKHALyLPrPOJzVtM9C1ew2Nnc
3848xLiApMu3NBk0JqfcS3Bo5Y2b1FRVBvdt+2gFoKZix1MnZdAEZ8xQzL/a0YS5
Hd0wj5+EEKHfOd3A75uPa/WQmA+o0cBFfrzm69QDcSJSwGpzWrD1ScH3AK8nWvoj
v7e9gukK/9yl1b4fQQ00vttwJPSgm9EnfPHLAtgXkRloI27H6/PuLoNvSAMQwuCD
hQRlyGLPBETKkHeodfLoULjhDi1K2gKJTMhtbnUcAA7nEphkMhPWkBpgFdrH+5z4
Lxy+3ek0cqcI7K68EtrffU8jtUj9LFTUC8dERaIBs7NgQ/LfDbDfGh9g6qVj1hZl
k9aaIPTm/xsi8v3u+0qaq7KzIBc9s59JOoA8TlpOaYdVgSQhHHLBaahOuAigH+VI
isbC9vmqsThF2QdDtQt37keuqoda2E6sL7PUvIyVXDRfwX7uMDjlzTxHTymvq2Ck
htBqojBnThmjJQFgZXocHG8CAwEAAQ==
-----END PUBLIC KEY-----
`,
  },
} as const satisfies Record<string, SigningKey>

export interface IndexPackage {
  readonly name: string
  readonly version: string
  readonly arch: string
  readonly size: number
  readonly installedSize: number
  readonly license: string
  readonly checksum: string
  readonly depends: readonly string[]
  readonly provides: readonly string[]
  readonly priority: number
}

export interface VerifiedPackage {
  readonly entries: TarEntry[]
  readonly sha256: string
  // apk install scripts are not run: they assume root inside a chroot.
  readonly scripts: readonly string[]
}

function members(bytes: Uint8Array, expected: number): GzipMember[] {
  let split: GzipMember[]
  try {
    split = splitGzipMembers(bytes)
  } catch (error) {
    throw new RepositoryError(error instanceof ArchiveError ? error.message : String(error))
  }
  if (split.length !== expected) throw new RepositoryError(`expected ${expected} gzip members, found ${split.length}`)
  return split
}

function verifySignature(signatureMember: GzipMember, signed: GzipMember, keys: readonly SigningKey[]) {
  const [entry] = readTar(signatureMember.decompressed)
  const match = entry?.path.match(/^\.SIGN\.(RSA|RSA256)\.(.+)$/)
  if (!entry || !match) throw new RepositoryError("first member is not an apk signature")
  const key = keys.find((candidate) => candidate.name === match[2])
  if (!key) throw new RepositoryError(`signing key "${match[2]}" is not pinned`)
  if (!verify(match[1] === "RSA" ? "sha1" : "sha256", signed.compressed, key.pem, entry.data)) {
    throw new RepositoryError(`bad signature from "${key.name}"`)
  }
}

export function parseIndex(text: string): IndexPackage[] {
  return text
    .split(/\n\s*\n/)
    .filter((block) => block.trim() !== "")
    .map((block) => {
      const fields = new Map(block.split("\n").filter(Boolean).map((line) => [line[0]!, line.slice(2)] as const))
      const list = (key: string) => (fields.get(key) ?? "").split(" ").filter(Boolean)
      const name = fields.get("P")
      const version = fields.get("V")
      if (!name || !version) throw new RepositoryError("index entry without P: or V:")
      return {
        name,
        version,
        arch: fields.get("A") ?? "",
        size: Number(fields.get("S") ?? Number.NaN),
        installedSize: Number(fields.get("I") ?? 0),
        license: fields.get("L") ?? "",
        checksum: fields.get("C") ?? "",
        depends: list("D"),
        provides: list("p"),
        priority: Number(fields.get("k") ?? 0),
      }
    })
}

export function loadIndex(bytes: Uint8Array, keys: readonly SigningKey[]): IndexPackage[] {
  const [signature, signed] = members(bytes, 2)
  verifySignature(signature!, signed!, keys)
  const index = readTar(signed!.decompressed).find((entry) => entry.path === "APKINDEX")
  if (!index) throw new RepositoryError("signed index has no APKINDEX")
  return parseIndex(new TextDecoder().decode(index.data))
}

export function verifyPackage(bytes: Uint8Array, entry: IndexPackage, keys: readonly SigningKey[]): VerifiedPackage {
  if (bytes.length !== entry.size) throw new RepositoryError(`${entry.name}: size ${bytes.length} != index ${entry.size}`)
  const [signature, control, data] = members(bytes, 3)
  verifySignature(signature!, control!, keys)
  const checksum = `Q1${createHash("sha1").update(control!.compressed).digest("base64")}`
  if (checksum !== entry.checksum) throw new RepositoryError(`${entry.name}: control checksum does not match the index`)
  const controlEntries = readTar(control!.decompressed)
  const info = new TextDecoder().decode(controlEntries.find((file) => file.path === ".PKGINFO")?.data)
  const datahash = info.match(/^datahash = ([0-9a-f]{64})$/m)?.[1]
  if (datahash !== createHash("sha256").update(data!.compressed).digest("hex")) {
    throw new RepositoryError(`${entry.name}: data does not match the signed datahash`)
  }
  return {
    entries: readTar(data!.decompressed),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    scripts: controlEntries.map((file) => file.path).filter((name) => name !== ".PKGINFO"),
  }
}

const SUFFIX_RANK: Record<string, number> = { alpha: 0, beta: 1, pre: 2, rc: 3, "": 4, cvs: 5, svn: 6, git: 7, hg: 8, p: 9 }

function versionKey(version: string): number[] {
  const match = version.match(/^([0-9.]+)([a-z]?)((?:_[a-z]+\d*)*)(?:~[0-9a-f]+)?(?:-r(\d+))?$/)
  if (!match) throw new RepositoryError(`unparseable version "${version}"`)
  const suffixes = [...match[3]!.matchAll(/_([a-z]+)(\d*)/g)].flatMap(([, word, number]) => [SUFFIX_RANK[word!] ?? 4, Number(number || 0)])
  return [...match[1]!.split(".").map(Number), -1, match[2] ? match[2].charCodeAt(0) : 0, ...suffixes, SUFFIX_RANK[""]!, 0, Number(match[4] ?? 0)]
}

export function compareVersions(left: string, right: string): number {
  const [a, b] = [versionKey(left), versionKey(right)]
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? -2) - (b[index] ?? -2)
    if (difference !== 0) return Math.sign(difference)
  }
  return 0
}

const CONSTRAINT = /^([^<>=~]+)(?:(>=|<=|>|<|=|~)(.+))?$/

function satisfies(version: string | undefined, operator: string | undefined, wanted: string | undefined): boolean {
  if (!operator) return true
  if (!version) return false
  if (operator === "~") return version.startsWith(wanted!)
  const order = compareVersions(version, wanted!)
  return { ">=": order >= 0, "<=": order <= 0, ">": order > 0, "<": order < 0, "=": order === 0 }[operator] ?? false
}

export function resolve(index: readonly IndexPackage[], roots: readonly string[]): IndexPackage[] {
  const providers = new Map<string, { entry: IndexPackage; version?: string }[]>()
  const add = (name: string, entry: IndexPackage, version?: string) => providers.set(name, [...(providers.get(name) ?? []), { entry, version }])
  for (const entry of index) {
    add(entry.name, entry, entry.version)
    for (const provided of entry.provides) add(provided.split("=")[0]!, entry, provided.split("=")[1])
  }
  const ordered: IndexPackage[] = []
  const visited = new Set<string>()
  const visit = (dependency: string) => {
    const [, name, operator, wanted] = dependency.match(CONSTRAINT) ?? []
    const candidates = (providers.get(name ?? "") ?? []).filter((candidate) => satisfies(candidate.version, operator, wanted))
    const chosen = candidates.find((candidate) => candidate.entry.name === name) ?? candidates.sort((a, b) => b.entry.priority - a.entry.priority)[0]
    if (!chosen) throw new RepositoryError(`no package satisfies "${dependency}"`)
    if (visited.has(chosen.entry.name)) return
    visited.add(chosen.entry.name)
    for (const next of chosen.entry.depends) if (!next.startsWith("!")) visit(next)
    ordered.push(chosen.entry)
  }
  for (const root of roots) visit(root)
  return ordered
}
