/* SPDX-License-Identifier: MIT */

import { WIRE_PROTOCOL_VERSION } from "@unifia/contracts/workbench-wire"
import { UnauthenticatedPrincipal } from "../src/auth.js"
import { WorkbenchServer } from "../src/index.js"

const audit: string[] = []
const server = new WorkbenchServer({
  auth: new UnauthenticatedPrincipal(),
  instanceId: "server-instance-1",
  workspace: {} as never,
  runtime: {} as never,
  audit: { record: (_actor, capability) => { audit.push(capability) } },
  capability: { check: async () => "allow" },
})

const request = (body: unknown) => server.fetch(new Request("http://127.0.0.1/v1/handshake", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
}))

const accepted = await request({
  kind: "workbench.handshake",
  protocolVersion: WIRE_PROTOCOL_VERSION,
  supportedVersions: [WIRE_PROTOCOL_VERSION],
  clientInstanceId: "client-instance-1",
})
if (accepted.status !== 200) throw new Error(`accepted handshake returned ${accepted.status}`)
const acceptedBody = await accepted.json() as Record<string, unknown>
if (acceptedBody.accepted !== true || acceptedBody.instanceId !== "server-instance-1") throw new Error("accepted handshake response was not authoritative")

const refused = await request({
  kind: "workbench.handshake",
  protocolVersion: 99,
  supportedVersions: [99],
  clientInstanceId: "client-instance-1",
})
if (refused.status !== 200) throw new Error(`unsupported handshake returned ${refused.status}`)
const refusedBody = await refused.json() as Record<string, unknown>
if (refusedBody.accepted !== false || refusedBody.reason !== "unsupported-version") throw new Error("unsupported handshake was not refused explicitly")

const invalid = await request({ kind: "not-a-handshake" })
if (invalid.status !== 400) throw new Error(`invalid handshake returned ${invalid.status}`)
if (!audit.includes("handshake.accept") || !audit.includes("handshake.unsupported-version")) throw new Error("handshake decisions were not audited")

console.log("WorkbenchServer handshake: 4/4 passed")
