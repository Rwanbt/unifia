/* SPDX-License-Identifier: MIT */

import path from "node:path"

// Project discovery walks up for `.git` itself instead of asking git, so it
// has to honour git's own GIT_CEILING_DIRECTORIES (git-scm "Environment
// Variables"): the search never enters a ceiling directory or anything above
// it. Returns the last directory the walk may inspect -- the child of the
// nearest ceiling on the way up from `start` -- or undefined when no ceiling
// is an ancestor of `start`.

const normalize = (value: string, caseInsensitive: boolean) => {
  const resolved = path.resolve(value).replace(/[\\/]+$/, "")
  return caseInsensitive ? resolved.toLowerCase() : resolved
}

export function gitCeilingStop(
  start: string,
  ceilings: string | undefined,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (!ceilings) return undefined
  const caseInsensitive = platform === "win32" || platform === "darwin"
  const roots = ceilings
    .split(path.delimiter)
    .filter(Boolean)
    .map((ceiling) => normalize(ceiling, caseInsensitive))

  let current = path.resolve(start)
  while (true) {
    const parent = path.dirname(current)
    if (parent === current) return undefined
    if (roots.includes(normalize(parent, caseInsensitive))) return current
    current = parent
  }
}
