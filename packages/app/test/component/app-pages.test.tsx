// SPDX-License-Identifier: MIT
// Mounts the real app (provider tree, router, pages) against the real
// `unifia serve`, booted like production, and opens the pages users land on.
// Unit tests cannot load these pages (#1081: 339 of 640 app source files were
// never loaded by any test), and e2e runs against a seeded backend.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { base64Encode } from "@unifia/util/encode"
import { mountApp } from "./mount-app"
import { startRealServer, type RealServer } from "./real-server"

const PAGE_ORIGIN = "http://localhost:3000"
const RENDER_TIMEOUT_MS = 20_000
const ERROR_PAGE_TEXT = "An error occurred while loading the application"

type ServerCall = { url: string; status: number }

let server: RealServer
let calls: ServerCall[] = []
let unmount: (() => void) | undefined
const pageFetch = globalThis.fetch

beforeAll(async () => {
  // happy-dom starts on about:blank, whose origin is "null"; the app needs a real one.
  ;(window as unknown as { happyDOM: { setURL: (url: string) => void } }).happyDOM.setURL(`${PAGE_ORIGIN}/`)
  server = await startRealServer({ corsOrigin: PAGE_ORIGIN })
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await pageFetch(input, init)
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    if (url.startsWith(server.url)) calls.push({ url: url.slice(server.url.length), status: response.status })
    return response
  }) as typeof fetch
}, 120_000)

afterEach(() => {
  unmount?.()
  unmount = undefined
  calls = []
})

afterAll(async () => {
  globalThis.fetch = pageFetch
  await server?.stop()
}, 30_000)

async function waitForText(text: string): Promise<void> {
  const deadline = Date.now() + RENDER_TIMEOUT_MS
  while (Date.now() < deadline) {
    const body = document.body.textContent ?? ""
    if (body.includes(ERROR_PAGE_TEXT)) {
      const detail = [...document.querySelectorAll("textarea")].map((element) => element.value).join("\n")
      throw new Error(`the app rendered its error page:\n${detail.slice(0, 2000)}`)
    }
    if (body.includes(text)) return
    await Bun.sleep(100)
  }
  throw new Error(`"${text}" did not render within ${RENDER_TIMEOUT_MS} ms; page text: ${document.body.textContent?.slice(0, 600)}`)
}

async function waitForSelector(selector: string): Promise<Element> {
  const deadline = Date.now() + RENDER_TIMEOUT_MS
  while (Date.now() < deadline) {
    if ((document.body.textContent ?? "").includes(ERROR_PAGE_TEXT)) await waitForText("\u0000never")
    const element = document.querySelector(selector)
    if (element) return element
    await Bun.sleep(100)
  }
  throw new Error(`${selector} did not render within ${RENDER_TIMEOUT_MS} ms`)
}

function serverErrors(): string {
  return calls
    .filter((call) => call.status >= 500)
    .map((call) => `${call.status} ${call.url}`)
    .join("\n")
}

describe("app pages against the real server", () => {
  test("AppPages_Home_OffersToOpenAProject", async () => {
    unmount = mountApp({ serverUrl: server.url, path: "/" }).view.unmount
    await waitForText("Open project")
    expect(serverErrors()).toBe("")
  }, 60_000)

  test("AppPages_ProjectSession_RendersTheComposer", async () => {
    unmount = mountApp({ serverUrl: server.url, path: `/${base64Encode(server.projectDir)}/session` }).view.unmount
    await waitForSelector('[data-action="prompt-submit"]')
    expect(calls.length).toBeGreaterThan(0)
    expect(serverErrors()).toBe("")
  }, 60_000)

  test("AppPages_WorkMode_RendersWithTheComposer", async () => {
    unmount = mountApp({ serverUrl: server.url, path: `/${base64Encode(server.projectDir)}/work` }).view.unmount
    await waitForSelector('[data-action="prompt-submit"]')
    expect(serverErrors()).toBe("")
  }, 60_000)
})
