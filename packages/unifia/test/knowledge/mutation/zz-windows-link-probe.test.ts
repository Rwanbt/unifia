/* SPDX-License-Identifier: MIT */
// TEMPORARY diagnostic for the Windows CI failures of the link tests. Always passes; prints facts. To be removed.
import { test } from "bun:test"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, realpathSync, readFileSync, rmSync, symlinkSync, writeFileSync, closeSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { realOrNull, isContained } from "../../../src/knowledge/source/containment.js"
import { assertVaultRootInside } from "../../../src/knowledge/app/project-boundary.js"
import { readNoFollow } from "../../../src/knowledge/mutation/durability.js"

const say = (...a: unknown[]) => console.log("PROBE", ...a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))))

test("windows link probe", () => {
  const base = mkdtempSync(join(tmpdir(), "probe-"))
  const vault = join(base, "project", ".unifia", "memory")
  const outside = join(base, "outside")
  mkdirSync(vault, { recursive: true })
  mkdirSync(outside, { recursive: true })
  say("platform", process.platform, "vault", vault, "outside", outside)

  // Case A: a WAL that is a link to an existing file outside the vault.
  const target = join(outside, "wal-target.txt")
  writeFileSync(target, "keep\n")
  const wal = join(vault, ".unifia", "wal.jsonl")
  mkdirSync(join(vault, ".unifia"), { recursive: true })
  try {
    symlinkSync(target, wal)
    say("A symlink created", { isLink: lstatSync(wal).isSymbolicLink() })
  } catch (e) {
    say("A symlink FAILED", String(e))
  }
  say("A realOrNull(link)", realOrNull(wal) ?? null, "realpath(target)", realpathSync.native(target))
  say("A isContained(vault, link)", isContained(vault, wal))
  try {
    assertVaultRootInside(vault, wal)
    say("A assertVaultRootInside: NO THROW (containment passed)")
  } catch (e) {
    say("A assertVaultRootInside: threw", (e as Error).name, (e as Error).message)
  }
  const read = readNoFollow(wal)
  say("A readNoFollow kind", read.kind)

  // Case B: a dangling temporary planted at the create path.
  const notes = join(vault, "notes")
  mkdirSync(notes, { recursive: true })
  const dangTarget = join(outside, "target.md")
  const planted = join(notes, "new.md.unifia-tmp")
  try {
    symlinkSync(dangTarget, planted)
    say("B symlink created", { isLink: lstatSync(planted).isSymbolicLink() })
  } catch (e) {
    say("B symlink FAILED", String(e))
  }
  try {
    const fd = openSync(planted, "wx")
    closeSync(fd)
    say("B openSync wx: SUCCEEDED (no error)", { targetExistsNow: existsSync(dangTarget) })
  } catch (e) {
    say("B openSync wx: refused", (e as NodeJS.ErrnoException).code, { targetExistsNow: existsSync(dangTarget) })
  }
  rmSync(base, { recursive: true, force: true })
})
