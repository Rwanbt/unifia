/* SPDX-License-Identifier: MIT */

/**
 * End-to-end proof in a real browser.
 *
 * Chain exercised: a real Chromium page fetches a generated UI description from
 * a harness origin, mounts it with the real DOM consumer, a real user click is
 * dispatched, the harness forwards it to a real WorkbenchServer over HTTP, and
 * the decision lands in the durable audit log.
 *
 * WHY the harness proxies instead of the page calling the workbench directly:
 * the page and the workbench are different origins, and rather than opening
 * CORS on a server that holds filesystem capabilities, the harness keeps the
 * tokens server-side — which is also the posture a real deployment wants. The
 * browser never sees a bearer token.
 *
 * STATUS: BLOCKED — does not run in this environment. Kept because the harness
 * and assertions are the specification for the missing proof, and because the
 * blocker is a toolchain incompatibility, not a product defect.
 *
 * Evidence, 2026-08-04:
 *   - `chromium.launch()` starts the browser and then hangs until the launch
 *     timeout: Playwright drives it over `--remote-debugging-pipe`, which needs
 *     stdio file descriptors 3 and 4 that Bun does not wire on Windows.
 *   - Attaching over a TCP debugging port instead gets further — Chromium logs
 *     `DevTools listening on ws://127.0.0.1:<port>/devtools/browser/<id>` and
 *     the `/json/version` probe returns 200 — but `connectOverCDP` then fails
 *     with `Timeout 30000ms exceeded / <ws connecting>`: playwright-core's
 *     WebSocket client does not complete a handshake under Bun either.
 *   - Running it under Node instead (the convention used by
 *     packages/browser-runtime/test/playwright-driver.e2e.ts) is blocked from
 *     the other side: this suite needs the WorkbenchServer, whose bootstrap
 *     uses `Bun.serve`, and Node's `--experimental-strip-types` refuses to
 *     strip types from the workspace packages reached through node_modules.
 *
 * Two ways out, for whoever picks this up:
 *   1. Run under Node and replace the two Bun APIs at the seam — serve
 *      `createWorkbenchApp().server.fetch` through `node:http`, and pre-build
 *      the browser bundle by invoking `bun build` as a subprocess. This keeps
 *      the browser hop real; `Bun.serve` itself stays covered by
 *      workbench-server/test/bootstrap.test.ts.
 *   2. Drive CDP directly over Bun's native WebSocket and drop playwright from
 *      this suite entirely.
 *
 * Excluded from the conformance gate with this reason recorded in
 * scripts/unifia-conformance.mjs.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { McpUiControlBroker } from "@unifia/contracts"
import { HmacTokenAuthenticator } from "@unifia/workbench-server"
import { loadConfigFromEnv, startWorkbench } from "@unifia/workbench-server/bootstrap"
import { chromium } from "playwright"

let checks = 0
const check = (condition: boolean, message: string): void => {
  checks += 1
  if (!condition) throw new Error(message)
}

const SIGNING_KEY = "unifia-browser-e2e-signing-key-0123456789"
const UI_ACTIONS = new Set(["ui.run"])

const root = await mkdtemp(path.join(os.tmpdir(), "unifia-e2e-"))
const auditLogPath = path.join(root, ".unifia", "audit.jsonl")
const config = loadConfigFromEnv({ UNIFIA_WORKBENCH_SIGNING_KEY: SIGNING_KEY, UNIFIA_WORKBENCH_PORT: "0", UNIFIA_WORKBENCH_AUDIT_LOG: auditLogPath })

// desktop.control is allowlisted so the gate does not intercept before the UI
// broker is reached: this suite is proving the broker's own refusal, not the
// capability gate's, which server.test.ts already covers.
const workbench = await startWorkbench(
  { ...config, allowlistedCapabilities: new Set(["desktop.control"]) },
  {
    ui: new McpUiControlBroker({ inspect: async (componentId) => ({ componentId }), execute: async () => ({}) }, ["run"], { request: () => ({ id: "ui-approval-e2e" }) }),
    uiAllowedActions: UI_ACTIONS,
  },
)

const signer = new HmacTokenAuthenticator(SIGNING_KEY, config.issuer, config.audience)
const token = signer.sign({ id: "e2e", scopes: new Set(["workspace.register", "workspace.open"]), workspaces: "*" }, Date.now() + 600_000)
const bearer = { authorization: `Bearer ${token}`, "content-type": "application/json" }

const registered = await fetch(`${workbench.url}/v1/workspaces/register`, { method: "POST", headers: bearer, body: JSON.stringify({ name: "e2e", path: root }) })
const workspace = await registered.json() as { id: string }
const opened = await fetch(`${workbench.url}/v1/workspaces/${workspace.id}/open`, { method: "POST", headers: bearer })
const session = await opened.json() as { id: string; token: string }
const scoped = { ...bearer, "x-unifia-file-session": session.token }

// The consumer is bundled for the browser from the same source the unit test
// exercises — the page must not run a hand-written copy of the renderer.
const bundle = await Bun.build({ entrypoints: [path.join(import.meta.dirname, "browser-entry.ts")], target: "browser", minify: false })
if (!bundle.success) throw new Error(`browser bundle failed: ${bundle.logs.join("\n")}`)
const script = await bundle.outputs[0].text()

const PAGE = `<!doctype html><html><body><div id="root"></div><script type="module">${script}</script></body></html>`

const harness = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === "/") return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } })
    if (url.pathname === "/ui") {
      const node = { type: "panel", id: "root", props: { title: "Generated" }, children: [{ type: "button", id: "run", props: { label: "Run report", actionId: "ui.run" } }] }
      const rendered = await fetch(`${workbench.url}/v1/ui/render`, { method: "POST", headers: scoped, body: JSON.stringify({ workspaceId: session.id, node }) })
      return new Response(await rendered.text(), { status: rendered.status, headers: { "content-type": "application/json" } })
    }
    if (url.pathname === "/action" && request.method === "POST") {
      const action = await request.json() as { componentId: string; actionId: string }
      const forwarded = await fetch(`${workbench.url}/v1/ui/actions`, {
        method: "POST",
        headers: scoped,
        body: JSON.stringify({ workspaceId: session.id, action: { id: action.actionId.replace(/[^A-Za-z0-9_-]/g, "-"), componentId: action.componentId, kind: "click" } }),
      })
      return new Response(await forwarded.text(), { status: forwarded.status, headers: { "content-type": "application/json" } })
    }
    return new Response("not found", { status: 404 })
  },
})

/**
 * Launches Chromium ourselves and attaches over a CDP websocket.
 *
 * WHY not `chromium.launch()`: Playwright drives the browser over
 * `--remote-debugging-pipe`, which needs extra stdio file descriptors (3 and 4)
 * that Bun does not wire on Windows. The browser starts and then the handshake
 * hangs until the launch timeout. Opening a debugging port and attaching with
 * connectOverCDP uses a plain TCP socket and is transport-independent.
 */
