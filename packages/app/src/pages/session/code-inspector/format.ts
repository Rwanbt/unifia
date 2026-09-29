/* SPDX-License-Identifier: MIT */

// Pure formatting helpers of the Code inspector (ADR-049).

/** A file:// URI as a path relative to the workspace, when it is inside it. */
export function relativePath(uri: string, directory: string): string {
  const absolute = decodeURIComponent(new URL(uri).pathname).replace(/^\/([A-Za-z]:)/, "$1")
  const root = directory.replaceAll("\\", "/").replace(/\/+$/, "")
  const path = absolute.replaceAll("\\", "/")
  return path.toLowerCase().startsWith(root.toLowerCase() + "/") ? path.slice(root.length + 1) : path
}

/** Token counts as the reference writes them: 51.4k, 1.0M. */
export const compactTokens = (value: number) => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  return String(value)
}
