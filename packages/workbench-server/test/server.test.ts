/* SPDX-License-Identifier: MIT */
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { AuditRuntimeDouble, FakeRuntimeAdapter } from "@unifia/contracts"
import { WorkspaceRuntime } from "@unifia/workspace-runtime"
import { WorkbenchServer } from "../src/index.js"

const root = await mkdtemp(path.join(os.tmpdir(), "unifia-server-"))
try {
  await writeFile(path.join(root, "README.md"), "hello")
  const workspace = new WorkspaceRuntime()
  const audit = new AuditRuntimeDouble(() => 1_000)
  let capabilityDecision: "allow" | "deny" = "allow"
  const server = new WorkbenchServer({ workspace, runtime: new FakeRuntimeAdapter(() => 1_000), audit, capability: { check: async () => capabilityDecision } })
  const registered = await server.fetch(new Request("http://localhost/v1/workspaces/register", { method: "POST", body: JSON.stringify({ name: "fixture", path: root }) }))
  if (registered.status !== 201) throw new Error("workspace register route failed")
  const registeredBody = await registered.json() as { id: string }
  const opened = await server.fetch(new Request(`http://localhost/v1/workspaces/${registeredBody.id}/open`, { method: "POST" }))
  const handle = await opened.json() as { id: string; token: string }
  const denied = await server.fetch(new Request(`http://localhost/v1/workspaces/${handle.id}/sessions`))
  if (denied.status !== 403) throw new Error("unscoped session request was accepted")
  const listed = await server.fetch(new Request(`http://localhost/v1/workspaces/${handle.id}/sessions`, { headers: { authorization: `Bearer ${handle.token}` } }))
  if (listed.status !== 200) throw new Error("scoped session list failed")
  const read = await server.fetch(new Request("http://localhost/v1/files/read", { method: "POST", headers: { authorization: `Bearer ${handle.token}` }, body: JSON.stringify({ workspaceId: handle.id, paths: ["README.md"] }) }))
  if (read.status !== 200) throw new Error("scoped file read failed")
  capabilityDecision = "deny"
  const deniedWrite = await server.fetch(new Request("http://localhost/v1/files/write", { method: "POST", headers: { authorization: `Bearer ${handle.token}` }, body: JSON.stringify({ workspaceId: handle.id, writes: [{ path: "README.md", content: "blocked" }] }) }))
  if (deniedWrite.status !== 403) throw new Error("capability gate did not deny write")
  capabilityDecision = "allow"
  const created = await server.fetch(new Request(`http://localhost/v1/workspaces/${handle.id}/sessions`, { method: "POST", headers: { authorization: `Bearer ${handle.token}` } }))
  const session = (await created.json() as { session: { id: string } }).session
  const events = await server.fetch(new Request(`http://localhost/v1/sessions/${session.id}/events`, { headers: { authorization: `Bearer ${handle.token}` } }))
  if (events.status !== 200 || !events.body) throw new Error("scoped event stream failed")
  const reader = events.body.getReader()
  const pendingEvent = reader.read()
  const prompt = await server.fetch(new Request(`http://localhost/v1/sessions/${session.id}/prompt`, { method: "POST", headers: { authorization: `Bearer ${handle.token}` }, body: JSON.stringify({ prompt: "hello" }) }))
  const eventChunk = await Promise.race([pendingEvent, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("event stream timeout")), 5_000))])
  await reader.cancel()
  if (eventChunk.done || !new TextDecoder().decode(eventChunk.value).includes("hello")) throw new Error("runtime event was not streamed")
  if (prompt.status !== 202) throw new Error("scoped prompt failed")
  if (audit.events().filter((event) => event.decision === "deny").length < 1) throw new Error("denied request was not audited")
  console.log("WorkbenchServer: 10/10 passed")
} finally {
  await rm(root, { recursive: true, force: true })
}