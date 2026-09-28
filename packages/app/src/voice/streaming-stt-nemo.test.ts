/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { STREAMING_STT_ERROR_CODES, type PcmFrame, type StreamingSttEvent } from "@unifia/contracts/streaming-stt"
import type { NemoDeps, NemoSocket } from "./nemo-transport"
import { createNemoStreamingSttProvider } from "./streaming-stt-nemo"

const {
  AUDIO_FORMAT_UNSUPPORTED,
  EMPTY_FINAL,
  INFERENCE_TIMEOUT,
  LANGUAGE_UNSUPPORTED,
  MODEL_CRASHED,
  PROVIDER_LOAD_FAILED,
} = STREAMING_STT_ERROR_CODES

const RATE = 16_000
const FRAME_SAMPLES = 320

interface FakeConn {
  readonly socket: NemoSocket
  readonly sent: (string | Uint8Array)[]
  closeCount: number
  emit(type: string, extra?: Record<string, unknown>): void
  drop(reason: string): void
  messages(): Record<string, unknown>[]
  binaryCount(): number
  hasMessageType(type: string): boolean
}

/** In-memory NemoSocket with the same early-message hold as the real
 *  transport, so tests can emit before handlers register. */
function fakeConn(): FakeConn {
  const sent: (string | Uint8Array)[] = []
  const held: string[] = []
  let onMessage: ((raw: string) => void) | undefined
  let onClose: ((why: string) => void) | undefined
  let heldClose = ""
  const conn: FakeConn = {
    sent,
    closeCount: 0,
    emit(type, extra = {}) {
      const raw = JSON.stringify({ type, ...extra })
      if (onMessage) onMessage(raw)
      else held.push(raw)
    },
    drop(reason) {
      // Same hold semantics as the real transport: a close before the
      // handler registers must not vanish.
      if (onClose) onClose(reason)
      else heldClose = reason
    },
    messages: () =>
      sent
        .filter((data): data is string => typeof data === "string")
        .map((raw) => JSON.parse(raw) as Record<string, unknown>),
    binaryCount: () => sent.filter((data) => typeof data !== "string").length,
    hasMessageType: (type) =>
      sent.some((data) => typeof data === "string" && JSON.parse(data).type === type),
    socket: {
      send: (data) => sent.push(data),
      close: () => {
        conn.closeCount++
      },
      onMessage: (handler) => {
        onMessage = handler
        for (const raw of held.splice(0)) handler(raw)
      },
      onClose: (handler) => {
        onClose = handler
        if (heldClose) handler(heldClose)
      },
      onError: () => {
        // Terminal errors arrive via onClose in this fake.
      },
    },
  }
  return conn
}

function frame(sequence: number, rate = RATE, samples = FRAME_SAMPLES): PcmFrame {
  return { samples: new Int16Array(samples), sampleRateHz: rate, capturedAt: sequence * 20, sequence }
}

async function* frames(count: number, rate = RATE, samples = FRAME_SAMPLES): AsyncIterable<PcmFrame> {
  for (let i = 0; i < count; i++) yield frame(i, rate, samples)
}

