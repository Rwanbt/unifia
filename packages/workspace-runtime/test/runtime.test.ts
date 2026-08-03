/* SPDX-License-Identifier: MIT */
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { WorkspaceRuntime } from "../src/index.js"

const root = await mkdtemp(path.join(os.tmpdir(), "unifia-workspace-"))
try {
  await mkdir(path.join(root, "src"))
  await writeFile(path.join(root, "src", "main.ts"), "export const value = 1\n")
  const runtime = new WorkspaceRuntime({ now: () => 1_000, maxReadBytes: 100, maxWriteBytes: 100 })
  const workspace = await runtime.register({ name: "fixture", path: root })
  const handle = await runtime.open(workspace.id)

  const initial = await runtime.read(handle.token, ["src/main.ts"])
  if (initial[0]?.size !== Buffer.byteLength("export const value = 1\n")) throw new Error("read result did not preserve file size")
  const written = await runtime.write(handle.token, [{ path: "src/main.ts", content: "export const value = 2\n" }])
  if (written[0]?.sha.length !== 64) throw new Error("transactional write did not return sha256")
  if ((await readFile(path.join(root, "src", "main.ts"), "utf8")) !== "export const value = 2\n") throw new Error("write was not committed")

  let escaped = false
  try { await runtime.read(handle.token, ["../outside.txt"]) } catch { escaped = true }
  if (!escaped) throw new Error("lexical escape was not denied")

  let missing = false
  try { await runtime.write(handle.token, [{ path: "new.txt", content: "no" }]) } catch { missing = true }
  if (!missing) throw new Error("silent file creation was not denied")

  await runtime.close(handle.token)
  let revoked = false
  try { await runtime.read(handle.token, ["src/main.ts"]) } catch { revoked = true }
  if (!revoked) throw new Error("closed file session remained usable")
  console.log("WorkspaceRuntime: 5/5 passed")
} finally {
  await rm(root, { recursive: true, force: true })
}