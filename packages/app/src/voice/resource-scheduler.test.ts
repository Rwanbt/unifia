/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import {
  createVoiceResourceScheduler,
  preemptablePriorities,
  wouldPreempt,
  type VoiceResourceSchedulerOptions,
} from "./resource-scheduler"
import type { ResourceId } from "@unifia/contracts/voice-resource-scheduler"

interface FakeClock {
  value: number
  advance(ms: number): void
}

function makeClock(initial = 0): FakeClock {
  return {
    value: initial,
    advance(ms) {
      this.value += ms
    },
  }
}

function makeOptions(overrides: Partial<VoiceResourceSchedulerOptions> = {}): VoiceResourceSchedulerOptions {
  return {
    mode: "desktop",
    gpuOwnedBy: "none",
    npu: { available: false },
    now: () => 0,
    randomId: () => "abc",
    ...overrides,
  }
}

const vadResource: ResourceId = { kind: "vad", revision: "v6.2.2" }
const ttsResource: ResourceId = { kind: "tts", language: "fr" }
const sttResource: ResourceId = { kind: "stt", language: "fr" }
const preloadResource: ResourceId = { kind: "tts", language: "it" }
const audioResource: ResourceId = { kind: "aec", revision: "platform" }

describe("VoiceResourceScheduler", () => {
  test("acquires a lease when no holder exists", () => {
    const scheduler = createVoiceResourceScheduler(makeOptions())
    const lease = scheduler.acquire({
      resource: vadResource,
      owner: "silero-vad",
      priority: "vad-aec",
      residency: "keep-warm",
    })
    expect(lease).toBeDefined()
    expect(lease!.priority).toBe("vad-aec")
    expect(lease!.owner).toBe("silero-vad")
    expect(scheduler.list()).toHaveLength(1)
  })

  test("refuses a lower-or-equal priority acquisition against an active holder", () => {
    const scheduler = createVoiceResourceScheduler(makeOptions())
    const first = scheduler.acquire({
      resource: vadResource,
      owner: "silero-vad",
      priority: "vad-aec",
      residency: "keep-warm",
    })
    expect(first).toBeDefined()
    const second = scheduler.acquire({
      resource: vadResource,
      owner: "silero-vad",
      priority: "vad-aec",
      residency: "keep-warm",
    })
    expect(second).toBeUndefined()
    const third = scheduler.acquire({
      resource: vadResource,
      owner: "custom",
      priority: "preload",
      residency: "preload",
    })
    expect(third).toBeUndefined()
  })

  test("higher priority preempts an existing holder and emits an eviction event", () => {
    const scheduler = createVoiceResourceScheduler(makeOptions())
    const evicted: string[] = []
    scheduler.onEviction((event) => evicted.push(event.leaseId))
    scheduler.acquire({
      resource: vadResource,
      owner: "silero-vad",
      priority: "vad-aec",
      residency: "keep-warm",
    })
    const winner = scheduler.acquire({
      resource: vadResource,
      owner: "livekit",
      priority: "realtime-audio",
      residency: "keep-warm",
    })
    expect(winner).toBeDefined()
    expect(scheduler.list()).toHaveLength(1)
    expect(scheduler.list()[0].owner).toBe("livekit")
    expect(evicted).toHaveLength(1)
  })

  test("evicts preload leases under moderate memory pressure and leaves vad-aec alone", () => {
    const scheduler = createVoiceResourceScheduler(makeOptions())
    scheduler.acquire({
      resource: preloadResource,
      owner: "piper",
      priority: "preload",
      residency: "preload",
    })
    scheduler.acquire({
      resource: vadResource,
      owner: "silero-vad",
      priority: "vad-aec",
      residency: "keep-warm",
    })
    const evictions = scheduler.reportMemoryPressure({
      state: "moderate",
      observedAt: 1,
    })
    expect(evictions.map((e) => e.resource)).toEqual([preloadResource])
    expect(scheduler.list().map((l) => l.resource)).toEqual([vadResource])
  })

  test("critical memory pressure evicts preload + idle-evict but keeps realtime-audio + keep-warm", () => {
    const scheduler = createVoiceResourceScheduler(makeOptions())
    scheduler.acquire({
      resource: preloadResource,
      owner: "piper",
      priority: "preload",
      residency: "preload",
    })
    scheduler.acquire({
      resource: sttResource,
      owner: "parakeet-tdt",
      priority: "active-stt-tts",
      residency: "idle-evict",
    })
    scheduler.acquire({
      resource: vadResource,
      owner: "silero-vad",
      priority: "vad-aec",
      residency: "keep-warm",
    })
    scheduler.acquire({
      resource: audioResource,
      owner: "livekit",
      priority: "realtime-audio",
      residency: "keep-warm",
    })
    const evictions = scheduler.reportMemoryPressure({
      state: "critical",
      observedAt: 2,
    })
    const remaining = scheduler.list().map((l) => l.resource)
    expect(remaining).toContain(vadResource)
    expect(remaining).toContain(audioResource)
    expect(remaining).not.toContain(preloadResource)
    expect(remaining).not.toContain(sttResource)
    expect(evictions.length).toBe(2)
  })

  test("severe thermal pressure cancels preload but keeps vad-aec", () => {
    const scheduler = createVoiceResourceScheduler(makeOptions())
    scheduler.acquire({
      resource: preloadResource,
      owner: "piper",
      priority: "preload",
      residency: "preload",
    })
    scheduler.acquire({
      resource: vadResource,
      owner: "silero-vad",
      priority: "vad-aec",
      residency: "keep-warm",
    })
    const evictions = scheduler.reportThermal({
      status: "severe",
      observedAt: 3,
    })
    expect(evictions.map((e) => e.reason)).toEqual(["thermal-pressure"])
    expect(scheduler.list().map((l) => l.resource)).toEqual([vadResource])
  })

  test("realtime-audio leases are never evicted under any pressure", () => {
    const scheduler = createVoiceResourceScheduler(makeOptions())
    scheduler.acquire({
      resource: audioResource,
      owner: "livekit",
      priority: "realtime-audio",
      residency: "keep-warm",
    })
    for (const state of ["critical", "low-memory"] as const) {
      scheduler.reportMemoryPressure({ state, observedAt: 0 })
    }
    for (const status of ["severe", "critical", "emergency", "shutdown"] as const) {
      scheduler.reportThermal({ status, observedAt: 0 })
    }
    expect(scheduler.list().map((l) => l.resource)).toEqual([audioResource])
  })

  test("expires leases past their TTL when the clock advances", () => {
    const clock = makeClock(0)
    const scheduler = createVoiceResourceScheduler(makeOptions({ now: () => clock.value }))
    scheduler.acquire({
      resource: sttResource,
      owner: "parakeet-tdt",
      priority: "active-stt-tts",
      residency: "idle-evict",
      ttlMs: 100,
    })
    clock.advance(150)
    expect(scheduler.list()).toHaveLength(0)
  })

  test("release() makes the resource available again", () => {
    const scheduler = createVoiceResourceScheduler(makeOptions())
    const lease = scheduler.acquire({
      resource: vadResource,
      owner: "silero-vad",
      priority: "vad-aec",
      residency: "keep-warm",
    })
    expect(lease).toBeDefined()
    lease!.release()
    expect(scheduler.find(vadResource)).toBeUndefined()
    const second = scheduler.acquire({
      resource: vadResource,
      owner: "silero-vad",
      priority: "vad-aec",
      residency: "keep-warm",
    })
    expect(second).toBeDefined()
  })

  test("renew() extends the TTL", () => {
    const clock = makeClock(0)
    const scheduler = createVoiceResourceScheduler(makeOptions({ now: () => clock.value }))
    const lease = scheduler.acquire({
      resource: vadResource,
      owner: "silero-vad",
      priority: "vad-aec",
      residency: "keep-warm",
      ttlMs: 100,
    })
    expect(lease).toBeDefined()
    clock.advance(80)
    lease!.renew(200)
    clock.advance(150)
    expect(scheduler.find(vadResource)).toBeDefined()
  })

  test("abort signal before acquisition cancels the request", () => {
    const scheduler = createVoiceResourceScheduler(makeOptions())
    const abort = new AbortController()
    abort.abort()
    const lease = scheduler.acquire({
      resource: vadResource,
      owner: "silero-vad",
      priority: "vad-aec",
      residency: "keep-warm",
      signal: abort.signal,
    })
    expect(lease).toBeUndefined()
    expect(scheduler.list()).toHaveLength(0)
  })

  test("desktop + local-llm gpu ownership disables Voice VRAM allocation (ADR-074 §4)", () => {
    const scheduler = createVoiceResourceScheduler(
      makeOptions({ mode: "desktop", gpuOwnedBy: "local-llm" }),
    )
    expect(scheduler.gpuDisabled).toBe(true)
    const diag = scheduler.diagnostics()
    expect(diag.voiceGpuAllocBytes).toBe(0)
    expect(diag.gpuOwnedBy).toBe("local-llm")
  })

  test("mobile mode records npu capability in diagnostics", () => {
    const scheduler = createVoiceResourceScheduler(
      makeOptions({
        mode: "mobile",
        npu: { available: true, vendor: "qualcomm-hexagon", deviceId: "hexagon-v79" },
      }),
    )
    const diag = scheduler.diagnostics()
    expect(diag.mode).toBe("mobile")
    expect(diag.npu.available).toBe(true)
    expect(diag.npu.vendor).toBe("qualcomm-hexagon")
  })

  test("wouldPreempt matches the acquire rule", () => {
    const scheduler = createVoiceResourceScheduler(makeOptions())
    expect(wouldPreempt(scheduler, vadResource, "realtime-audio")).toBe(true)
    scheduler.acquire({
      resource: vadResource,
      owner: "silero-vad",
      priority: "vad-aec",
      residency: "keep-warm",
    })
    expect(wouldPreempt(scheduler, vadResource, "realtime-audio")).toBe(true)
    expect(wouldPreempt(scheduler, vadResource, "vad-aec")).toBe(false)
    expect(wouldPreempt(scheduler, vadResource, "preload")).toBe(false)
  })

  test("preemptablePriorities enumerates the eviction impact of an acquisition", () => {
    expect(preemptablePriorities("realtime-audio")).toEqual([
      "vad-aec",
      "active-stt-tts",
      "fast-decision",
      "preload",
    ])
    expect(preemptablePriorities("preload")).toEqual([])
    expect(preemptablePriorities("active-stt-tts")).toEqual(["fast-decision", "preload"])
  })

  test("list() returns wrappers that reflect renew/release through the scheduler view", () => {
    const clock = makeClock(0)
    const scheduler = createVoiceResourceScheduler(makeOptions({ now: () => clock.value }))
    const lease = scheduler.acquire({
      resource: vadResource,
      owner: "silero-vad",
      priority: "vad-aec",
      residency: "keep-warm",
      ttlMs: 100,
    })
    const listed = scheduler.list()
    expect(listed).toHaveLength(1)
    expect(listed[0].id).toBe(lease!.id)
    clock.advance(120)
    expect(scheduler.list()).toHaveLength(0)
  })

  test("onEviction listener fires for every eviction reason (memory, thermal, ttl)", () => {
    const clock = makeClock(0)
    const scheduler = createVoiceResourceScheduler(makeOptions({ now: () => clock.value }))
    const reasons: string[] = []
    scheduler.onEviction((event) => reasons.push(event.reason))
    // (a) preload model evicted by moderate memory pressure.
    scheduler.acquire({
      resource: preloadResource,
      owner: "piper",
      priority: "preload",
      residency: "preload",
    })
    scheduler.reportMemoryPressure({ state: "moderate", observedAt: 0 })
    // (b) second preload model evicted by severe thermal pressure.
    scheduler.acquire({
      resource: ttsResource,
      owner: "piper",
      priority: "preload",
      residency: "preload",
    })
    scheduler.reportThermal({ status: "severe", observedAt: 1 })
    // (c) idle-evict STT expires by TTL after the clock advances.
    scheduler.acquire({
      resource: sttResource,
      owner: "parakeet-tdt",
      priority: "active-stt-tts",
      residency: "idle-evict",
      ttlMs: 50,
    })
    clock.advance(60)
    scheduler.reportMemoryPressure({ state: "nominal", observedAt: 2 })
    expect(reasons).toContain("memory-pressure")
    expect(reasons).toContain("thermal-pressure")
    expect(reasons).toContain("ttl-expired")
  })
})
