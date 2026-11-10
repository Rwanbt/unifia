import { realpathSync, statSync } from "node:fs"
import path from "node:path"

/**
 * Canonicalise a program path and refuse one another user could have planted.
 *
 * Only absolute paths are inspected. A bare name is returned untouched: the
 * operating system resolves it through PATH at exec time, and resolving it here
 * would swap the program on Windows, where `which`'s PATHEXT walk and
 * CreateProcess disagree about what `tool` means.
 *
 * An unusable target is also returned untouched, so the caller keeps seeing
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

  // WHY: a program in a directory anyone can write to can be replaced between
  // this check and the exec. A sticky directory (0o1000, e.g. /tmp) already
  // stops other users from replacing the entry, so it stays allowed. Windows has
  // no equivalent mode bits, so the hardening there reduces to canonicalisation.
  if (process.platform !== "win32") {
    const dir = path.dirname(real)
    const mode = statSync(dir).mode
    if ((mode & 0o002) !== 0 && (mode & 0o1000) === 0) {
      throw new Error(`Refusing to run a program from a world-writable directory: ${dir}`)
    }
  }

  return real
}

// WHY: a path that does not resolve is not an error here — the exec will report
// it with the code the caller already handles.
function canonical(file: string): string | undefined {
  try {
    return realpathSync(file)
  } catch {
    return undefined
  }
}
