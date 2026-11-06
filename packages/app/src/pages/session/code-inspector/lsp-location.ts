/* SPDX-License-Identifier: MIT */

// Pure helper of the Symbols tab (#679), kept free of app contexts so
// test:ci can load it without the router.

import { canonical } from "@/context/file/canonical"

export type LspLocation = { uri: string; range: { start: { line: number; character: number } } }

/** A location as the panel opens it: project-relative path and one-based line. */
export function locationTarget(location: LspLocation, root: string): { path: string; line: number } {
  return { path: canonical(location.uri, root), line: location.range.start.line + 1 }
}
