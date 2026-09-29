/* SPDX-License-Identifier: MIT */
/**
 * Real streaming STT provider over the nemo-speech 0.1.0 realtime
 * protocol (campaign §20 — "streaming STT real provider, not mock").
 *
 * WHY a protocol shim: nemo-speech speaks a bespoke event protocol —
 * `session.created` → `session.update` → binary PCM16 frames →
 * `conversation.item.input_audio_transcription.delta` →
 * `input_audio_buffer.commit` → `…transcription.completed` (see
 * `.build-temp/g5-streaming/api.md` and the proven bake-off client
 * `scripts/voice/g5_streaming_bakeoff.py`) — so the canonical
 * StreamingSttProvider contract is mapped onto that wire here; nothing
 * else in the app speaks it.
 *
 * Known nemo-speech 0.1.0 defect (STREAMING_STT_ERROR_CODES.EMPTY_FINAL):
 * the streaming path committed 7/91 corpus fixtures to an empty final
 * over non-trivial audio (offline C++ recovers 5 of them). This
 * provider re-transcribes such turns through the offline endpoint and
 * reports the defect as a recovered ProviderError — when the
 * route-around fails it stays honest and emits an empty final instead
 * of fabricating text (campaign §39: do not make a red gate green by
 * changing expected output to the broken output).
 */

import { speechLanguages, type SpeechLanguage } from "@unifia/contracts/speech"
import {
  STREAMING_STT_ERROR_CODES,
  type PcmFrame,
  type ProviderError,
  type StreamingSttCapabilities,
  type StreamingSttConfig,
  type StreamingSttEvent,
  type StreamingSttProvider,
} from "@unifia/contracts/streaming-stt"
import { createPcmBuffer, PCM_TURN_SECONDS, type PcmBuffer } from "./pcm-buffer"
import {
  nemoDeps,
  NEMO_DEFAULT_ENDPOINT,
  wsUrl,
  type NemoDeps,
  type NemoSocket,
} from "./nemo-transport"
import { fault, last, part } from "./stt-events"
import { messageOf, raised } from "./stt-errors"

const {
  AUDIO_FORMAT_UNSUPPORTED,
  EMPTY_FINAL,
  INFERENCE_TIMEOUT,
  LANGUAGE_UNSUPPORTED,
  MODEL_CRASHED,
  PROVIDER_LOAD_FAILED,
} = STREAMING_STT_ERROR_CODES

/** nemo-speech documents 15 s session handshakes in its reference
 *  client; the final-transcript wait defaults to 5 s unless the
 *  consumer passes `finalTimeoutMs`. */
const HANDSHAKE_MS = 15_000
const FINAL_MS = 5_000
const MIN_RATE = 8_000
const MAX_RATE = 96_000
/** Empty finals are only treated as a defect above this much committed
 *  audio — below it (silence, a too-short utterance) an empty final is
 *  the honest result, not a runtime failure. */
const ROUTE_AROUND_MS = 320

export interface NemoOptions {
  /** Overrides the default loopback endpoint (tests, remote hosts). */
  readonly endpoint?: string
  /** Overrides the five-language nominal set. */
  readonly languages?: readonly SpeechLanguage[]
}

type Wire =
  | { readonly kind: "event"; readonly value: Record<string, unknown> }
  | { readonly kind: "closed"; readonly detail: string }

interface Queue {
  take(timeoutMs: number, signal?: AbortSignal): Promise<Wire | undefined>
  drain(): Wire[]
}

interface State {
  readonly rate: number
  readonly pcm: PcmBuffer
  readonly text: string
  readonly sent: number
  readonly from: number
  readonly to: number
  readonly at: number
  readonly early: string | undefined
}

interface Turn {
  readonly conn: NemoSocket
  readonly frames: AsyncIterable<PcmFrame>
  readonly signal: AbortSignal
  readonly active: StreamingSttConfig
  readonly deps: NemoDeps
}

type Read =
  | { readonly kind: "fault"; readonly code: string; readonly detail: string }
  | { readonly kind: "partial"; readonly text: string }
  | { readonly kind: "final"; readonly text: string }
  | { readonly kind: "ignore" }

/**
 * Fold one server delta onto the accumulated hypothesis.
 *
 * nemo-speech 0.1.0's exact delta semantics were not proven by the
 * bake-off (its cumulative metric appended by construction, so any
 * interpretation passed): this accepts all three shapes observed in
 * reference clients — absolute growth, absolute revision, and raw
 * fragment append. Verified live by the gated e2e harness.
 */
