/* SPDX-License-Identifier: MIT */

import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

export async function withInstallScript<T>(
  script: string,
  run: (path: string) => Promise<T>,
  temporaryRoot = tmpdir(),
): Promise<T> {
  const directory = await mkdtemp(join(temporaryRoot, "unifia-install-"))
  try {
    const path = join(directory, "install.sh")
    await writeFile(path, script, { encoding: "utf8", flag: "wx", mode: 0o700 })
    return await run(path)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
