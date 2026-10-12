import type { Context } from "hono"
import { Filesystem } from "@/util/filesystem"

/**
 * The project directory a request names: the `directory` query parameter, else the `x-unifia-directory` header, resolved as
 * the router resolves it. Undefined when the request names none, in which case the router serves the server's own directory.
 */
export function requestedDirectory(c: Context): string | undefined {
  const raw = c.req.query("directory") || c.req.header("x-unifia-directory")
  if (!raw) return undefined
  return Filesystem.resolve(
    (() => {
      try {
        return decodeURIComponent(raw)
      } catch {
        return raw
      }
    })(),
  )
}

/** The server's own project directory: the one a request gets when it names no directory. */
export function ownDirectory(): string {
  return Filesystem.resolve(process.cwd())
}
