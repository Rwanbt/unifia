/* SPDX-License-Identifier: MIT */
/**
 * #571 (PW07) — the desktop surface is composed by the host, and its refusal
 * contract is what keeps Computer Use safe until a driver is reachable.
 *
 * Pinned here:
 *  - the route reaches an injected broker (dependency graph and
 *    createWorkbenchApp pass-through);
 *  - a broker refusal (app outside the allowlist, engaged emergency stop,
 *    engaged kill switch) is a 403 policy denial with ZERO effects — the
 *    driver is never called — never a 5xx that would read as a crash, and the
 *    reason lands in the audit trail;
 *  - an absent surface stays a 503, never an effect.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  AuditRuntimeDouble,
  DesktopAutomationBroker,
  EmergencyStop,
  FakeRuntimeAdapter,
  P3_CAPABILITIES,
  type DesktopDriver,
} from "@unifia/contracts"
import { createWorkbenchApp, loadConfigFromEnv } from "../src/bootstrap.js"
import { UnauthenticatedPrincipal, WorkbenchServer } from "../src/index.js"
import { WorkspaceRuntime } from "@unifia/workspace-runtime"

const root = await mkdtemp(path.join(os.tmpdir(), "unifia-desktop-"))
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

const auth = new UnauthenticatedPrincipal("anonymous", ["workspace.register", "workspace.open", ...P3_CAPABILITIES])

type Calls = { observe: number; control: number }

function recordingDriver(calls: Calls): DesktopDriver {
  return {
    observe: async (target) => {
      calls.observe += 1
      return { appId: target.appId, redacted: true }
    },
    control: async () => {
      calls.control += 1
    },
  }
}

function server(desktop?: DesktopAutomationBroker) {
  const audit = new AuditRuntimeDouble(() => 1_000)
  const target = new WorkbenchServer({
    auth,
    workspace: new WorkspaceRuntime(),
    runtime: new FakeRuntimeAdapter(() => 1_000),
    audit,
    capability: { check: async () => "allow" },
    desktop,
  })
  return { target, audit }
}

async function openWorkspace(target: WorkbenchServer) {
  await writeFile(path.join(root, "README.md"), "hello").catch(() => undefined)
  const registered = await target.fetch(
    new Request("http://localhost/v1/workspaces/register", { method: "POST", body: JSON.stringify({ name: "desktop", path: root }) }),
  )
  if (registered.status !== 201) throw new Error(`workspace register failed with ${registered.status}`)
  const registeredBody = (await registered.json()) as { id: string }
  const opened = await target.fetch(new Request(`http://localhost/v1/workspaces/${registeredBody.id}/open`, { method: "POST" }))
  if (opened.status !== 200) throw new Error(`workspace open failed with ${opened.status}`)
  return (await opened.json()) as { id: string; token: string }
}

function observe(target: WorkbenchServer, handle: { id: string; token: string }, appId: string) {
  return target.fetch(
    new Request("http://localhost/v1/desktop/observe", {
      method: "POST",
      headers: { authorization: `Bearer ${handle.token}` },
      body: JSON.stringify({ workspaceId: handle.id, appId }),
    }),
  )
}

function control(target: WorkbenchServer, handle: { id: string; token: string }, appId: string) {
  return target.fetch(
    new Request("http://localhost/v1/desktop/control", {
      method: "POST",
      headers: { authorization: `Bearer ${handle.token}` },
      body: JSON.stringify({ workspaceId: handle.id, appId, action: "mouse", payload: { x: 1, y: 1 } }),
    }),
  )
}

function lastRefusal(audit: AuditRuntimeDouble) {
  const events = audit.events()
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.action === "desktop.refused") return event
  }
  return undefined
}

describe("desktop authority (#571)", () => {
  test("an absent surface denies with 503, never an effect", async () => {
    const { target } = server()
    const handle = await openWorkspace(target)
    expect((await observe(target, handle, "allowed-app")).status).toBe(503)
    expect((await control(target, handle, "allowed-app")).status).toBe(503)
  })

  test("an allowlisted app observes and controls through the driver", async () => {
    const calls: Calls = { observe: 0, control: 0 }
    const broker = new DesktopAutomationBroker(recordingDriver(calls), ["allowed-app"])
    const { target } = server(broker)
    const handle = await openWorkspace(target)

    const observed = await observe(target, handle, "allowed-app")
    expect(observed.status).toBe(200)
    expect(await observed.json()).toEqual({ observation: { appId: "allowed-app", redacted: true } })

    const controlled = await control(target, handle, "allowed-app")
    expect(controlled.status).toBe(202)

    expect(calls).toEqual({ observe: 1, control: 1 })
  })

  test("an app outside the allowlist is refused with zero effects", async () => {
    const calls: Calls = { observe: 0, control: 0 }
    const broker = new DesktopAutomationBroker(recordingDriver(calls), ["allowed-app"])
    const { target, audit } = server(broker)
    const handle = await openWorkspace(target)

    const refused = await observe(target, handle, "other-app")
    expect(refused.status).toBe(403)
    expect(await refused.json()).toEqual({ error: "denied", capability: "desktop.refused" })
    expect(lastRefusal(audit)?.reason).toContain("not allowlisted")

    expect((await control(target, handle, "other-app")).status).toBe(403)
    expect(calls).toEqual({ observe: 0, control: 0 })
  })

  test("an engaged emergency stop is refused with zero effects", async () => {
    const calls: Calls = { observe: 0, control: 0 }
    const stop = new EmergencyStop()
    stop.engage()
    const broker = new DesktopAutomationBroker(recordingDriver(calls), ["allowed-app"], undefined, stop)
    const { target, audit } = server(broker)
    const handle = await openWorkspace(target)

    const refused = await observe(target, handle, "allowed-app")
    expect(refused.status).toBe(403)
    expect(lastRefusal(audit)?.reason).toContain("emergency stop")

    expect(calls).toEqual({ observe: 0, control: 0 })
  })

  test("an engaged kill switch is refused with zero effects", async () => {
    const calls: Calls = { observe: 0, control: 0 }
    const broker = new DesktopAutomationBroker(recordingDriver(calls), ["allowed-app"], { isEngaged: () => true })
    const { target, audit } = server(broker)
    const handle = await openWorkspace(target)

    const refused = await control(target, handle, "allowed-app")
    expect(refused.status).toBe(403)
    expect(lastRefusal(audit)?.reason).toContain("disabled")

    expect(calls).toEqual({ observe: 0, control: 0 })
  })

  test("createWorkbenchApp hands an injected broker to the server graph", async () => {
    const calls: Calls = { observe: 0, control: 0 }
    const broker = new DesktopAutomationBroker(recordingDriver(calls), ["allowed-app"])
    const app = createWorkbenchApp(
      loadConfigFromEnv({
        UNIFIA_WORKBENCH_SIGNING_KEY: "k".repeat(32),
        UNIFIA_WORKBENCH_AUDIT_LOG: path.join(root, ".unifia", "audit-desktop.jsonl"),
      }),
      { desktop: broker },
    )

    expect(app.server.desktop).toBe(broker)
  })
})