function fold(prev: string, delta: string): string {
  if (!delta) return prev
  if (!prev) return delta
  if (delta.startsWith(prev)) return delta
  if (prev.startsWith(delta)) return delta
  return prev + delta
}

function queue(sock: NemoSocket): Queue {
  const backlog: Wire[] = []
  let wake: (() => void) | undefined
  let dead = ""
  const knock = () => {
    const fn = wake
    wake = undefined
    fn?.()
  }
  sock.onMessage((raw) => {
    if (!raw) return
    try {
      backlog.push({ kind: "event", value: JSON.parse(raw) as Record<string, unknown> })
    } catch {
      // Non-JSON frames are not part of the protocol; dropping keeps a
      // malformed server frame from desynchronizing the turn machine.
    }
    knock()
  })
  sock.onClose((why) => {
    if (!dead) dead = why || "socket closed"
    knock()
  })
  sock.onError((why) => {
    if (!dead) dead = why || "socket error"
    knock()
  })
  return {
    drain: () => backlog.splice(0),
    take: async (timeoutMs, signal) => {
      const deadline = Date.now() + Math.max(0, timeoutMs)
      while (!backlog.length) {
        // Abort must wake a pending wait immediately — otherwise a
        // cancelled turn would stall for the full timeout (lesson from
        // the async-generator + abort-signal contract).
        if (signal?.aborted) return undefined
        if (dead) return { kind: "closed", detail: dead }
        const left = deadline - Date.now()
        if (left <= 0) return undefined
        await new Promise<void>((resolve) => {
          // Both a server frame and an abort must wake this wait —
          // checking `aborted` only at loop top would still stall for
          // the whole timeout when cancellation arrives mid-wait.
          const stop = () => {
            clearTimeout(timer)
            signal?.removeEventListener("abort", stop)
            resolve()
          }
          const timer = setTimeout(stop, left)
          wake = stop
          signal?.addEventListener("abort", stop, { once: true })
        })
      }
      return backlog.shift()
    },
  }
}

/** Consume events until `match` sees one; protocol noise before the
 *  awaited handshake frame is dropped rather than wedging setup. */
async function until(
  q: Queue,
  match: (value: Record<string, unknown>) => boolean,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Wire | undefined> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const wire = await q.take(deadline - Date.now(), signal)
    if (!wire || wire.kind === "closed") return wire
    if (match(wire.value)) return wire
  }
}

function read(wire: Wire, acc: string): Read {
  if (wire.kind === "closed") return { kind: "fault", code: MODEL_CRASHED, detail: wire.detail }
  const type = typeOf(wire.value)
  if (type === "error") return { kind: "fault", code: MODEL_CRASHED, detail: detailOf(wire.value) }
  if (type.endsWith("transcription.delta")) {
    const next = fold(acc, deltaOf(wire.value))
    if (next === acc) return { kind: "ignore" }
    return { kind: "partial", text: next }
  }
  if (type.endsWith("transcription.completed")) return { kind: "final", text: finalOf(wire.value) }
  return { kind: "ignore" }
}

const typeOf = (value: Record<string, unknown>): string =>
  typeof value.type === "string" ? value.type : ""
const deltaOf = (value: Record<string, unknown>): string =>
  typeof value.delta === "string" ? value.delta : ""
const finalOf = (value: Record<string, unknown>): string => {
  if (typeof value.transcript === "string") return value.transcript.trim()
  if (typeof value.text === "string") return value.text.trim()
  return ""
}

function detailOf(value: Record<string, unknown>): string {
  const err = value.error as Record<string, unknown> | undefined
  const code = err && typeof err.code === "string" ? err.code : typeOf(value)
  const message = err && typeof err.message === "string" ? err.message : JSON.stringify(value)
  return `${code}: ${message}`.slice(0, 400)
}

async function handshake(
  q: Queue,
  signal?: AbortSignal,
): Promise<ProviderError | undefined> {
  const wire = await until(q, (value) => {
    const type = typeOf(value)
    return type === "session.created" || type === "error"
  }, HANDSHAKE_MS, signal)
  if (!wire) return fault(PROVIDER_LOAD_FAILED, "nemo-speech sent no session.created", 0)
  if (wire.kind === "closed") return fault(PROVIDER_LOAD_FAILED, `session handshake: ${wire.detail}`, 0)
  if (typeOf(wire.value) === "error") {
    return fault(MODEL_CRASHED, `session handshake: ${detailOf(wire.value)}`, 0)
  }
  return undefined
}

