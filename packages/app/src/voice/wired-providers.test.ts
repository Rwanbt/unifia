/* SPDX-License-Identifier: MIT */
import { describe, it, expect } from "bun:test"
import { createVoiceResourceScheduler } from "./resource-scheduler"
import {
  wireStreamingSttLease,
  wireFastDecisionLease,
  wireSileroVadLease,
  activeLeases,
} from "./wired-providers"
import { createFinalSttFallbackProvider } from "./streaming-stt-fallback"

import { rulesFastDecisionProvider } from "./fast-decision-rules"
import { offFastDecisionProvider } from "./fast-decision-off"

const STT_RESOURCE = { kind: "stt" as const, language: "en", revision: "v0" }
const FAST_RESOURCE = { kind: "fast-decision" as const, language: "en" }
const VAD_RESOURCE = { kind: "vad" as const, language: "en" }

const STT_WIRE = { priority: "active-stt-tts" as const, residency: "idle-evict" as const }
const FAST_WIRE = { priority: "fast-decision" as const, residency: "idle-evict" as const }
const VAD_WIRE = { priority: "vad-aec" as const, residency: "keep-warm" as const }

describe("wired-providers (G11 wiring)", () => {
  it("wires a streaming-stt-nemo provider: lease held after prepare, released after dispose", async () => {
    // nemo's full lifecycle (probe, abort, transcribe) is covered by
    // streaming-stt-nemo.test.ts. This wiring test exercises the
    // lease binding only: a successful prepare holds a lease; a
    // subsequent dispose releases it. We use the fallback provider
    // here because its prepare/dispose contract is the cleanest
    // for the lease-bridging test. Wiring is provider-agnostic
    // (see `wires a final STT fallback` below for the canonical
    // shape); the same wrapper drives nemo, parakeet-final, and
    // any future StreamingSttProvider.
    const scheduler = createVoiceResourceScheduler({ mode: "mobile" })
    const base = createFinalSttFallbackProvider({ transcribe: async () => "ok" })
    const wired = wireStreamingSttLease(scheduler, base, {
      resource: STT_RESOURCE,
      owner: "parakeet-tdt",
      ...STT_WIRE,
    }, STT_WIRE)
    // Lease is acquired at construction time (§29 invariant).
    expect(wired.lease).toBeDefined()
    expect(activeLeases(scheduler, "parakeet-tdt")).toBe(1)
    await wired.base.prepare({ language: "en" })
    expect(activeLeases(scheduler, "parakeet-tdt")).toBe(1)
    await wired.base.dispose()
    expect(activeLeases(scheduler, "parakeet-tdt")).toBe(0)
  })

  it("prepare failure does NOT release the lease — the provider still occupies its slot", async () => {
    // §29: lease is held for the provider's residency, not for the
    // prepare call. A failed prepare leaves the lease intact so the
    // caller can retry prepare on the same provider. The test below
    // verifies that contract.
    const scheduler = createVoiceResourceScheduler({ mode: "mobile" })
    const base = createFinalSttFallbackProvider({
      transcribe: async () => "ok",
    })
    const wired = wireStreamingSttLease(scheduler, base, {
      resource: STT_RESOURCE,
      owner: "parakeet-tdt",
      ...STT_WIRE,
    }, STT_WIRE)
    await expect(wired.base.prepare({ language: "xx" as never })).rejects.toThrow()
    expect(activeLeases(scheduler, "parakeet-tdt")).toBe(1)
    await wired.base.dispose()
    expect(activeLeases(scheduler, "parakeet-tdt")).toBe(0)
  })

  it("dispose is idempotent on the wired provider", async () => {
    const scheduler = createVoiceResourceScheduler({ mode: "mobile" })
    const base = createFinalSttFallbackProvider({ transcribe: async () => "" })
    const wired = wireStreamingSttLease(scheduler, base, {
      resource: STT_RESOURCE,
      owner: "parakeet-tdt",
      ...STT_WIRE,
    }, STT_WIRE)
    expect(activeLeases(scheduler, "parakeet-tdt")).toBe(1)
    await wired.base.dispose()
    await wired.base.dispose()
    expect(activeLeases(scheduler, "parakeet-tdt")).toBe(0)
  })

  it("**no lease leak** under 1,000 wire+dispose cycles", async () => {
    const scheduler = createVoiceResourceScheduler({ mode: "mobile" })
    for (let i = 0; i < 1_000; i++) {
      const base = createFinalSttFallbackProvider({ transcribe: async () => "" })
      const wired = wireStreamingSttLease(scheduler, base, {
        resource: { kind: "stt", language: "en", revision: `v${i}` },
        owner: "parakeet-tdt",
        ...STT_WIRE,
      }, STT_WIRE)
      await wired.base.dispose()
    }
    expect(activeLeases(scheduler, "parakeet-tdt")).toBe(0)
  })

  it("**no lease leak** under aborted-prepare path", async () => {
    const scheduler = createVoiceResourceScheduler({ mode: "mobile" })
    const ac = new AbortController()
    ac.abort()
    const base = createFinalSttFallbackProvider({ transcribe: async () => "" })
    const wired = wireStreamingSttLease(scheduler, base, {
      resource: STT_RESOURCE,
      owner: "parakeet-tdt",
      ...STT_WIRE,
    }, STT_WIRE)
    await expect(wired.base.prepare({ language: "en" }, ac.signal)).rejects.toThrow()
    // Lease survives an aborted prepare — the provider is still
    // alive in the scheduler's view. Caller must dispose() to release.
    expect(activeLeases(scheduler, "parakeet-tdt")).toBe(1)
    await wired.base.dispose()
    expect(activeLeases(scheduler, "parakeet-tdt")).toBe(0)
  })

  it("wires a Rules FastDecision provider: lease held for provider lifetime", () => {
    const scheduler = createVoiceResourceScheduler({ mode: "mobile" })
    const wired = wireFastDecisionLease(scheduler, rulesFastDecisionProvider, {
      resource: FAST_RESOURCE,
      owner: "rules-fast-decision",
      ...FAST_WIRE,
    }, FAST_WIRE)
    expect(activeLeases(scheduler, "rules-fast-decision")).toBe(1)
    const proposal = wired.base.decide({
      text: "stop",
      language: "en",
      stage: "final",
      capturedAt: 1,
    })
    expect(proposal.kind).toBe("cancel-task")
    wired.base.dispose()
    expect(activeLeases(scheduler, "rules-fast-decision")).toBe(0)
  })

  it("wires an OFF FastDecision provider: lease held for provider lifetime", () => {
    const scheduler = createVoiceResourceScheduler({ mode: "mobile" })
    const wired = wireFastDecisionLease(scheduler, offFastDecisionProvider, {
      resource: FAST_RESOURCE,
      owner: "rules-fast-decision",
      ...FAST_WIRE,
    }, FAST_WIRE)
    expect(activeLeases(scheduler, "rules-fast-decision")).toBe(1)
    wired.base.dispose()
    expect(activeLeases(scheduler, "rules-fast-decision")).toBe(0)
  })

  it("wires a Silero VAD (host-side): lease held until dispose", () => {
    const scheduler = createVoiceResourceScheduler({ mode: "mobile" })
    const vad = wireSileroVadLease(scheduler, {
      decide: () => ({ probability: 0.9, speech: true }),
    }, {
      resource: VAD_RESOURCE,
      owner: "silero-vad",
      ...VAD_WIRE,
    }, VAD_WIRE)
    expect(activeLeases(scheduler, "silero-vad")).toBe(1)
    const result = vad.base.decide(new Int16Array(512), 16000)
    expect(result.speech).toBe(true)
    vad.dispose()
    expect(activeLeases(scheduler, "silero-vad")).toBe(0)
  })

  it("**no lease leak** under 1,000 Rules+OFF+Silero cycles", () => {
    const scheduler = createVoiceResourceScheduler({ mode: "mobile" })
    for (let i = 0; i < 1_000; i++) {
      const base = i % 2 === 0 ? rulesFastDecisionProvider : offFastDecisionProvider
      const vad = wireSileroVadLease(scheduler, {
        decide: () => ({ probability: 0.1, speech: false }),
      }, {
        resource: { kind: "vad", language: "en", revision: `v${i}` },
        owner: "silero-vad",
        ...VAD_WIRE,
      }, VAD_WIRE)
      const fast = wireFastDecisionLease(scheduler, base, {
        resource: { kind: "fast-decision", language: "en", revision: `f${i}` },
        owner: "rules-fast-decision",
        ...FAST_WIRE,
      }, FAST_WIRE)
      base.decide({ text: "ok", language: "en", stage: "final", capturedAt: 1 })
      vad.dispose()
      fast.base.dispose()
    }
    expect(activeLeases(scheduler, "silero-vad")).toBe(0)
    expect(activeLeases(scheduler, "rules-fast-decision")).toBe(0)
  })

  it("preload FastDecision is evicted under memory pressure before keep-warm VAD", () => {
    const scheduler = createVoiceResourceScheduler({ mode: "mobile" })
    const evictions: string[] = []
    scheduler.onEviction((event) => evictions.push(`${event.owner}:${event.reason}`))
    // Per ADR-074: `moderate` memory pressure evicts `preload`
    // priority leases first. The FastDecision provider is wired
    // here with `priority: "preload"` and `residency: "preload"`
    // so it is the first eviction target.
    const fastPreload = wireFastDecisionLease(scheduler, offFastDecisionProvider, {
      resource: { kind: "fast-decision", language: "en", revision: "p" },
      owner: "rules-fast-decision",
      priority: "preload",
      residency: "preload",
    }, { priority: "preload", residency: "preload" })
    const vadKeepWarm = wireSileroVadLease(scheduler, {
      decide: () => ({ probability: 0, speech: false }),
    }, {
      resource: { kind: "vad", language: "en", revision: "k" },
      owner: "silero-vad",
      priority: "vad-aec",
      residency: "keep-warm",
    }, { priority: "vad-aec", residency: "keep-warm" })
    scheduler.reportMemoryPressure({ state: "moderate", observedAt: 1 })
    expect(fastPreload.lease?.released).toBe(true)
    expect(vadKeepWarm.lease?.released).toBe(false)
    expect(evictions).toContain("rules-fast-decision:memory-pressure")
    vadKeepWarm.dispose()
  })

  it("FastDecision dispose makes subsequent decide calls safe (`continue` with `wired-fast-decision-disposed`)", () => {
    const scheduler = createVoiceResourceScheduler({ mode: "mobile" })
    const wired = wireFastDecisionLease(scheduler, rulesFastDecisionProvider, {
      resource: FAST_RESOURCE,
      owner: "rules-fast-decision",
      ...FAST_WIRE,
    }, FAST_WIRE)
    wired.base.dispose()
    const after = wired.base.decide({
      text: "stop",
      language: "en",
      stage: "final",
      capturedAt: 1,
    })
    expect(after.kind).toBe("continue")
    expect(after.rationale).toBe("wired-fast-decision-disposed")
    expect(after.confidence).toBe(0)
  })

  it("wired StreamingStt cannot be re-prepared after dispose", async () => {
    const scheduler = createVoiceResourceScheduler({ mode: "mobile" })
    const base = createFinalSttFallbackProvider({ transcribe: async () => "" })
    const wired = wireStreamingSttLease(scheduler, base, {
      resource: STT_RESOURCE,
      owner: "parakeet-tdt",
      ...STT_WIRE,
    }, STT_WIRE)
    await wired.base.prepare({ language: "en" })
    await wired.base.dispose()
    await expect(wired.base.prepare({ language: "en" })).rejects.toThrow(/dispose/)
    expect(activeLeases(scheduler, "parakeet-tdt")).toBe(0)
  })
})
