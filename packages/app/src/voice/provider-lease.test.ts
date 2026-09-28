/* SPDX-License-Identifier: MIT */
import { describe, it, expect } from "bun:test"
import { createVoiceResourceScheduler } from "./resource-scheduler"
import {
  acquireProviderLease,
  withProviderLease,
  leaseCountsByOwner,
  type ProviderLeaseHandle,
} from "./provider-lease"
import type { ProviderId, ResourceId } from "@unifia/contracts/voice-resource-scheduler"

const STT_RESOURCE: ResourceId = {
  kind: "stt",
  language: "en",
  revision: "v0",
}

const VAD_RESOURCE: ResourceId = { kind: "vad", language: "en" }

const FAST_RESOURCE: ResourceId = { kind: "fast-decision", language: "en" }

describe("provider-lease (G11 wiring)", () => {
  it("acquires a lease and releases on dispose", () => {
    const scheduler = createVoiceResourceScheduler({ mode: "mobile" })
    const handle = acquireProviderLease(scheduler, {
      resource: STT_RESOURCE,
      owner: "parakeet-tdt",
      priority: "active-stt-tts",
      residency: "idle-evict",
    })
    expect(handle).toBeDefined()
    expect(handle!.lease.released).toBe(false)
    expect(scheduler.list().length).toBe(1)
    handle!.dispose()
    expect(handle!.lease.released).toBe(true)
    expect(scheduler.list().length).toBe(0)
  })

  it("dispose is idempotent", () => {
    const scheduler = createVoiceResourceScheduler({ mode: "mobile" })
    const handle = acquireProviderLease(scheduler, {
      resource: STT_RESOURCE,
      owner: "parakeet-tdt",
      priority: "active-stt-tts",
      residency: "idle-evict",
    })!
    handle.dispose()
    handle.dispose()
    handle.dispose()
    expect(scheduler.list().length).toBe(0)
  })

  it("released handle reflects scheduler-side release", () => {
    const scheduler = createVoiceResourceScheduler({ mode: "mobile" })
    const handle = acquireProviderLease(scheduler, {
      resource: STT_RESOURCE,
      owner: "parakeet-tdt",
      priority: "active-stt-tts",
      residency: "idle-evict",
    })!
    expect(handle.released).toBe(false)
    handle.lease.release()
    expect(handle.released).toBe(true)
  })

  it("renew throws after dispose", () => {
    const scheduler = createVoiceResourceScheduler({ mode: "mobile" })
    const handle = acquireProviderLease(scheduler, {
      resource: STT_RESOURCE,
      owner: "parakeet-tdt",
      priority: "active-stt-tts",
      residency: "idle-evict",
    })!
    handle.dispose()
    expect(() => handle.renew()).toThrow()
  })

  it("returns undefined when the same resource is held by a higher-priority lease", () => {
    const scheduler = createVoiceResourceScheduler({ mode: "mobile" })
    const realtime = acquireProviderLease(scheduler, {
      resource: STT_RESOURCE,
      owner: "livekit",
      priority: "realtime-audio",
      residency: "keep-warm",
    })!
    const blocked = acquireProviderLease(scheduler, {
      resource: STT_RESOURCE,
      owner: "parakeet-tdt",
      priority: "active-stt-tts",
      residency: "idle-evict",
    })
    expect(blocked).toBeUndefined()
    realtime.dispose()
  })

  it("returns undefined when signal is pre-aborted", () => {
    const scheduler = createVoiceResourceScheduler({ mode: "mobile" })
    const ac = new AbortController()
    ac.abort()
    const handle = acquireProviderLease(
      scheduler,
      {
        resource: STT_RESOURCE,
        owner: "parakeet-tdt",
        priority: "active-stt-tts",
        residency: "idle-evict",
      },
      ac.signal,
    )
    expect(handle).toBeUndefined()
    expect(scheduler.list().length).toBe(0)
  })

  it("withProviderLease releases on completion", async () => {
    const scheduler = createVoiceResourceScheduler({ mode: "mobile" })
    const out = await withProviderLease(
      scheduler,
      {
        resource: STT_RESOURCE,
        owner: "parakeet-tdt",
        priority: "active-stt-tts",
        residency: "idle-evict",
      },
      async (h) => {
        expect(h.lease.released).toBe(false)
        return "ok"
      },
    )
    expect(out).toBe("ok")
    expect(scheduler.list().length).toBe(0)
  })

  it("withProviderLease releases on throw", async () => {
    const scheduler = createVoiceResourceScheduler({ mode: "mobile" })
    let caught = false
    try {
      await withProviderLease(
        scheduler,
        {
          resource: STT_RESOURCE,
          owner: "parakeet-tdt",
          priority: "active-stt-tts",
          residency: "idle-evict",
        },
        async () => {
          throw new Error("boom")
        },
      )
    } catch {
      caught = true
    }
    expect(caught).toBe(true)
    expect(scheduler.list().length).toBe(0)
  })

  it("withProviderLease returns undefined when acquire is blocked", async () => {
    const scheduler = createVoiceResourceScheduler({ mode: "mobile" })
    acquireProviderLease(scheduler, {
      resource: STT_RESOURCE,
      owner: "livekit",
      priority: "realtime-audio",
      residency: "keep-warm",
    })
    const out = await withProviderLease(
      scheduler,
      {
        resource: STT_RESOURCE,
        owner: "parakeet-tdt",
        priority: "active-stt-tts",
        residency: "idle-evict",
      },
      async () => "should-not-run",
    )
    expect(out).toBeUndefined()
    // The blocker from the first acquire is still active.
    expect(scheduler.list().length).toBe(1)
  })

  it("**no lease leak** under 1,000 acquire+dispose cycles", () => {
    const scheduler = createVoiceResourceScheduler({ mode: "mobile" })
    for (let i = 0; i < 1_000; i++) {
      const handle = acquireProviderLease(scheduler, {
        resource: { ...STT_RESOURCE, revision: `v${i}` },
        owner: "parakeet-tdt",
        priority: "active-stt-tts",
        residency: "idle-evict",
      })
      expect(handle).toBeDefined()
      handle!.dispose()
    }
    expect(scheduler.list().length).toBe(0)
    const counts = leaseCountsByOwner(scheduler)
    expect(counts.get("parakeet-tdt" satisfies ProviderId) ?? 0).toBe(0)
  })

  it("**no lease leak** under mixed concurrent providers", async () => {
    const scheduler = createVoiceResourceScheduler({ mode: "mobile" })
    const tasks: Array<Promise<unknown>> = []
    for (let i = 0; i < 200; i++) {
      tasks.push(
        withProviderLease(
          scheduler,
          {
            resource: { ...STT_RESOURCE, revision: `stt-${i}` },
            owner: "parakeet-tdt",
            priority: "active-stt-tts",
            residency: "idle-evict",
          },
          async () => i,
        ),
      )
      tasks.push(
        withProviderLease(
          scheduler,
          {
            resource: { ...VAD_RESOURCE, revision: `vad-${i}` },
            owner: "silero-vad",
            priority: "vad-aec",
            residency: "idle-evict",
          },
          async () => i,
        ),
      )
      tasks.push(
        withProviderLease(
          scheduler,
          {
            resource: { ...FAST_RESOURCE, revision: `fast-${i}` },
            owner: "rules-fast-decision",
            priority: "fast-decision",
            residency: "idle-evict",
          },
          async () => i,
        ),
      )
    }
    await Promise.all(tasks)
    expect(scheduler.list().length).toBe(0)
  })

  it("**no lease leak** when fn throws inside withProviderLease", async () => {
    const scheduler = createVoiceResourceScheduler({ mode: "mobile" })
    const promises: Array<Promise<unknown>> = []
    for (let i = 0; i < 100; i++) {
      promises.push(
        withProviderLease(
          scheduler,
          {
            resource: { ...STT_RESOURCE, revision: `throw-${i}` },
            owner: "parakeet-tdt",
            priority: "active-stt-tts",
            residency: "idle-evict",
          },
          async () => {
            throw new Error(`nope-${i}`)
          },
        ).catch(() => "caught"),
      )
    }
    await Promise.all(promises)
    expect(scheduler.list().length).toBe(0)
  })

  it("eviction listener fires when scheduler evicts under memory pressure", () => {
    const scheduler = createVoiceResourceScheduler({ mode: "mobile" })
    const evictions: string[] = []
    scheduler.onEviction((event) => evictions.push(event.leaseId))
    const preload = acquireProviderLease(scheduler, {
      resource: { kind: "stt", language: "en", revision: "preload-1" },
      owner: "parakeet-tdt",
      priority: "preload",
      residency: "preload",
    })!
    const keepWarm = acquireProviderLease(scheduler, {
      resource: { kind: "stt", language: "en", revision: "keep-warm-1" },
      owner: "livekit",
      priority: "active-stt-tts",
      residency: "keep-warm",
    })!
    scheduler.reportMemoryPressure({
      state: "moderate",
      observedAt: 1,
    })
    // preload was evicted; keep-warm was not
    expect(preload.released).toBe(true)
    expect(keepWarm.released).toBe(false)
    expect(evictions.length).toBe(1)
    keepWarm.dispose()
    expect(scheduler.list().length).toBe(0)
  })

  it("leaseCountsByOwner reflects live leases only", () => {
    const scheduler = createVoiceResourceScheduler({ mode: "mobile" })
    const a = acquireProviderLease(scheduler, {
      resource: { kind: "stt", language: "en", revision: "a" },
      owner: "parakeet-tdt",
      priority: "active-stt-tts",
      residency: "idle-evict",
    })!
    const b = acquireProviderLease(scheduler, {
      resource: { kind: "vad", language: "en" },
      owner: "silero-vad",
      priority: "vad-aec",
      residency: "idle-evict",
    })!
    acquireProviderLease(scheduler, {
      resource: { kind: "fast-decision", language: "en" },
      owner: "rules-fast-decision",
      priority: "fast-decision",
      residency: "idle-evict",
    })
    const counts = leaseCountsByOwner(scheduler)
    expect(counts.get("parakeet-tdt" satisfies ProviderId)).toBe(1)
    expect(counts.get("silero-vad" satisfies ProviderId)).toBe(1)
    expect(counts.get("rules-fast-decision" satisfies ProviderId)).toBe(1)
    a.dispose()
    b.dispose()
    expect(leaseCountsByOwner(scheduler).size).toBe(1)
  })

  it("desktop scheduler with gpuOwnedBy=local-llm reports gpuDisabled (no GPU lease side-effects)", () => {
    const scheduler = createVoiceResourceScheduler({
      mode: "desktop",
      gpuOwnedBy: "local-llm",
    })
    expect(scheduler.gpuDisabled).toBe(true)
    const handle = acquireProviderLease(scheduler, {
      resource: STT_RESOURCE,
      owner: "parakeet-tdt",
      priority: "active-stt-tts",
      residency: "idle-evict",
    })
    expect(handle).toBeDefined()
    handle!.dispose()
  })

  it("explicit eviction via listener (manual cancel)", () => {
    const scheduler = createVoiceResourceScheduler({ mode: "mobile" })
    const handle: ProviderLeaseHandle = acquireProviderLease(scheduler, {
      resource: STT_RESOURCE,
      owner: "parakeet-tdt",
      priority: "active-stt-tts",
      residency: "idle-evict",
    })!
    // Simulate "session ended — provider told to release"
    handle.dispose()
    expect(scheduler.list().length).toBe(0)
    expect(handle.released).toBe(true)
  })
})
