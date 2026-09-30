/* SPDX-License-Identifier: MIT */
import fs from "node:fs"

export function ensurePrivateDirectory(directory: string): void {
  try {
    fs.mkdirSync(directory, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
  }

  const metadata = fs.lstatSync(directory)
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`Unsafe local LLM runtime directory: ${directory}`)
  }

  if (process.platform === "win32") return

  const currentUser = process.getuid?.()
  if (currentUser !== undefined && metadata.uid !== currentUser) {
    throw new Error(`Local LLM runtime directory is owned by another user: ${directory}`)
  }

  if ((metadata.mode & 0o077) !== 0) fs.chmodSync(directory, 0o700)

  const secured = fs.lstatSync(directory)
  if (secured.isSymbolicLink() || !secured.isDirectory() || (secured.mode & 0o077) !== 0) {
    throw new Error(`Local LLM runtime directory is not private: ${directory}`)
  }
}
