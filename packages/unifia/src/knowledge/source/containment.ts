/* SPDX-License-Identifier: MIT */
/**
 * Workspace containment, decided on resolved real paths.
 *
 * One definition, shared by every component that touches the filesystem.
 * Reading and writing must agree on where the boundary is: a second copy of
 * this logic is how a reader and a writer end up disagreeing about what is
 * inside the vault.
 */

import { realpathSync } from "node:fs"
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from "node:path"

/**
 * Strip the Win32 namespaced prefix (`\\?\` / `\\?\UNC\`) that
 * GetFinalPathNameByHandle returns on some Windows hosts (long-path
 * enabled runners included). Without this, a prefixed `realRoot` never
 * lexically matches an unprefixed `join(root, locator)` candidate and
 * every write is refused as "escapes the vault root" - the systemic
 * CI failure tracked in #79. Volume-GUID forms are left untouched.
 */
export function stripWindowsNamespace(p: string): string {
  if (p.startsWith("\\\\?\\UNC\\")) return "\\\\" + p.slice(8)
  if (/^\\\\\?\\[A-Za-z]:\\/.test(p)) return p.slice(4)
  return p
}

/** Real path of `p`, or null when it cannot be resolved. */
export function realOrNull(p: string): string | null {
  try {
    return stripWindowsNamespace(realpathSync.native(p))
  } catch {
    return null
  }
}

/**
 * Compose a Unicode string to NFC.
 *
 * On HFS+/APFS the filesystem normalises to NFD; on NTFS and most Linux
 * file systems bytes are stored verbatim. A wikilink written in NFC
 * therefore has to find a file that may be on disk in NFD (or vice
 * versa). Normalising both sides to NFC removes the form as a variable.
 */
export function toNfc(s: string): string {
  return s.normalize("NFC")
}

/** Decompose a Unicode string to NFD — the form macOS HFS+ uses on disk. */
export function toNfd(s: string): string {
  return s.normalize("NFD")
}

/*
 * There is deliberately no async counterpart.
 *
 * `fs/promises` exposes no `realpath.native`, and plain `realpath` normalises
 * Windows casing differently — so an async variant would be a *second*
 * containment semantics, and reader and writer could disagree about whether
 * a path is inside the vault. Resolving one path is a metadata lookup, not a
 * long read; the operations that actually block a scan are `readdir`, `stat`
 * and `readFile`, and those are the ones the read path awaits.
 */

/**
 * True when `candidate` resolves inside `realRoot`.
 *
 * Compares real paths, not lexical ones: `statSync` follows junctions and
 * symlinks, so a lexical check lets a link pointing outside the workspace
 * through untouched.
 */
export function isContained(realRoot: string, candidate: string): boolean {
  // Canonicalise the root through the same resolver as the candidate: on
  // the CI runner GetFinalPathNameByHandle returns the Volume-GUID form
  // (\\?\Volume{...}) for paths under the temp volume, so a raw
  // drive-letter root and a volume-form candidate share no textual prefix
  // even though they denote the same directory. Resolving both sides makes
  // the comparison form-independent.
  const root = realOrNull(realRoot) ?? stripWindowsNamespace(realRoot)
  const real = realOrNull(candidate)
  if (real === null) return false
  if (real === root) return true
  const rel = relative(root, real)
  return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel)
}

/**
 * True when `candidate` would resolve inside `realRoot` once created.
 *
 * A path that does not exist yet has no real path, so containment is decided
 * on its nearest existing ancestor. Without this a writer could not create a
 * file at all, and checking only the lexical path would let it create one
 * through a link that escapes the workspace.
 */
export function wouldBeContained(realRoot: string, candidate: string): boolean {
  const root = realOrNull(realRoot) ?? stripWindowsNamespace(realRoot)
  // An existing path is decided directly.
  if (realOrNull(candidate) !== null) return isContained(root, candidate)

  // The nearest existing ancestor decides: it is the only segment a
  // junction/symlink could redirect, and comparing real paths handles the
  // junctioned roots the CI runner uses (D:\a\_temp) as well as namespace
  // prefixes. There is deliberately NO lexical pre-check on the raw
  // candidate: on a junctioned root the kernel path and the real path
  // legitimately share no textual prefix, and rejecting on that difference
  // refused every write (#79). resolve() still normalises any '.', '..' and
  // separator noise before the walk, so a candidate that climbs out with
  // '..' resolves to a real ancestor outside the root and is refused there.
  let dir = dirname(resolve(candidate))
  for (;;) {
    const real = realOrNull(dir)
    if (real !== null) return isContained(root, real)
    const parent = dirname(dir)
    if (parent === dir) return false
    dir = parent
  }
}

/**
 * Whether a locator names the vault's own folder, `.unifia`, anywhere in its path. The name is compared as the platforms that
 * fold it compare it: without case, without the trailing dots and spaces Windows ignores, and by the 8.3 short name Windows
 * gives the folder (`UNIFIA~1`). Applied to a real place, it judges an alias of the folder by where the alias leads.
 */
export function isInternalLocator(locator: string): boolean {
  return normalize(locator)
    .split(/[\\/]/)
    .some((part) => {
      const folded = part.replace(/[. ]+$/, "").toLowerCase()
      return folded === ".unifia" || /^unifia~\d+$/.test(folded)
    })
}

/**
 * The real place a path would be written to: the real path of its nearest existing part, with the parts that do not exist yet
 * appended. A link in the path is followed, so an alias of the vault's own folder is judged where it really leads. Null when no
 * part of the path resolves.
 */
export function realPlaceOf(candidate: string): string | null {
  const rest: string[] = []
  let dir = resolve(candidate)
  for (;;) {
    const real = realOrNull(dir)
    if (real !== null) return rest.length === 0 ? real : join(real, ...rest)
    const parent = dirname(dir)
    if (parent === dir) return null
    rest.unshift(basename(dir))
    dir = parent
  }
}
