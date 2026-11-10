import { realpathSync, statSync } from "node:fs"
import path from "node:path"

/**
 * Canonicalise a program path and refuse one that is not a regular file.
 *
 * This is the value handed to an exec, so the point is to stop trusting the
 * ambient string: `realpath` resolves every `..` and every symlink hop, which is
 * what "depends on an uncontrolled absolute path" actually means here.
 *
 * Only absolute paths are inspected. A bare name is returned untouched: the
 * operating system resolves it through PATH at exec time, and resolving it here
 * would swap the program on Windows, where `which`'s PATHEXT walk and
 * CreateProcess disagree about what `tool` means.
 *
 * An unreadable target is also returned untouched, so the caller keeps seeing
 * ENOENT or EACCES from `spawn` instead of a synchronous throw that would change
 * every caller's error handling.
 */
export function trusted(file: string): string {
  if (!file) throw new Error("Program is required")
  if (file.includes("\0")) throw new Error("Program path cannot contain a null byte")
  if (!path.isAbsolute(file)) return file

  const real = canonical(file)
  if (!real) return file
  if (!statSync(real).isFile()) throw new Error(`Not a regular file: ${real}`)
  return real
}

// WHY: a path that does not resolve is not an error here — the exec will report
// it with the code the caller already handles.
//
// A "refuse a world-writable directory" rule was tried here and withdrawn: on
// GitHub runners the toolchain lives under /opt/hostedtoolcache, which is
// world-writable, so the rule rejected `node` itself. Deciding that an
// environment is untrusted is not this function's call.
function canonical(file: string): string | undefined {
  try {
    return realpathSync(file)
  } catch {
    return undefined
  }
}
