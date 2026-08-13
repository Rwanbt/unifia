/* SPDX-License-Identifier: MIT */
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { WorkspaceRuntime } from "../src/index.js"

const root = await mkdtemp(path.join(os.tmpdir(), "unifia-workspace-"))
try {
  await mkdir(path.join(root, "src"))
  await writeFile(path.join(root, "src", "main.ts"), "export const value = 1\n")
  await writeFile(path.join(root, "README.md"), "# Fixture\n")
  const runtime = new WorkspaceRuntime({ now: () => 1_000, maxReadBytes: 100, maxWriteBytes: 100 })
  const workspace = await runtime.register({ name: "fixture", path: root })
  const handle = await runtime.open(workspace.id)

  const initial = await runtime.read(handle.token, ["src/main.ts"])
  if (initial[0]?.size !== Buffer.byteLength("export const value = 1\n")) throw new Error("read result did not preserve file size")
  const written = await runtime.write(handle.token, [{ path: "src/main.ts", content: "export const value = 2\n" }])
  if (written[0]?.sha.length !== 64) throw new Error("transactional write did not return sha256")
  if ((await readFile(path.join(root, "src", "main.ts"), "utf8")) !== "export const value = 2\n") throw new Error("write was not committed")
  const entries = await runtime.list(handle.token)
  if (!entries.some((entry) => entry.path === "src" && entry.kind === "directory")) throw new Error("list did not include the source directory")
  if (!entries.some((entry) => entry.path === "README.md" && entry.kind === "file")) throw new Error("list did not include the root file")
  const matches = await runtime.search(handle.token, "MAIN.TS")
  if (matches.length !== 1 || matches[0]?.path !== "src/main.ts") throw new Error("search was not case-insensitive")
  const recorded = await runtime.appendFileEvent(workspace.id, { type: "modified", path: "src/main.ts", timestamp: 1_001 })
  const replayed = await runtime.replayFileEvents(workspace.id, 0)
  if (recorded.sequence !== 1 || replayed[0]?.sequence !== 1) throw new Error("file event was not persisted with a cursor")
  await runtime.acknowledgeFileEvent(workspace.id, recorded.sequence ?? 0)
  if ((await runtime.replayFileEvents(workspace.id)).length !== 0) throw new Error("file event ack did not advance the outbox")
  const eventStream = runtime.watch(handle.token)[Symbol.asyncIterator]()
  await runtime.write(handle.token, [{ path: "src/main.ts", content: "export const value = 3\n" }])
  const observed = await Promise.race([eventStream.next(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("watcher timeout")), 5_000))])
  if (observed.done || observed.value.sequence === undefined) throw new Error("watcher did not emit a sequenced event")
  await eventStream.return?.()

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
  console.log("WorkspaceRuntime: 12/12 passed")
} finally {
  await rm(root, { recursive: true, force: true })
}
