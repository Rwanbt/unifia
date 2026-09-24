export type AudioPlaybackPriority = "autoplay" | "manual" | "live"

export type AudioPlaybackLease = {
  readonly id: number
  readonly priority: AudioPlaybackPriority
}

const PRIORITY: Record<AudioPlaybackPriority, number> = {
  autoplay: 1,
  manual: 2,
  live: 3,
}

type ActivePlayback = {
  lease: AudioPlaybackLease
  stop: () => void
}

export class AudioPlaybackCoordinator {
  private active: ActivePlayback | undefined
  private nextLeaseId = 1

  acquire(priority: AudioPlaybackPriority, stop: () => void): AudioPlaybackLease | undefined {
    if (this.active && PRIORITY[this.active.lease.priority] > PRIORITY[priority]) return undefined

    const previous = this.active
    this.active = undefined
    previous?.stop()

    const lease = { id: this.nextLeaseId++, priority }
    this.active = { lease, stop }
    return lease
  }

  isCurrent(lease: AudioPlaybackLease): boolean {
    return this.active?.lease.id === lease.id
  }

  release(lease: AudioPlaybackLease): void {
    if (this.isCurrent(lease)) this.active = undefined
  }

  stop(): void {
    const previous = this.active
    this.active = undefined
    previous?.stop()
  }
}
