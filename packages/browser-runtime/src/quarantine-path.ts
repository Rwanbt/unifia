/* SPDX-License-Identifier: MIT */
import { createHash } from "node:crypto"
import { isAbsolute, relative, resolve, sep } from "node:path"

export function browserQuarantineTarget(rootDirectory: string, workspaceId: string, filename: string) {
  if (!workspaceId.trim()) throw new Error("workspace id is required")
  if (!filename || filename === "." || filename === ".." || /[\\/:\0]/.test(filename)) {
    throw new Error("unsafe download filename")
  }

  const root = resolve(rootDirectory)
  const workspaceDirectory = createHash("sha256").update(workspaceId).digest("hex")
  const directory = resolve(root, workspaceDirectory, "downloads")
  const target = resolve(directory, filename)
  if (!isPathWithin(root, directory) || !isPathWithin(directory, target)) {
    throw new Error("download path escaped quarantine")
  }
  return { directory, target }
}

function isPathWithin(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target)
  return pathFromRoot !== "" && pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot)
}
