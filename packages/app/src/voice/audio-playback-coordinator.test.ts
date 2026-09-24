import { describe, expect, test } from "bun:test"
import { AudioPlaybackCoordinator } from "./audio-playback-coordinator"

describe("AudioPlaybackCoordinator", () => {
  test("a live playback interrupts manual and autoplay playback", () => {
    const coordinator = new AudioPlaybackCoordinator()
    const stopped: string[] = []
    const automatic = coordinator.acquire("autoplay", () => stopped.push("autoplay"))!
    const manual = coordinator.acquire("manual", () => stopped.push("manual"))!
    const live = coordinator.acquire("live", () => stopped.push("live"))!

    expect(stopped).toEqual(["autoplay", "manual"])
    expect(coordinator.isCurrent(automatic)).toBe(false)
    expect(coordinator.isCurrent(manual)).toBe(false)
    expect(coordinator.isCurrent(live)).toBe(true)
  })

  test("lower-priority autoplay cannot interrupt manual playback", () => {
    const coordinator = new AudioPlaybackCoordinator()
    const stopped: string[] = []
    const manual = coordinator.acquire("manual", () => stopped.push("manual"))!

    expect(coordinator.acquire("autoplay", () => stopped.push("autoplay"))).toBeUndefined()
    expect(coordinator.isCurrent(manual)).toBe(true)
    expect(stopped).toEqual([])
  })

  test("release from an interrupted playback cannot release its successor", () => {
    const coordinator = new AudioPlaybackCoordinator()
    const manual = coordinator.acquire("manual", () => undefined)!
    const live = coordinator.acquire("live", () => undefined)!

    coordinator.release(manual)

    expect(coordinator.isCurrent(live)).toBe(true)
  })
})
