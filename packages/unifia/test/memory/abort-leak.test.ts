import { describe, test, expect } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { WebFetchTool } from "../../src/tool/webfetch"
import { SessionID, MessageID } from "../../src/session/schema"

const projectRoot = path.join(__dirname, "../..")

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: new AbortController().signal,
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

const MB = 1024 * 1024
const ITERATIONS = 50

const getHeapMB = () => {
  Bun.gc(true)
  return process.memoryUsage().heapUsed / MB
}

describe("memory: abort controller leak", () => {
  test("webfetch does not leak memory over many invocations", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const tool = await WebFetchTool.init()
        // A local server keeps the measurement independent of the network, and every fetch takes the
        // success path instead of being swallowed as a failure. The body stays small on purpose: with a
        // ~50KB body the heapUsed delta reached 4.6-7MB per 50 fetches here even for a bare
        // fetch + TextDecoder loop, so it measured the engine's large-string retention, not the tool.
        const server = Bun.serve({
          port: 0,
          fetch: () =>
            new Response(`<html><body>${"x".repeat(8 * 1024)}</body></html>`, {
              headers: { "content-type": "text/html" },
            }),
        })
        const url = `http://127.0.0.1:${server.port}/`

        try {
          // WHY THE FIRST WINDOW IS THROWN AWAY. Measuring a cold baseline
          // against a used heap does not measure this tool. The first pass pays
          // a one-time cost — JIT, module graphs, lazy caches, the SDK client's
          // first connection — that Bun.gc(true) does not release, and it lands
          // entirely in the delta. Measured on Windows at dev@8777452c46, three
          // identical 50-call passes in one bun:test run:
          //
          //   pass 1  12.53 MB   (heap 93.1 -> 105.6)
          //   pass 2   0.78 MB
          //   pass 3   1.08 MB
          //   1500ms sleep, zero fetches: -0.02 MB
          //
          // A leak is a slope, so the assertion is now taken between two warm
          // windows. Pass 1 still runs, which keeps the one-time cost out of the
          // measured slope instead of pretending it is not there.
          const measure = async () => {
            Bun.gc(true)
            const before = getHeapMB()
            for (let i = 0; i < ITERATIONS; i++) {
              await tool.execute({ url, format: "text" }, ctx)
            }
            Bun.gc(true)
            return getHeapMB() - before
          }

          await measure()
          const growth = await measure()

          console.log(`Baseline: ${getHeapMB().toFixed(2)} MB`)
          console.log(`Growth over ${ITERATIONS} warm fetches: ${growth.toFixed(2)} MB`)

          // Memory growth should be minimal - less than 1MB per 10 requests.
          // With the old closure pattern, this would grow ~0.5MB per request,
          // so a per-request leak is far above this bound even on the warm slope.
          expect(growth).toBeLessThan(ITERATIONS / 10)
        } finally {
          server.stop(true)
        }
      },
    })
  }, 300_000)

  test("compare closure vs bind pattern directly", async () => {
    const ITERATIONS = 500

    // Test OLD pattern: arrow function closure
    // Store closures in a map keyed by content to force retention
    const closureMap = new Map<string, () => void>()
    const timers: Timer[] = []
    const controllers: AbortController[] = []

    Bun.gc(true)
    Bun.sleepSync(100)
    const baseline = getHeapMB()

    for (let i = 0; i < ITERATIONS; i++) {
      // Simulate large response body like webfetch would have
      const content = `${i}:${"x".repeat(50 * 1024)}` // 50KB unique per iteration
      const controller = new AbortController()
      controllers.push(controller)

      // OLD pattern - closure captures `content`
      const handler = () => {
        // Actually use content so it can't be optimized away
        if (content.length > 1000000000) controller.abort()
      }
      closureMap.set(content, handler)
      const timeoutId = setTimeout(handler, 30000)
      timers.push(timeoutId)
    }

    Bun.gc(true)
    Bun.sleepSync(100)
    const after = getHeapMB()
    const oldGrowth = after - baseline

    console.log(`OLD pattern (closure): ${oldGrowth.toFixed(2)} MB growth (${closureMap.size} closures)`)

    // Cleanup after measuring
    timers.forEach(clearTimeout)
    controllers.forEach((c) => c.abort())
    closureMap.clear()

    // Test NEW pattern: bind
    Bun.gc(true)
    Bun.sleepSync(100)
    const baseline2 = getHeapMB()
    const handlers2: (() => void)[] = []
    const timers2: Timer[] = []
    const controllers2: AbortController[] = []

    for (let i = 0; i < ITERATIONS; i++) {
      const _content = `${i}:${"x".repeat(50 * 1024)}` // 50KB - won't be captured
      const controller = new AbortController()
      controllers2.push(controller)

      // NEW pattern - bind doesn't capture surrounding scope
      const handler = controller.abort.bind(controller)
      handlers2.push(handler)
      const timeoutId = setTimeout(handler, 30000)
      timers2.push(timeoutId)
    }

    Bun.gc(true)
    Bun.sleepSync(100)
    const after2 = getHeapMB()
    const newGrowth = after2 - baseline2

    // Cleanup after measuring
    timers2.forEach(clearTimeout)
    controllers2.forEach((c) => c.abort())
    handlers2.length = 0

    console.log(`NEW pattern (bind): ${newGrowth.toFixed(2)} MB growth`)
    console.log(`Improvement: ${(oldGrowth - newGrowth).toFixed(2)} MB saved`)

    expect(newGrowth).toBeLessThanOrEqual(oldGrowth)
  })
})
