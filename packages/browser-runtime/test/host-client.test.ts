/* SPDX-License-Identifier: MIT */
import { expect, test } from "bun:test"
import type { BrowserSession } from "@unifia/contracts"
import { BrowserHostClient, type HostSeed, type HostTransport } from "../src/host/host-client.ts"
import {
  BrowserHostRemoteError,
  BrowserHostUnavailableError,
  decodeFrame,
  encodeBytes,
  encodeFrame,
  type HostInbound,
  type HostOutbound,
  type HostRequest,
} from "../src/host/protocol.ts"

const NOW = 1_700_000_000_000

function session(overrides: Partial<BrowserSession> = {}): BrowserSession {
  return {
    id: "s1",
    workspaceId: "w1",
    chatSessionId: "c1",
    profileId: "p1",
    runtimeProfile: "isolated",
    controller: "user",
    tabs: [],
    activeTabId: null,
    viewport: { width: 1280, height: 800 },
    status: "ready",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as BrowserSession
}

/** A host the test drives by hand: it records what the client sends and plays back chosen frames. */
function fakeHost() {
  const sent: HostRequest[] = []
  const answers: Array<HostOutbound | HostInbound> = []
  let data: (chunk: string) => void = () => {}
  let exit: (reason: string) => void = () => {}
  let killed = false
  const transport: HostTransport = {
    send: (line) => {
      const frame = decodeFrame(line.slice(0, -1))
      if ("method" in frame) sent.push(frame)
      else answers.push(frame)
    },
    onData: (listener) => {
      data = listener
    },
    onExit: (listener) => {
      exit = listener
    },
    kill: () => {
      killed = true
    },
  }
  return {
    transport,
    sent,
    answers,
    push: (frame: HostOutbound | HostInbound) => data(encodeFrame(frame)),
    pushRaw: (chunk: string) => data(chunk),
    die: (reason = "exit code 1") => exit(reason),
    ready: () => data(encodeFrame({ event: "ready", version: 1 })),
    wasKilled: () => killed,
    reply: (id: number, result: unknown) => data(encodeFrame({ id, result })),
  }
}

function harness(options: { seed?: HostSeed; authorize?: (url: string, workspaceId: string) => Promise<boolean> } = {}) {
  const hosts: Array<ReturnType<typeof fakeHost>> = []
  const errors: Error[] = []
  const client = new BrowserHostClient({
    start: () => {
      const host = fakeHost()
      hosts.push(host)
      // The host announces itself once the client is listening.
      queueMicrotask(() => host.ready())
      return host.transport
    },
    seed: () => options.seed ?? { sessions: [], storage: {} },
    authorize: options.authorize ?? (async () => true),
    onError: (error) => errors.push(error),
  })
  return { client, hosts, errors, host: () => hosts.at(-1)! }
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

test("starts the host on the first call, not before", async () => {
  const { client, hosts } = harness()
  expect(hosts).toHaveLength(0)
  const created = client.create({ workspaceId: "w1", runtimeProfile: "isolated", viewport: { width: 1280, height: 800 } })
  await flush()
  expect(hosts).toHaveLength(1)
  hosts[0]!.reply(hosts[0]!.sent[0]!.id, session())
  expect((await created).id).toBe("s1")
})

test("serves get, forChatSession, activity and downloads from the mirror after a sync", async () => {
  const { client, host } = harness()
  const created = client.create({
    workspaceId: "w1",
    chatSessionId: "c1",
    runtimeProfile: "isolated",
    viewport: { width: 1280, height: 800 },
    capabilities: ["browser.navigate"],
  })
  await flush()
  const activity = [
    { sequence: 1, sessionId: "s1", kind: "session.created", controller: "user", occurredAt: NOW },
    { sequence: 2, sessionId: "s1", kind: "tab.opened", controller: "user", occurredAt: NOW },
  ] as const
  host().push({ event: "sync", session: session(), activity: [...activity], downloads: [] })
  host().reply(host().sent[0]!.id, session())
  await created

  expect(client.get("s1").workspaceId).toBe("w1")
  expect(client.forChatSession("w1", "c1")).toEqual({ sessionId: "s1", capabilities: ["browser.navigate"] })
  expect(client.forChatSession("w1", "other")).toBeUndefined()
  expect(client.activity("s1", 1).map((event) => event.sequence)).toEqual([2])
  expect(client.downloads("s1")).toEqual([])
})

test("a closed or unknown session is unavailable, like the in-process service", async () => {
  const { client, host } = harness()
  const created = client.create({ workspaceId: "w1", runtimeProfile: "isolated", viewport: { width: 1280, height: 800 } })
  await flush()
  host().reply(host().sent[0]!.id, session())
  await created
  host().push({ event: "sync", session: session({ status: "closed" }), activity: [], downloads: [] })
  expect(() => client.get("s1")).toThrow("browser session is unavailable")
  expect(() => client.get("nope")).toThrow("browser session is unavailable")
  expect(() => client.activity("s1")).toThrow("browser session is unavailable")
})

test("reads a session persisted by an earlier run before the host has started", () => {
  const { client, hosts } = harness({ seed: { sessions: [session()], storage: {} } })
  expect(client.get("s1").id).toBe("s1")
  expect(hosts).toHaveLength(0)
})

test("rebuilds a host-side failure with its name for the HTTP layer", async () => {
  const { client, host } = harness()
  const call = client.openTab("s1", "https://example.com")
  await flush()
  host().push({ id: host().sent[0]!.id, error: { name: "BrowserActionApprovalRequiredError", message: "needs approval" } })
  const error = await call.catch((e: unknown) => e)
  expect(error).toBeInstanceOf(BrowserHostRemoteError)
  expect((error as Error).name).toBe("BrowserActionApprovalRequiredError")
})

test("answers a navigation authorize ask with the egress decision of the server", async () => {
  const seen: Array<[string, string]> = []
  const { client, host } = harness({
    authorize: async (url, workspaceId) => {
      seen.push([url, workspaceId])
      return url.startsWith("https://ok.")
    },
  })
  const call = client.openTab("s1")
  await flush()
  host().push({ id: 7, request: "authorize", url: "https://ok.example", workspaceId: "w1" })
  host().push({ id: 8, request: "authorize", url: "https://evil.example", workspaceId: "w1" })
  await flush()
  expect(host().answers).toEqual([
    { id: 7, result: { approved: true } },
    { id: 8, result: { approved: false } },
  ])
  expect(seen).toEqual([
    ["https://ok.example", "w1"],
    ["https://evil.example", "w1"],
  ])
  host().reply(host().sent[0]!.id, session())
  await call
})

test("routes a sensitive-action ask to the act call in flight and refuses when there is none", async () => {
  const { client, host } = harness()
  const reasons: string[] = []
  const acting = client.act("s1", "t1", "o1", { kind: "click", targetId: "x" } as never, async (reason) => {
    reasons.push(reason)
  })
  await flush()
  host().push({ id: 1, request: "approve", reason: "submits a form", sessionId: "s1" })
  host().push({ id: 2, request: "approve", reason: "another session", sessionId: "s2" })
  await flush()
  // Asks are answered as their decisions settle, so order is not part of the contract.
  expect([...host().answers].sort((left, right) => (left as { id: number }).id - (right as { id: number }).id)).toEqual([
    { id: 1, result: { approved: true } },
    { id: 2, result: { approved: false } },
  ])
  expect(reasons).toEqual(["submits a form"])
  host().reply(host().sent[0]!.id, null)
  await acting
  // The callback belongs to the call: once it returns, the same ask is refused.
  host().push({ id: 3, request: "approve", reason: "late", sessionId: "s1" })
  await flush()
  expect(host().answers.at(-1)).toEqual({ id: 3, result: { approved: false } })
})

test("a declined approval is a refusal, never an approval", async () => {
  const { client, host } = harness()
  const acting = client.act("s1", "t1", "o1", { kind: "click", targetId: "x" } as never, async () => {
    throw new Error("user said no")
  })
  await flush()
  host().push({ id: 1, request: "approve", reason: "r", sessionId: "s1" })
  await flush()
  expect(host().answers).toEqual([{ id: 1, result: { approved: false } }])
  host().push({ id: host().sent[0]!.id, error: { name: "Error", message: "Browser action was declined" } })
  await expect(acting).rejects.toThrow("declined")
})

test("round-trips bytes as base64 for screenshots and uploads", async () => {
  const { client, host } = harness()
  const shot = client.screenshot("s1", "t1")
  await flush()
  host().reply(host().sent[0]!.id, { base64: encodeBytes(new Uint8Array([1, 2, 3])) })
  expect([...(await shot)]).toEqual([1, 2, 3])

  const upload = client.upload("s1", "t1", { name: "a.txt", mediaType: "text/plain", bytes: new Uint8Array([9, 8]) })
  await flush()
  const request = host().sent[1]!
  expect(request.params).toMatchObject({ name: "a.txt", mediaType: "text/plain", base64: encodeBytes(new Uint8Array([9, 8])) })
  host().reply(request.id, null)
  await upload
})

test("a host crash fails what was in flight, marks the mirror, and the next call restarts it", async () => {
  const { client, hosts, host } = harness({ seed: { sessions: [session()], storage: {} } })
  const inFlight = client.openTab("s1")
  await flush()
  host().die("killed")
  const error = await inFlight.catch((e: unknown) => e)
  expect(error).toBeInstanceOf(BrowserHostUnavailableError)
  expect(client.get("s1").status).toBe("error")

  const again = client.openTab("s1")
  await flush()
  expect(hosts).toHaveLength(2)
  hosts[1]!.reply(hosts[1]!.sent[0]!.id, session({ updatedAt: NOW + 1 }))
  await again
  expect(client.get("s1").status).toBe("ready")
})

test("a host that never says ready fails the call instead of hanging it", async () => {
  const client = new BrowserHostClient({
    start: () => ({ send: () => {}, onData: () => {}, onExit: () => {}, kill: () => {} }),
    seed: () => ({ sessions: [], storage: {} }),
    authorize: async () => true,
    readyTimeoutMs: 20,
  })
  await expect(client.openTab("s1")).rejects.toBeInstanceOf(BrowserHostUnavailableError)
})

test("an unparseable frame is reported and the host is killed", async () => {
  const { client, host, errors } = harness()
  const call = client.openTab("s1")
  await flush()
  host().pushRaw("this is not json\n")
  expect(errors).toHaveLength(1)
  expect(host().wasKilled()).toBe(true)
  host().die("killed")
  await expect(call).rejects.toBeInstanceOf(BrowserHostUnavailableError)
})

test("shutdown asks the host to stop and then kills it; it is a no-op when never started", async () => {
  const idle = harness()
  await idle.client.shutdown()
  expect(idle.hosts).toHaveLength(0)

  const { client, host } = harness()
  const opening = client.openTab("s1")
  await flush()
  host().reply(host().sent[0]!.id, session())
  await opening
  const stopping = client.shutdown()
  await flush()
  expect(host().sent.at(-1)!.method).toBe("host.shutdown")
  host().reply(host().sent.at(-1)!.id, { stopped: true })
  await stopping
  expect(host().wasKilled()).toBe(true)
})