/** Send `session.update` with the first frame's rate — the server
 *  rejects configuration once audio has started, so this must precede
 *  the first binary frame (api.md: "session configuration is
 *  immutable after the first audio frame"). */
async function configure(
  conn: NemoSocket,
  q: Queue,
  rate: number,
  active: StreamingSttConfig,
  at: number,
  signal?: AbortSignal,
): Promise<ProviderError | undefined> {
  if (rate < MIN_RATE || rate > MAX_RATE) {
    return fault(
      AUDIO_FORMAT_UNSUPPORTED,
      `sample rate ${rate} Hz outside nemo-speech ${MIN_RATE}-${MAX_RATE} Hz range`,
      at,
    )
  }
  conn.send(
    JSON.stringify({
      type: "session.update",
      session: { sample_rate: rate, language: active.language, automatic_punctuation: true },
    }),
  )
  const wire = await until(q, (value) => {
    const type = typeOf(value)
    return type === "session.updated" || type === "error"
  }, HANDSHAKE_MS, signal)
  if (!wire) return fault(MODEL_CRASHED, "nemo-speech sent no session.updated", at)
  if (wire.kind === "closed") return fault(MODEL_CRASHED, `session configure: ${wire.detail}`, at)
  if (typeOf(wire.value) === "error") {
    return fault(MODEL_CRASHED, `session configure: ${detailOf(wire.value)}`, at)
  }
  return undefined
}

async function* pump(
  turn: Turn,
  q: Queue,
): AsyncGenerator<StreamingSttEvent, State | undefined> {
  // Sized by the maximum accepted rate: one cap is valid for any
  // frame rate and stays a runaway bound (~11.5 MB) — legitimate turns
  // hold <= 60 s of audio (PCM_TURN_SECONDS).
  const pcm = createPcmBuffer(MAX_RATE * PCM_TURN_SECONDS)
  let rate = 0
  let text = ""
  let sent = 0
  let from = -1
  let to = -1
  let at = 0
  let early: string | undefined

  for await (const frame of turn.frames) {
    if (turn.signal.aborted) return undefined
    if (frame.samples.length === 0) continue
    if (!rate) {
      const bad = await configure(
        turn.conn,
        q,
        frame.sampleRateHz,
        turn.active,
        frame.capturedAt,
        turn.signal,
      )
      if (turn.signal.aborted) return undefined
      if (bad) {
        yield bad
        return undefined
      }
      rate = frame.sampleRateHz
    }
    if (frame.sampleRateHz !== rate) {
      yield fault(
        AUDIO_FORMAT_UNSUPPORTED,
        `mixed sample rates in one turn: ${rate} then ${frame.sampleRateHz} Hz`,
        frame.capturedAt,
      )
      return undefined
    }
    turn.conn.send(bytesOf(frame.samples))
    sent += frame.samples.length
    pcm.push(frame.samples)
    if (from < 0) from = frame.sequence
    to = frame.sequence
    at = frame.capturedAt
    for (const wire of q.drain()) {
      const seen = read(wire, text)
      if (seen.kind === "fault") {
        yield fault(seen.code, seen.detail, at)
        return undefined
      }
      if (seen.kind === "final") {
        early = seen.text
        continue
      }
      if (seen.kind !== "partial") continue
      text = seen.text
      yield part(text, turn.active.language, at, to)
    }
  }
  if (turn.signal.aborted) return undefined
  return { rate, pcm, text, sent, from, to, at, early }
}

