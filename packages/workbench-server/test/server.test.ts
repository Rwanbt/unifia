/* SPDX-License-Identifier: MIT */
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ApprovalBroker, AuditRuntimeDouble, BrowserAutomationBroker, CapabilityRegistry, DesktopAutomationBroker, McpUiControlBroker, FakeRuntimeAdapter } from "@unifia/contracts"
import { InMemoryMemoryStore, MemoryRuntime } from "@unifia/memory-runtime"
import { InMemoryWorkflowStore, WorkflowRuntime } from "@unifia/workflow-runtime"
import { WorkspaceRuntime } from "@unifia/workspace-runtime"
import { ApprovalCapabilityGate, WorkbenchServer } from "../src/index.js"

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
  const reconnectPrompt = await server.fetch(new Request(`http://localhost/v1/sessions/${session.id}/prompt`, { method: "POST", headers: { authorization: `Bearer ${handle.token}` }, body: JSON.stringify({ prompt: "reconnected" }) }))
  if (reconnectPrompt.status !== 202) throw new Error("second scoped prompt failed")
  const resumed = await server.fetch(new Request(`http://localhost/v1/sessions/${session.id}/events`, { headers: { authorization: `Bearer ${handle.token}`, "last-event-id": "1" } }))
  if (!resumed.body) throw new Error("resumed event stream missing body")
  const resumedReader = resumed.body.getReader()
  const resumedChunk = await Promise.race([resumedReader.read(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("resumed event timeout")), 5_000))])
  await resumedReader.cancel()
  if (resumedChunk.done || !new TextDecoder().decode(resumedChunk.value).includes("reconnected")) throw new Error("SSE cursor did not resume from sequence")
  if (audit.events().filter((event) => event.decision === "deny").length < 1) throw new Error("denied request was not audited")
  const pending = await new ApprovalCapabilityGate(new ApprovalBroker(() => 1_000)).check("workspace.write", handle.id, "actor")
  if (typeof pending !== "object" || pending.kind !== "approval_required") throw new Error("ApprovalCapabilityGate did not require approval")
  const approvalBroker = new ApprovalBroker(() => 1_000)
  const approvalServer = new WorkbenchServer({ workspace, runtime: new FakeRuntimeAdapter(() => 1_000), audit, capability: new ApprovalCapabilityGate(approvalBroker) })
  const approvalOpen = await approvalServer.fetch(new Request(`http://localhost/v1/workspaces/${handle.id}/open`, { method: "POST" }))
  const approvalHandle = await approvalOpen.json() as { id: string; token: string }
  const approvalRequestResponse = await approvalServer.fetch(new Request("http://localhost/v1/files/write", { method: "POST", headers: { authorization: `Bearer ${approvalHandle.token}` }, body: JSON.stringify({ workspaceId: approvalHandle.id, writes: [{ path: "README.md", content: "approved" }] }) }))
  const approvalRequest = await approvalRequestResponse.json() as { approvalId: string }
  if (approvalRequestResponse.status !== 202 || !approvalRequest.approvalId) throw new Error("server did not return approval_required")
  const resolved = await approvalServer.fetch(new Request(`http://localhost/v1/approvals/${approvalRequest.approvalId}`, { method: "POST", headers: { authorization: `Bearer ${approvalHandle.token}` }, body: JSON.stringify({ decision: "allow" }) }))
  if (resolved.status !== 200) throw new Error("scoped approval resolve failed")
  const retried = await approvalServer.fetch(new Request("http://localhost/v1/files/write", { method: "POST", headers: { authorization: `Bearer ${approvalHandle.token}` }, body: JSON.stringify({ workspaceId: approvalHandle.id, writes: [{ path: "README.md", content: "approved" }] }) }))
  if (retried.status !== 200) throw new Error("approved write was not retried")
  const browser = new BrowserAutomationBroker({ navigate: async () => {}, snapshot: async () => ({ title: "fixture" }), screenshot: async () => new Uint8Array([1, 2]), quarantineDownload: async () => "quarantine/result" }, ["example.com"])
  const browserServer = new WorkbenchServer({ workspace, runtime: new FakeRuntimeAdapter(() => 1_000), audit, capability: { check: async () => "allow" }, browser })
  const browserOpen = await browserServer.fetch(new Request(`http://localhost/v1/workspaces/${handle.id}/open`, { method: "POST" }))
  const browserHandle = await browserOpen.json() as { id: string; token: string }
  const browserNavigate = await browserServer.fetch(new Request("http://localhost/v1/browser/navigate", { method: "POST", headers: { authorization: `Bearer ${browserHandle.token}` }, body: JSON.stringify({ workspaceId: browserHandle.id, url: "https://example.com" }) }))
  if (browserNavigate.status !== 202) throw new Error("browser navigate route failed")
  const browserScreenshot = await browserServer.fetch(new Request("http://localhost/v1/browser/screenshot", { method: "POST", headers: { authorization: `Bearer ${browserHandle.token}` }, body: JSON.stringify({ workspaceId: browserHandle.id }) }))
  if (browserScreenshot.status !== 200) throw new Error("browser screenshot route failed")
  const capabilities = new CapabilityRegistry()
  const capabilityServer = new WorkbenchServer({ workspace, runtime: new FakeRuntimeAdapter(() => 1_000), audit, capability: { check: async () => "allow" }, capabilities })
  const capabilityOpen = await capabilityServer.fetch(new Request(`http://localhost/v1/workspaces/${handle.id}/open`, { method: "POST" }))
  const capabilityHandle = await capabilityOpen.json() as { id: string; token: string }
  const manifest = { descriptor: { id: "prompt-pack/test", name: "Test", description: "test", version: "1.0.0", author: "Unifia", license: "MIT", schema: {}, tags: ["test"], trustLevel: "verified" }, digest: "sha256:test", sourceRepo: "local", sourceCommit: "abc", license: "MIT", remoteCode: false }
  const capabilityRegister = await capabilityServer.fetch(new Request("http://localhost/v1/capabilities/register", { method: "POST", headers: { authorization: `Bearer ${capabilityHandle.token}` }, body: JSON.stringify({ workspaceId: capabilityHandle.id, manifest }) }))
  if (capabilityRegister.status !== 201) throw new Error("capability register route failed")
  await capabilityServer.fetch(new Request("http://localhost/v1/capabilities/approve", { method: "POST", headers: { authorization: `Bearer ${capabilityHandle.token}` }, body: JSON.stringify({ workspaceId: capabilityHandle.id, digest: "sha256:test" }) }))
  const capabilityEnable = await capabilityServer.fetch(new Request("http://localhost/v1/capabilities/enable", { method: "POST", headers: { authorization: `Bearer ${capabilityHandle.token}` }, body: JSON.stringify({ workspaceId: capabilityHandle.id, digest: "sha256:test" }) }))
  if (capabilityEnable.status !== 200) throw new Error("capability enable route failed")
  const capabilitySearch = await capabilityServer.fetch(new Request(`http://localhost/v1/capabilities/search?workspaceId=${capabilityHandle.id}&enabledOnly=true`, { headers: { authorization: `Bearer ${capabilityHandle.token}` } }))
  if (capabilitySearch.status !== 200) throw new Error("capability search route failed")
  const ui = new McpUiControlBroker({ inspect: async (componentId) => ({ componentId }), execute: async () => ({}) }, ["panel-main"], { request: () => ({ id: "ui-approval-1" }) })
  const uiServer = new WorkbenchServer({ workspace, runtime: new FakeRuntimeAdapter(() => 1_000), audit, capability: { check: async () => "allow" }, ui })
  const uiOpen = await uiServer.fetch(new Request(`http://localhost/v1/workspaces/${handle.id}/open`, { method: "POST" }))
  const uiHandle = await uiOpen.json() as { id: string; token: string }
  const uiAction = await uiServer.fetch(new Request("http://localhost/v1/ui/actions", { method: "POST", headers: { authorization: `Bearer ${uiHandle.token}` }, body: JSON.stringify({ workspaceId: uiHandle.id, action: { id: "inspect-main", componentId: "panel-main", kind: "inspect" } }) }))
  if (uiAction.status !== 200) throw new Error("MCP UI route failed")
  const memory = new MemoryRuntime(new InMemoryMemoryStore())
  const memoryServer = new WorkbenchServer({ workspace, runtime: new FakeRuntimeAdapter(() => 1_000), audit, capability: { check: async () => "allow" }, memory })
  const memoryOpen = await memoryServer.fetch(new Request(`http://localhost/v1/workspaces/${handle.id}/open`, { method: "POST" }))
  const memoryHandle = await memoryOpen.json() as { id: string; token: string }
  const remembered = await memoryServer.fetch(new Request("http://localhost/v1/memory/remember", { method: "POST", headers: { authorization: `Bearer ${memoryHandle.token}` }, body: JSON.stringify({ workspaceId: memoryHandle.id, content: "visible memory", source: "user" }) }))
  if (remembered.status !== 201) throw new Error("memory remember route failed")
  const foundMemory = await memoryServer.fetch(new Request(`http://localhost/v1/memory/search?workspaceId=${memoryHandle.id}&text=visible`, { headers: { authorization: `Bearer ${memoryHandle.token}` } }))
  if (foundMemory.status !== 200) throw new Error("memory search route failed")
  const workflow = new WorkflowRuntime(new InMemoryWorkflowStore(), { execute: async (step) => step.id }, { request: async () => true })
  const workflowServer = new WorkbenchServer({ workspace, runtime: new FakeRuntimeAdapter(() => 1_000), audit, capability: { check: async () => "allow" }, workflow })
  const workflowOpen = await workflowServer.fetch(new Request(`http://localhost/v1/workspaces/${handle.id}/open`, { method: "POST" }))
  const workflowHandle = await workflowOpen.json() as { id: string; token: string }
  const workflowStart = await workflowServer.fetch(new Request("http://localhost/v1/workflows/start", { method: "POST", headers: { authorization: `Bearer ${workflowHandle.token}` }, body: JSON.stringify({ workspaceId: workflowHandle.id, definition: { id: "wf-server", version: 1, workspaceId: workflowHandle.id, steps: [] } }) }))
  if (workflowStart.status !== 202) throw new Error("workflow start route failed")
  const workflowState = await workflowStart.json() as { state: { workflowId: string } }
  const workflowCancel = await workflowServer.fetch(new Request("http://localhost/v1/workflows/cancel", { method: "POST", headers: { authorization: `Bearer ${workflowHandle.token}` }, body: JSON.stringify({ workflowId: workflowState.state.workflowId }) }))
  if (workflowCancel.status !== 200) throw new Error("workflow cancel route failed")
  const desktop = new DesktopAutomationBroker({ observe: async () => ({ appId: "allowed-app", redacted: true }), control: async () => {} }, ["allowed-app"])
  const desktopServer = new WorkbenchServer({ workspace, runtime: new FakeRuntimeAdapter(() => 1_000), audit, capability: { check: async () => "allow" }, desktop })
  const desktopOpen = await desktopServer.fetch(new Request(`http://localhost/v1/workspaces/${handle.id}/open`, { method: "POST" }))
  const desktopHandle = await desktopOpen.json() as { id: string; token: string }
  const observed = await desktopServer.fetch(new Request("http://localhost/v1/desktop/observe", { method: "POST", headers: { authorization: `Bearer ${desktopHandle.token}` }, body: JSON.stringify({ workspaceId: desktopHandle.id, appId: "allowed-app" }) }))
  if (observed.status !== 200) throw new Error("desktop observe route failed")
  const controlled = await desktopServer.fetch(new Request("http://localhost/v1/desktop/control", { method: "POST", headers: { authorization: `Bearer ${desktopHandle.token}` }, body: JSON.stringify({ workspaceId: desktopHandle.id, appId: "allowed-app", action: "mouse", payload: { x: 1, y: 1 } }) }))
  if (controlled.status !== 202) throw new Error("desktop control route failed")
  console.log("WorkbenchServer: 29/29 passed")
} finally {
  await rm(root, { recursive: true, force: true })
}

