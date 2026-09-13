/* SPDX-License-Identifier: MIT */
// Temporary diagnostic for #79 - deleted after the identity fields are
// captured on the CI runner. Run with: bun script/diag-identity.ts
import { lstatSync, mkdtempSync, unlinkSync, writeFileSync } from "node:fs"
import { open } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const pick = (st: ReturnType<typeof lstatSync> & { mtimeNs?: bigint; birthtimeNs?: bigint }) => ({
  dev: String(st.dev),
  ino: String(st.ino),
  ctimeNs: String(st.ctimeNs),
  mtimeNs: String((st as { mtimeNs?: bigint }).mtimeNs),
  birthtimeNs: String((st as { birthtimeNs?: bigint }).birthtimeNs),
  size: String(st.size),
})
const same = (
  a: { dev: bigint; ino: bigint; ctimeNs: bigint; mtimeNs?: bigint; birthtimeNs?: bigint; size: bigint },
  b: { dev: bigint; ino: bigint; ctimeNs: bigint; mtimeNs?: bigint; birthtimeNs?: bigint; size: bigint },
) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.ctimeNs === b.ctimeNs &&
  a.size === b.size &&
  (a as { mtimeNs?: bigint }).mtimeNs === (b as { mtimeNs?: bigint }).mtimeNs &&
  (a as { birthtimeNs?: bigint }).birthtimeNs === (b as { birthtimeNs?: bigint }).birthtimeNs

const dir = mkdtempSync(join(tmpdir(), "diag-identity-"))
const file = join(dir, "x.md")
writeFileSync(file, "a".repeat(200))
const before = lstatSync(file, { bigint: true })
const handle = await open(file, "r")
let unlinkError = ""
try {
  unlinkSync(file)
} catch (e) {
  unlinkError = String(e)
}
const recreated = unlinkError === ""
if (recreated) writeFileSync(file, "b".repeat(200))
const viaHandle = await handle.stat({ bigint: true })
const after = lstatSync(file, { bigint: true })
await handle.close()
console.log(
  JSON.stringify(
    {
      platform: process.platform,
      bun: process.versions.bun ?? "n/a",
      unlinkError,
      before: pick(before),
      viaHandle: pick(viaHandle),
      after: pick(after),
      sameBeforeAfter: same(before, after),
      sameHandleAfter: same(viaHandle, after),
    },
    null,
    1,
  ),
)