async function* finish(turn: Turn, q: Queue, state: State): AsyncGenerator<StreamingSttEvent> {
  const { active, signal, conn, deps } = turn
  const { rate, pcm, sent, from, to, at, early } = state
  if (signal.aborted) return
  if (from < 0) {
    yield last("", active.language, at, 0, 0)
    return
  }

  let acc = state.text
  let done = early
  if (done === undefined) {
    conn.send(JSON.stringify({ type: "input_audio_buffer.commit" }))
    const limit = active.finalTimeoutMs ?? FINAL_MS
    const deadline = Date.now() + limit
    while (done === undefined) {
      if (signal.aborted) return
      const wire = await q.take(deadline - Date.now(), signal)
      if (signal.aborted) return
      if (!wire) {
        yield fault(INFERENCE_TIMEOUT, `nemo-speech produced no final within ${limit} ms`, at)
        return
      }
      const seen = read(wire, acc)
      if (seen.kind === "fault") {
        yield fault(seen.code, seen.detail, at)
        return
      }
      if (seen.kind === "final") {
        done = seen.text
        break
      }
      if (seen.kind !== "partial") continue
      acc = seen.text
      yield part(acc, active.language, at, to)
    }
  }
  if (signal.aborted) return

  let out = done ?? ""
  if (out === "" && sent >= Math.floor((rate * ROUTE_AROUND_MS) / 1000) && deps.offline) {
    let alt = ""
    let failure = ""
    try {
      alt = (await deps.offline({ samples: pcm.concat(), sampleRateHz: rate }, active, signal)).trim()
    } catch (error) {
      failure = messageOf(error)
    }
    if (signal.aborted) return
    if (failure) {
      yield fault(EMPTY_FINAL, `streaming final empty; offline route-around failed: ${failure}`, at)
      yield last("", active.language, at, from, to)
      return
    }
    if (alt) {
      yield fault(
        EMPTY_FINAL,
        "streaming final empty over non-trivial audio; recovered via offline transcription",
        at,
        true,
      )
      out = alt
    }
  }
  yield last(out, active.language, at, from, to)
}

async function* turn(input: Turn): AsyncGenerator<StreamingSttEvent> {
  const q = queue(input.conn)
  const bad = await handshake(q, input.signal)
  if (input.signal.aborted) return
  if (bad) {
    yield bad
    return
  }
  const state = yield* pump(input, q)
  if (!state) return
  yield* finish(input, q, state)
}

function bytesOf(samples: Int16Array): Uint8Array {
  // The WebSocket serializes synchronously, so a view over the frame
  // buffer needs no copy — frames are immutable readonly snapshots.
  return new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
}

/** Real streaming STT provider backed by a nemo-speech server.
 *
 *  Inject `NemoDeps` for tests; production passes `nemoDeps()`. */
export function createNemoStreamingSttProvider(
  deps: NemoDeps = nemoDeps(),
  options: NemoOptions = {},
): StreamingSttProvider {
  const base = options.endpoint ?? NEMO_DEFAULT_ENDPOINT
  const languages = options.languages ?? speechLanguages
  const capabilities: StreamingSttCapabilities = {
    providerId: "nemotron-streaming",
    languages,
    partials: true,
    retraction: true,
    confidence: false,
    // G5 bake-off evidence (g5-nemotron-full.json): first delta
    // 1242.8 ms mean wall; final 171.0 ms mean / 195.7 ms p95.
    partialLatencyMs: 1_300,
    finalLatencyMs: 200,
  }
  let cfg: StreamingSttConfig | undefined
  let open: NemoSocket | undefined

  return {
    id: "nemotron-streaming",
    capabilities,
    async prepare(next, signal) {
      if (signal?.aborted) throw raised(PROVIDER_LOAD_FAILED, "nemo streaming STT: prepare aborted")
      if (!languages.includes(next.language)) {
        throw raised(LANGUAGE_UNSUPPORTED, `nemo-speech provider does not offer "${next.language}"`)
      }
      cfg = next
      if (!deps.probe) return
      let ready = false
      let cause = ""
      try {
        ready = await deps.probe(base, signal)
      } catch (error) {
        if (signal?.aborted) throw raised(PROVIDER_LOAD_FAILED, "nemo streaming STT: prepare aborted")
        cause = `: ${messageOf(error)}`
      }
      if (signal?.aborted) throw raised(PROVIDER_LOAD_FAILED, "nemo streaming STT: prepare aborted")
      if (!ready) {
        throw raised(PROVIDER_LOAD_FAILED, `nemo-speech runtime not ready at ${base}${cause}`)
      }
    },
    async *transcribe(frames, signal) {
      const active = cfg
      if (!active) throw new Error("nemo streaming STT: prepare() must run before transcribe()")
      if (signal.aborted) return
      let conn: NemoSocket
      try {
        conn = await deps.connect(wsUrl(base), signal)
      } catch (error) {
        if (signal.aborted) return
        yield fault(PROVIDER_LOAD_FAILED, `nemo-speech connect failed: ${messageOf(error)}`, 0)
        return
      }
      open = conn
      try {
        yield* turn({ conn, frames, signal, active, deps })
      } finally {
        open = undefined
        conn.close()
      }
    },
    async dispose() {
      open?.close()
      open = undefined
    },
  }
}
