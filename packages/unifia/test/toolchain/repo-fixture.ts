/* SPDX-License-Identifier: MIT */
// A real signed Alpine-format repository, built in memory with a throwaway
// key: the manager runs its full verification chain against it.
import { createHash, generateKeyPairSync, sign } from "node:crypto"
import { concat, gzip, tar } from "./tar-fixture"

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
export const FIXTURE_KEY = { name: "fixture@example.org-1.rsa.pub", pem: publicKey.export({ type: "spki", format: "pem" }).toString() }
export const FIXTURE_REPO = "https://dl-cdn.alpinelinux.org/alpine/v3.21/main"

export interface FixturePackage {
  readonly name: string
  readonly version: string
  readonly depends?: readonly string[]
  readonly provides?: readonly string[]
  readonly files: Record<string, string>
}

const signed = (member: Uint8Array) =>
  concat(gzip(tar([{ name: `.SIGN.RSA.${FIXTURE_KEY.name}`, data: sign("sha1", member, privateKey) }], false)), member)

function buildPackage(item: FixturePackage) {
  const data = gzip(tar(Object.entries(item.files).map(([name, content]) => ({ name, data: content, mode: 0o755 }))))
  const datahash = createHash("sha256").update(data).digest("hex")
  const control = gzip(tar([{ name: ".PKGINFO", data: `pkgname = ${item.name}\npkgver = ${item.version}\ndatahash = ${datahash}\n` }], false))
  const bytes = concat(signed(control), data)
  const stanza = [
    `C:Q1${createHash("sha1").update(control).digest("base64")}`,
    `P:${item.name}`,
    `V:${item.version}`,
    "A:aarch64",
    `S:${bytes.length}`,
    `I:${Object.values(item.files).join("").length}`,
    "L:MIT",
    ...(item.depends?.length ? [`D:${item.depends.join(" ")}`] : []),
    ...(item.provides?.length ? [`p:${item.provides.join(" ")}`] : []),
  ].join("\n")
  return { bytes, stanza }
}

// Returns the files a fetch would see at each URL of the repository.
export function repository(packages: readonly FixturePackage[]): Map<string, Uint8Array> {
  const served = new Map<string, Uint8Array>()
  const stanzas = packages.map((item) => {
    const built = buildPackage(item)
    served.set(`${FIXTURE_REPO}/aarch64/${item.name}-${item.version}.apk`, built.bytes)
    return built.stanza
  })
  served.set(`${FIXTURE_REPO}/aarch64/APKINDEX.tar.gz`, signed(gzip(tar([{ name: "APKINDEX", data: `${stanzas.join("\n\n")}\n` }]))))
  return served
}