async function launchChromiumOverCdp(): Promise<{ browser: Awaited<ReturnType<typeof chromium.connectOverCDP>>; kill(): void }> {
  const port = 9222 + Math.floor(Math.random() * 1000)
  // WHY the streams are piped and not ignored: with stdio "ignore" the browser
  // never reaches the point of listening on Windows, and ignoring the streams
  // also throws away the only diagnostic available when the launch fails.
  const child = Bun.spawn([chromium.executablePath(), `--remote-debugging-port=${port}`, "--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run", `--user-data-dir=${path.join(root, "chrome-profile")}`, "about:blank"], { stdout: "pipe", stderr: "pipe" })
  const deadline = Date.now() + 20_000
  let lastPollError = "<none>"
  for (;;) {
    if (Date.now() > deadline || child.exitCode !== null) {
      child.kill()
      throw new Error(`Chromium did not expose a CDP endpoint (exit=${child.exitCode}); last poll error: ${lastPollError}`)
    }
    try {
      const version = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (version.ok) {
        const endpoint = (await version.json() as { webSocketDebuggerUrl: string }).webSocketDebuggerUrl
        return { browser: await chromium.connectOverCDP(endpoint), kill: () => child.kill() }
      }
    } catch (error) { lastPollError = error instanceof Error ? error.message : String(error) }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

const { browser, kill } = await launchChromiumOverCdp()
try {
  const page = await browser.newPage()
  const pageErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))
  page.on("console", (message) => { if (message.type() === "error") pageErrors.push(message.text()) })

  await page.goto(`http://127.0.0.1:${harness.port}/`, { waitUntil: "domcontentloaded" })
  await page.waitForSelector("section[data-unifia-id='root']", { timeout: 15_000 })

  check(await page.locator("section[data-unifia-id='root']").getAttribute("aria-label") === "Generated", "the panel did not mount with its accessible label in a real browser")
  const button = page.locator("button[data-unifia-id='run']")
  check(await button.textContent() === "Run report", "the button label did not render in a real browser")
  check(await button.getAttribute("onclick") === null, "an onclick attribute survived into a real browser")

  await button.click()
  await page.waitForFunction("window.__unifiaLastResult !== undefined", undefined, { timeout: 15_000 })
  const result = await page.evaluate("window.__unifiaLastResult") as { status: number; body: { result?: { status: string; approvalId?: string } } }

  // The point of the whole chain: a click coming from a generated UI does not
  // execute. It becomes an approval request.
  check(result.status === 202, `the forwarded UI action returned ${result.status} instead of 202 pending-approval`)
  check(result.body.result?.status === "pending-approval", `the broker returned ${result.body.result?.status} instead of pending-approval`)
  check(typeof result.body.result?.approvalId === "string", "no approval id reached the browser")
  check(pageErrors.length === 0, `the page reported errors: ${pageErrors.join(" | ")}`)

  const audit = (await readFile(auditLogPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { capability: string; decision: string })
  check(audit.some((entry) => entry.capability === "ui.action" && entry.decision === "allow"), "the UI action was not recorded in the durable audit log")
  check(audit.some((entry) => entry.capability === "ui.render" && entry.decision === "allow"), "the UI render was not recorded in the durable audit log")

  console.log(`GenerativeUiBrowserE2E: ${checks}/${checks} passed`)
} finally {
  await browser.close().catch(() => {})
  kill()
  await harness.stop(true)
  await workbench.stop()
  await rm(root, { recursive: true, force: true })
}