async function waitFor(cond: () => boolean, ms = 3_000): Promise<void> {
  const until = Date.now() + ms
  while (!cond()) {
    if (Date.now() > until) throw new Error("waitFor timed out")
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
}

async function collect(
  provider: ReturnType<typeof createNemoStreamingSttProvider>,
  source: AsyncIterable<PcmFrame>,
  signal: AbortSignal,
): Promise<StreamingSttEvent[]> {
  const events: StreamingSttEvent[] = []
  for await (const event of provider.transcribe(source, signal)) events.push(event)
  return events
}

/** Drive one full happy session: handshake, configure, frames, commit. */
async function openTurn(conn: FakeConn, frameCount: number): Promise<void> {
  conn.emit("session.created", {})
  await waitFor(() => conn.hasMessageType("session.update"))
  conn.emit("session.updated", {})
  if (frameCount > 0) await waitFor(() => conn.binaryCount() >= frameCount && conn.hasMessageType("input_audio_buffer.commit"))
}

/** 16 frames x 320 samples = 5120 samples = 320 ms at 16 kHz — the
 *  exact route-around threshold; 8 frames stays below it. */
const ROUTE_FRAMES = 16
const SHORT_FRAMES = 8

function providerWith(
  conn: FakeConn,
  extra: {
    probe?: boolean | (() => Promise<boolean>)
    offline?: NemoDeps["offline"]
  } = {},
) {
  const probe =
    typeof extra.probe === "function"
      ? extra.probe
      : extra.probe !== undefined
        ? async () => extra.probe === true
        : undefined
  const deps: NemoDeps = { connect: async () => conn.socket, probe, offline: extra.offline }
  return createNemoStreamingSttProvider(deps)
}

describe("nemo streaming STT provider", () => {
  test("advertises streaming capabilities over the five nominal languages", () => {
    const provider = createNemoStreamingSttProvider({ connect: async () => fakeConn().socket })
    expect(provider.id).toBe("nemotron-streaming")
    expect(provider.capabilities).toEqual({
      providerId: "nemotron-streaming",
      languages: ["en", "fr", "es", "it", "de"],
      partials: true,
      retraction: true,
      confidence: false,
      partialLatencyMs: 1_300,
      finalLatencyMs: 200,
    })
  })

  test("prepare rejects a language the provider does not offer", async () => {
    const provider = createNemoStreamingSttProvider(
      { connect: async () => fakeConn().socket },
      { languages: ["en"] },
    )
    const err = await provider.prepare({ language: "fr" }).catch((error: unknown) => error)
    expect((err as { code?: string }).code).toBe(LANGUAGE_UNSUPPORTED)
  })

  test("prepare fails with PROVIDER_LOAD_FAILED when readiness probe says no", async () => {
    const conn = fakeConn()
    const provider = providerWith(conn, { probe: false })
    const err = await provider.prepare({ language: "en" }).catch((error: unknown) => error)
    expect((err as { code?: string }).code).toBe(PROVIDER_LOAD_FAILED)
    expect((err as Error).message).toContain("not ready")
  })

  test("prepare surfaces the probe cause in the load failure", async () => {
    const conn = fakeConn()
    const provider = providerWith(conn, { probe: () => Promise.reject(new Error("fetch failed")) })
    const err = await provider.prepare({ language: "en" }).catch((error: unknown) => error)
    expect((err as { code?: string }).code).toBe(PROVIDER_LOAD_FAILED)
    expect((err as Error).message).toContain("fetch failed")
  })

  test("prepare skips the readiness gate when no probe is injected", async () => {
    const conn = fakeConn()
    const provider = providerWith(conn)
    await expect(provider.prepare({ language: "en" })).resolves.toBeUndefined()
  })

  test("prepare rejects when the signal is already aborted", async () => {
    const provider = createNemoStreamingSttProvider({ connect: async () => fakeConn().socket })
    const abort = new AbortController()
    abort.abort()
    await expect(provider.prepare({ language: "en" }, abort.signal)).rejects.toThrow(/aborted/)
  })

  test("transcribe before prepare throws instead of guessing config", async () => {
    const provider = createNemoStreamingSttProvider({ connect: async () => fakeConn().socket })
    const err = await collect(provider, frames(1), new AbortController().signal).catch(
      (error: unknown) => error,
    )
    expect((err as Error).message).toContain("prepare()")
  })

  test("happy path: configure, stream frames, fold append deltas, one final", async () => {
    const conn = fakeConn()
    const provider = providerWith(conn)
    await provider.prepare({ language: "en" })
    const consume = collect(provider, frames(3), new AbortController().signal)
    await openTurn(conn, 3)

    const update = conn.messages().find((message) => message.type === "session.update") as {
      session: { sample_rate: number; language: string; automatic_punctuation: boolean }
    }
    expect(update.session.sample_rate).toBe(RATE)
    expect(update.session.language).toBe("en")
    expect(update.session.automatic_punctuation).toBe(true)
    expect(conn.binaryCount()).toBe(3)

    conn.emit("conversation.item.input_audio_transcription.delta", { delta: "hello" })
    conn.emit("conversation.item.input_audio_transcription.delta", { delta: " world" })
    conn.emit("conversation.item.input_audio_transcription.completed", { transcript: "hello world" })
    const events = await consume
    await provider.dispose()

    expect(
      events.map((event) =>
        event.kind === "partial" ? `partial:${event.text}` : event.kind === "final" ? `final:${event.text}` : `error:${event.code}`,
      ),
    ).toEqual(["partial:hello", "partial:hello world", "final:hello world"])
    const partial = events[0]
    expect(partial?.kind === "partial" && partial.lastSequence).toBe(2)
    expect(partial?.kind === "partial" && partial.capturedAt).toBe(40)
    expect(conn.closeCount).toBe(1)
  })

  test("absolute-growth deltas replace the accumulated hypothesis", async () => {
    const conn = fakeConn()
    const provider = providerWith(conn)
    await provider.prepare({ language: "en" })
    const consume = collect(provider, frames(2), new AbortController().signal)
    await openTurn(conn, 2)
    conn.emit("conversation.item.input_audio_transcription.delta", { delta: "hel" })
    conn.emit("conversation.item.input_audio_transcription.delta", { delta: "hello" })
    conn.emit("conversation.item.input_audio_transcription.delta", { delta: "hello world" })
    conn.emit("conversation.item.input_audio_transcription.completed", { transcript: "hello world" })
    const events = await consume
    expect(
      events.filter((event) => event.kind === "partial").map((event) => (event.kind === "partial" ? event.text : "")),
    ).toEqual(["hel", "hello", "hello world"])
  })

  test("empty deltas never produce a partial", async () => {
    const conn = fakeConn()
    const provider = providerWith(conn)
    await provider.prepare({ language: "en" })
    const consume = collect(provider, frames(2), new AbortController().signal)
    await openTurn(conn, 2)
    conn.emit("conversation.item.input_audio_transcription.delta", { delta: "" })
    conn.emit("conversation.item.input_audio_transcription.delta", { delta: "ok" })
    conn.emit("conversation.item.input_audio_transcription.completed", { transcript: "ok" })
    const events = await consume
    expect(events.filter((event) => event.kind === "partial")).toHaveLength(1)
  })

  test("empty final over enough audio recovers through the offline route-around", async () => {
    const conn = fakeConn()
    const calls: number[] = []
    const provider = providerWith(conn, {
      offline: async (audio) => {
        calls.push(audio.samples.length)
        return "  recovered text  "
      },
    })
    await provider.prepare({ language: "en" })
    const consume = collect(provider, frames(ROUTE_FRAMES), new AbortController().signal)
    await openTurn(conn, ROUTE_FRAMES)
    conn.emit("conversation.item.input_audio_transcription.completed", { transcript: "" })
    const events = await consume

    expect(calls).toEqual([ROUTE_FRAMES * FRAME_SAMPLES])
    expect(
      events.map((event) =>
        event.kind === "error"
          ? `error:${event.code}:${event.recovered}`
          : event.kind === "final"
            ? `final:${event.text}`
            : `partial:${event.text}`,
      ),
    ).toEqual([`error:${EMPTY_FINAL}:true`, "final:recovered text"])
  })

  test("failed route-around stays honest: EMPTY_FINAL recovered=false and empty final", async () => {
    const conn = fakeConn()
    const provider = providerWith(conn, {
      offline: () => Promise.reject(new Error("offline broke")),
    })
    await provider.prepare({ language: "en" })
    const consume = collect(provider, frames(ROUTE_FRAMES), new AbortController().signal)
    await openTurn(conn, ROUTE_FRAMES)
    conn.emit("conversation.item.input_audio_transcription.completed", { transcript: "" })
    const events = await consume

    expect(
      events.map((event) =>
        event.kind === "error"
          ? `error:${event.code}:${event.recovered}`
          : event.kind === "final"
            ? `final:${event.text}`
            : `partial:${event.text}`,
      ),
    ).toEqual([`error:${EMPTY_FINAL}:false`, "final:"])
    const err = events[0]
    expect(err?.kind === "error" && err.detail).toContain("offline broke")
  })

  test("route-around returning silence emits a plain empty final without an error", async () => {
    const conn = fakeConn()
    const provider = providerWith(conn, { offline: async () => "   " })
    await provider.prepare({ language: "en" })
    const consume = collect(provider, frames(ROUTE_FRAMES), new AbortController().signal)
    await openTurn(conn, ROUTE_FRAMES)
    conn.emit("conversation.item.input_audio_transcription.completed", { transcript: "" })
    const events = await consume
    expect(events.map((event) => event.kind)).toEqual(["final"])
  })

  test("short audio skips the route-around entirely", async () => {
    const conn = fakeConn()
    let called = 0
    const provider = providerWith(conn, {
      offline: async () => {
        called++
        return "should not run"
      },
    })
    await provider.prepare({ language: "en" })
    const consume = collect(provider, frames(SHORT_FRAMES), new AbortController().signal)
    await openTurn(conn, SHORT_FRAMES)
    conn.emit("conversation.item.input_audio_transcription.completed", { transcript: "" })
    const events = await consume
    expect(called).toBe(0)
    expect(events.map((event) => event.kind)).toEqual(["final"])
    expect(events[0]?.kind === "final" && events[0].text).toBe("")
  })

  test("without an offline dependency an empty final is a plain honest empty", async () => {
    const conn = fakeConn()
    const provider = providerWith(conn)
    await provider.prepare({ language: "en" })
    const consume = collect(provider, frames(ROUTE_FRAMES), new AbortController().signal)
    await openTurn(conn, ROUTE_FRAMES)
    conn.emit("conversation.item.input_audio_transcription.completed", { transcript: "" })
    const events = await consume
    expect(events.map((event) => event.kind)).toEqual(["final"])
  })

  test("zero frames emits an empty final without configuring the session", async () => {
    const conn = fakeConn()
    const provider = providerWith(conn)
    await provider.prepare({ language: "en" })
    const consume = collect(provider, frames(0), new AbortController().signal)
    conn.emit("session.created", {})
    const events = await consume
    expect(events.map((event) => event.kind)).toEqual(["final"])
    expect(events[0]?.kind === "final" && events[0].text).toBe("")
    expect(conn.hasMessageType("session.update")).toBe(false)
  })

  test("sample rate outside the documented range fails before any audio is sent", async () => {
    const conn = fakeConn()
    const provider = providerWith(conn)
    await provider.prepare({ language: "en" })
    const consume = collect(provider, frames(2, 4_000), new AbortController().signal)
    conn.emit("session.created", {})
    const events = await consume
    expect(events.map((event) => event.kind)).toEqual(["error"])
    expect(events[0]?.kind === "error" && events[0].code).toBe(AUDIO_FORMAT_UNSUPPORTED)
    expect(conn.hasMessageType("session.update")).toBe(false)
    expect(conn.binaryCount()).toBe(0)
  })

  test("mixed sample rates inside one turn are rejected", async () => {
    const conn = fakeConn()
    const provider = providerWith(conn)
    await provider.prepare({ language: "en" })
    const source = (async function* () {
      yield frame(0, RATE)
      yield frame(1, 48_000)
    })()
    const consume = collect(provider, source, new AbortController().signal)
    conn.emit("session.created", {})
    await waitFor(() => conn.hasMessageType("session.update"))
    conn.emit("session.updated", {})
    const events = await consume
    expect(events.map((event) => event.kind)).toEqual(["error"])
    expect(events[0]?.kind === "error" && events[0].code).toBe(AUDIO_FORMAT_UNSUPPORTED)
    expect(conn.binaryCount()).toBe(1)
  })

  test("socket drop before session.created surfaces PROVIDER_LOAD_FAILED", async () => {
    const conn = fakeConn()
    const provider = providerWith(conn)
    await provider.prepare({ language: "en" })
    const consume = collect(provider, frames(2), new AbortController().signal)
    await waitFor(() => conn.sent.length === 0)
    conn.drop("server rejected")
    const events = await consume
    expect(events.map((event) => event.kind)).toEqual(["error"])
    const err = events[0]
    expect(err?.kind === "error" && err.code).toBe(PROVIDER_LOAD_FAILED)
    expect(err?.kind === "error" && err.detail).toContain("server rejected")
  })

  test("socket drop while waiting for the final surfaces MODEL_CRASHED", async () => {
    const conn = fakeConn()
    const provider = providerWith(conn)
    await provider.prepare({ language: "en" })
    const consume = collect(provider, frames(2), new AbortController().signal)
    await openTurn(conn, 2)
    conn.drop("decoder died")
    const events = await consume
    expect(events.map((event) => event.kind)).toEqual(["error"])
    expect(events[0]?.kind === "error" && events[0].code).toBe(MODEL_CRASHED)
  })

  test("protocol error events surface MODEL_CRASHED with the server detail", async () => {
    const conn = fakeConn()
    const provider = providerWith(conn)
    await provider.prepare({ language: "en" })
    const consume = collect(provider, frames(2), new AbortController().signal)
    await openTurn(conn, 2)
    conn.emit("error", { error: { code: "invalid_request", message: "bad session" } })
    const events = await consume
    expect(events.map((event) => event.kind)).toEqual(["error"])
    const err = events[0]
    expect(err?.kind === "error" && err.code).toBe(MODEL_CRASHED)
    expect(err?.kind === "error" && err.detail).toContain("invalid_request")
    expect(err?.kind === "error" && err.detail).toContain("bad session")
  })

  test("missing final within finalTimeoutMs yields INFERENCE_TIMEOUT", async () => {
    const conn = fakeConn()
    const provider = providerWith(conn)
    await provider.prepare({ language: "en", finalTimeoutMs: 40 })
    const consume = collect(provider, frames(2), new AbortController().signal)
    await openTurn(conn, 2)
    const events = await consume
    expect(events.map((event) => event.kind)).toEqual(["error"])
    expect(events[0]?.kind === "error" && events[0].code).toBe(INFERENCE_TIMEOUT)
  })

  test("abort mid-stream stops the turn without further events and closes the socket", async () => {
    const conn = fakeConn()
    const provider = providerWith(conn)
    await provider.prepare({ language: "en" })
    const abort = new AbortController()
    const source = (async function* () {
      let i = 0
      for (;;) {
        yield frame(i++)
        await new Promise((resolve) => setTimeout(resolve, 1))
      }
    })()
    const consume = collect(provider, source, abort.signal)
    conn.emit("session.created", {})
    await waitFor(() => conn.hasMessageType("session.update"))
    conn.emit("session.updated", {})
    await waitFor(() => conn.binaryCount() > 1)
    abort.abort()
    const events = await consume
    expect(events).toEqual([])
    expect(conn.closeCount).toBe(1)
  })

  test("dispose closes an active session socket", async () => {
    const conn = fakeConn()
    const provider = providerWith(conn)
    await provider.prepare({ language: "en" })
    const abort = new AbortController()
    const consume = collect(provider, frames(50), abort.signal)
    conn.emit("session.created", {})
    await waitFor(() => conn.hasMessageType("session.update"))
    conn.emit("session.updated", {})
    await waitFor(() => conn.binaryCount() > 0)
    abort.abort()
    await consume
    await provider.dispose()
    expect(conn.closeCount).toBe(1)
  })
})
