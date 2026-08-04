/* SPDX-License-Identifier: MIT */
import { createHash } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ApprovalBroker, AuditRuntimeDouble, BrowserAutomationBroker, CapabilityRegistry, DesktopAutomationBroker, McpUiControlBroker, FakeRuntimeAdapter } from "@unifia/contracts"
import { InMemoryMemoryStore, MemoryRuntime } from "@unifia/memory-runtime"
import { InMemoryWorkflowStore, WorkflowRuntime } from "@unifia/workflow-runtime"
import { WorkspaceRuntime } from "@unifia/workspace-runtime"
import { InMemorySkillRegistry, type InstalledSkill, type SkillManifest, type SkillPackage, type SkillRegistry, type SkillTrust } from "@unifia/skill-hub"
import { ApprovalCapabilityGate, WorkbenchServer } from "../src/index.js"
const skillArtifact = (name: string) => new TextEncoder().encode(name)
const skillDigest = (name: string) => createHash("sha256").update(skillArtifact(name)).digest("hex")
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
  const capabilities = new CapabilityRegistry({ verify: () => true })
  const capabilityServer = new WorkbenchServer({ workspace, runtime: new FakeRuntimeAdapter(() => 1_000), audit, capability: { check: async () => "allow" }, capabilities })
  const capabilityOpen = await capabilityServer.fetch(new Request(`http://localhost/v1/workspaces/${handle.id}/open`, { method: "POST" }))
  const capabilityHandle = await capabilityOpen.json() as { id: string; token: string }
  const manifest = { descriptor: { id: "prompt-pack/test", name: "Test", description: "test", version: "1.0.0", author: "Unifia", license: "MIT", schema: {}, tags: ["test"], trustLevel: "verified" }, digest: "sha256:test", sourceRepo: "local", sourceCommit: "abc", license: "MIT", remoteCode: false, signature: "valid" }
  const capabilityRegister = await capabilityServer.fetch(new Request("http://localhost/v1/capabilities/register", { method: "POST", headers: { authorization: `Bearer ${capabilityHandle.token}` }, body: JSON.stringify({ workspaceId: capabilityHandle.id, manifest }) }))
  if (capabilityRegister.status !== 201) throw new Error("capability register route failed")
  await capabilityServer.fetch(new Request("http://localhost/v1/capabilities/approve", { method: "POST", headers: { authorization: `Bearer ${capabilityHandle.token}` }, body: JSON.stringify({ workspaceId: capabilityHandle.id, digest: "sha256:test" }) }))
  const capabilityEnable = await capabilityServer.fetch(new Request("http://localhost/v1/capabilities/enable", { method: "POST", headers: { authorization: `Bearer ${capabilityHandle.token}` }, body: JSON.stringify({ workspaceId: capabilityHandle.id, digest: "sha256:test" }) }))
  if (capabilityEnable.status !== 200) throw new Error("capability enable route failed")
  const capabilitySearch = await capabilityServer.fetch(new Request(`http://localhost/v1/capabilities/search?workspaceId=${capabilityHandle.id}&enabledOnly=true`, { headers: { authorization: `Bearer ${capabilityHandle.token}` } }))
  if (capabilitySearch.status !== 200) throw new Error("capability search route failed")
  const ui = new McpUiControlBroker({ inspect: async (componentId) => ({ componentId }), execute: async () => ({}) }, ["panel-main"], { request: () => ({ id: "ui-approval-1" }) })
  const uiServer = new WorkbenchServer({ workspace, runtime: new FakeRuntimeAdapter(() => 1_000), audit, capability: { check: async () => "allow" }, ui, uiAllowedActions: new Set(["ui.inspect"]) })
  const uiOpen = await uiServer.fetch(new Request(`http://localhost/v1/workspaces/${handle.id}/open`, { method: "POST" }))
  const uiHandle = await uiOpen.json() as { id: string; token: string }
  const uiAction = await uiServer.fetch(new Request("http://localhost/v1/ui/actions", { method: "POST", headers: { authorization: `Bearer ${uiHandle.token}` }, body: JSON.stringify({ workspaceId: uiHandle.id, action: { id: "inspect-main", componentId: "panel-main", kind: "inspect" } }) }))
  if (uiAction.status !== 200) throw new Error("MCP UI route failed")
  const renderedUi = await uiServer.fetch(new Request("http://localhost/v1/ui/render", { method: "POST", headers: { authorization: `Bearer ${uiHandle.token}` }, body: JSON.stringify({ workspaceId: uiHandle.id, node: { type: "button", id: "run", props: { label: "Run", actionId: "ui.inspect", onclick: "evil()" } } }) }))
  if (renderedUi.status !== 200) throw new Error("Generative UI render route failed")
  const renderedBody = await renderedUi.json() as { rendered: { props: Record<string, string> } }
  if (renderedBody.rendered.props.onclick !== undefined || renderedBody.rendered.props.actionId !== "ui.inspect") throw new Error("Generative UI renderer did not filter props")
  const blockedUi = await uiServer.fetch(new Request("http://localhost/v1/ui/render", { method: "POST", headers: { authorization: `Bearer ${uiHandle.token}` }, body: JSON.stringify({ workspaceId: uiHandle.id, node: { type: "button", id: "blocked", props: { actionId: "ui.shutdown" } } }) }))
  if (blockedUi.status !== 400) throw new Error("Generative UI renderer accepted an unallowlisted action")
  const missingUi = new WorkbenchServer({ workspace, runtime: new FakeRuntimeAdapter(() => 1_000), audit, capability: { check: async () => "allow" } })
  const missingUiOpen = await missingUi.fetch(new Request(`http://localhost/v1/workspaces/${handle.id}/open`, { method: "POST" }))
  const missingUiHandle = await missingUiOpen.json() as { id: string; token: string }
  const unavailableUi = await missingUi.fetch(new Request("http://localhost/v1/ui/render", { method: "POST", headers: { authorization: `Bearer ${missingUiHandle.token}` }, body: JSON.stringify({ workspaceId: missingUiHandle.id, node: { type: "text", id: "x", props: { value: "x" } } }) }))
  if (unavailableUi.status !== 503) throw new Error("Generative UI route did not fail closed when unavailable")
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
  const seededRegistry = new InMemorySkillRegistry(() => 1_000)
  await seededRegistry.publish({ manifest: { name: "demo-skill", version: "1.0.0", digest: skillDigest("demo-skill"), trust: "untrusted" as SkillTrust, tags: ["demo"], capabilities: ["workflow.run"] }, artifact: skillArtifact("demo-skill") })
  await seededRegistry.publish({ manifest: { name: "audit-skill", version: "1.0.0", digest: skillDigest("audit-skill"), trust: "untrusted" as SkillTrust, tags: ["audit"], capabilities: ["workspace.read"] }, artifact: skillArtifact("audit-skill") })
  type CallLog = Record<"publish" | "search" | "install" | "update" | "rate" | "exec" | "load" | "run", number>
  const makeRecorder = (registry: SkillRegistry): { registry: SkillRegistry; log: CallLog; throwIfExec: () => void } => {
    const log = { publish: 0, search: 0, install: 0, update: 0, rate: 0, exec: 0, load: 0, run: 0 } as CallLog
    const throwIfExec = () => { if (log.exec > 0 || log.load > 0 || log.run > 0) throw new Error("skill content was executed") }
    const record = { registry: {
      publish: async (pkg: SkillPackage) => { log.publish += 1; return registry.publish(pkg) },
      search: async (input: Parameters<SkillRegistry["search"]>[0]) => { log.search += 1; return registry.search(input) },
      install: async (digest: string) => { log.install += 1; return registry.install(digest) },
      update: async (name: string) => { log.update += 1; return registry.update(name) },
      rate: async (digest: string, rating: number) => { log.rate += 1; return registry.rate(digest, rating) },
    } as SkillRegistry, log, throwIfExec }
    const guarded = record.registry as SkillRegistry & { execute?: () => never; load?: () => never; run?: () => never }
    guarded.execute = () => { log.exec += 1; throw new Error("execute must never be called") }
    guarded.load = () => { log.load += 1; throw new Error("load must never be called") }
    guarded.run = () => { log.run += 1; throw new Error("run must never be called") }
    return record
  }
  const seeded = makeRecorder(seededRegistry)
  const skillHubAudit = new AuditRuntimeDouble(() => 1_000)
  const skillHubServer = new WorkbenchServer({ workspace, runtime: new FakeRuntimeAdapter(() => 1_000), audit: skillHubAudit, capability: { check: async () => "allow" }, skillHub: seeded.registry })
  const skillHubOpen = await skillHubServer.fetch(new Request(`http://localhost/v1/workspaces/${handle.id}/open`, { method: "POST" }))
  const skillHubHandle = await skillHubOpen.json() as { id: string; token: string }
  const deniedSearchScope = await skillHubServer.fetch(new Request("http://localhost/v1/skill-hub/search", { method: "POST", headers: { authorization: "Bearer not-a-real-token" }, body: JSON.stringify({ workspaceId: skillHubHandle.id, query: "x" }) }))
  if (deniedSearchScope.status !== 403) throw new Error("skill-hub search with bad token was not denied (expected 403)")
  const deniedInstallScope = await skillHubServer.fetch(new Request("http://localhost/v1/skill-hub/install", { method: "POST", headers: { authorization: `Bearer ${skillHubHandle.token}` }, body: JSON.stringify({ workspaceId: "other-workspace", digest: "a".repeat(64) }) }))
  if (deniedInstallScope.status !== 403) throw new Error("skill-hub install with cross-workspace id was not denied")
  const deniedUpdateScope = await skillHubServer.fetch(new Request("http://localhost/v1/skill-hub/update", { method: "POST", headers: { authorization: `Bearer ${skillHubHandle.token}` }, body: JSON.stringify({ name: "demo-skill" }) }))
  if (deniedUpdateScope.status !== 400) throw new Error("skill-hub update without workspaceId was not 400")
  const missingRegistryServer = new WorkbenchServer({ workspace, runtime: new FakeRuntimeAdapter(() => 1_000), audit: skillHubAudit, capability: { check: async () => "allow" } })
  const missingRegistryOpen = await missingRegistryServer.fetch(new Request(`http://localhost/v1/workspaces/${handle.id}/open`, { method: "POST" }))
  const missingRegistryHandle = await missingRegistryOpen.json() as { id: string; token: string }
  const unavailableSearch = await missingRegistryServer.fetch(new Request("http://localhost/v1/skill-hub/search", { method: "POST", headers: { authorization: `Bearer ${missingRegistryHandle.token}` }, body: JSON.stringify({ workspaceId: missingRegistryHandle.id, query: "x" }) }))
  if (unavailableSearch.status !== 503) throw new Error("skill-hub search without registry was not 503")
  const unavailableInstall = await missingRegistryServer.fetch(new Request("http://localhost/v1/skill-hub/install", { method: "POST", headers: { authorization: `Bearer ${missingRegistryHandle.token}` }, body: JSON.stringify({ workspaceId: missingRegistryHandle.id, digest: "0".repeat(64) }) }))
  if (unavailableInstall.status !== 503) throw new Error("skill-hub install without registry was not 503")
  const unavailableUpdate = await missingRegistryServer.fetch(new Request("http://localhost/v1/skill-hub/update", { method: "POST", headers: { authorization: `Bearer ${missingRegistryHandle.token}` }, body: JSON.stringify({ workspaceId: missingRegistryHandle.id, name: "demo-skill" }) }))
  if (unavailableUpdate.status !== 503) throw new Error("skill-hub update without registry was not 503")
  const searchAuditBaseline = skillHubAudit.events().length
  const searchResponse = await skillHubServer.fetch(new Request("http://localhost/v1/skill-hub/search", { method: "POST", headers: { authorization: `Bearer ${skillHubHandle.token}` }, body: JSON.stringify({ workspaceId: skillHubHandle.id, query: "workflow", tags: ["demo"] }) }))
  if (searchResponse.status !== 200) throw new Error("skill-hub search route failed")
  const searchBody = await searchResponse.json() as { manifests: readonly SkillManifest[] }
  if (searchBody.manifests.length !== 1 || searchBody.manifests[0].name !== "demo-skill") throw new Error("skill-hub search did not filter correctly")
  if ((seeded.log.search as number) !== 1) throw new Error("skill-hub search did not call registry.search once")
  seeded.throwIfExec()
  const installResponse = await skillHubServer.fetch(new Request("http://localhost/v1/skill-hub/install", { method: "POST", headers: { authorization: `Bearer ${skillHubHandle.token}` }, body: JSON.stringify({ workspaceId: skillHubHandle.id, digest: skillDigest("demo-skill"), allowlist: ["ui.click", "ui.inspect"], uiActions: ["approve"] }) }))
  if (installResponse.status !== 201) throw new Error("skill-hub install route failed")
  const installBody = await installResponse.json() as { installed: InstalledSkill }
  if (installBody.installed.manifest.digest !== skillDigest("demo-skill")) throw new Error("skill-hub install did not return the installed manifest")
  if ((seeded.log.install as number) !== 1) throw new Error("skill-hub install did not call registry.install once")
  if ((seeded.log.update as number) !== 0) throw new Error("skill-hub install must not trigger registry.update")
  if (((installBody.installed.manifest as unknown) as { allowlist?: unknown }).allowlist !== undefined) throw new Error("install manifest was mutated by payload allowlist")
  seeded.throwIfExec()
  const updateResponse = await skillHubServer.fetch(new Request("http://localhost/v1/skill-hub/update", { method: "POST", headers: { authorization: `Bearer ${skillHubHandle.token}` }, body: JSON.stringify({ workspaceId: skillHubHandle.id, name: "demo-skill", uiActions: ["shutdown"] }) }))
  if (updateResponse.status !== 200) throw new Error("skill-hub update route failed")
  const updateBody = await updateResponse.json() as { updated: InstalledSkill | null }
  if (updateBody.updated?.manifest.name !== "demo-skill") throw new Error("skill-hub update did not return the installed skill")
  if ((seeded.log.update as number) !== 1) throw new Error("skill-hub update did not call registry.update once")
  if ((seeded.log.search as number) === 0) throw new Error("skill-hub update did not call registry.search to resolve latest version")
  seeded.throwIfExec()
  const successCalls = skillHubAudit.events().slice(searchAuditBaseline).filter((event) => event.capability.startsWith("skill-hub."))
  if (successCalls.length < 3) throw new Error("skill-hub success routes were not audited as allow")
  if (successCalls.some((event) => event.decision !== "allow")) throw new Error("skill-hub success routes produced a non-allow audit decision")
  console.log("WorkbenchServer: 49/49 passed")
} finally {
  await rm(root, { recursive: true, force: true })
}

