export type AudioCaptureOwner = "dictation" | "live" | "voice-clone"

export type AudioCaptureLease = {
  readonly id: number
  readonly owner: AudioCaptureOwner
  isCurrent(): boolean
  release(): void
}

type ActiveCapture = {
  lease: AudioCaptureLease
  stop: () => void
}

type AcquireRequest = {
  owner: AudioCaptureOwner
  stop: () => void
  lease?: AudioCaptureLease
  error?: unknown
}

const ACQUIRE_EVENT = "voice-microphone-acquire"
const PRIORITY: Record<AudioCaptureOwner, number> = {
  dictation: 1,
  "voice-clone": 1,
  live: 2,
}

export class AudioCaptureCoordinator {
  private active: ActiveCapture | undefined
  private nextLeaseId = 1

  acquire(owner: AudioCaptureOwner, stop: () => void): AudioCaptureLease | undefined {
    if (this.active && PRIORITY[this.active.lease.owner] >= PRIORITY[owner]) return undefined

    const previous = this.active
    this.active = undefined
    try {
      previous?.stop()
    } catch (error) {
      this.active = previous
      throw error
    }

    const lease: AudioCaptureLease = {
      id: this.nextLeaseId++,
      owner,
      isCurrent: () => this.active?.lease.id === lease.id,
      release: () => {
        if (this.active?.lease.id === lease.id) this.active = undefined
      },
    }
    this.active = { lease, stop }
    return lease
  }
}

export function requestAudioCapture(
  win: Window,
  owner: AudioCaptureOwner,
  stop: () => void,
): AudioCaptureLease | undefined {
  const detail: AcquireRequest = { owner, stop }
  win.dispatchEvent(new CustomEvent<AcquireRequest>(ACQUIRE_EVENT, { detail }))
  if (detail.error !== undefined) throw detail.error
  return detail.lease
}

export function cancelAudioCaptureRequest(
  lease: AudioCaptureLease | undefined,
  stream?: MediaStream,
): void {
  stream?.getTracks().forEach((track) => track.stop())
  lease?.release()
}

export async function acquireCurrentAudioStream(
  lease: AudioCaptureLease,
  acquire: () => Promise<MediaStream>,
): Promise<MediaStream | undefined> {
  const stream = await acquire()
  if (lease.isCurrent()) return stream
  cancelAudioCaptureRequest(undefined, stream)
  return undefined
}

// One coordinator per window. Two installs used to create two independent owners,
// so a capture could be granted by one and refused by the other depending on the
// order of the listeners.
const installations = new WeakMap<Window, { users: number; remove: () => void }>()

export function installAudioCaptureCoordinator(win: Window = window): () => void {
  const existing = installations.get(win)
  if (existing) {
    existing.users += 1
    return () => releaseInstallation(win)
  }
  const coordinator = new AudioCaptureCoordinator()
  const handleAcquire = (event: Event) => {
    const detail = (event as CustomEvent<AcquireRequest>).detail
    try {
      detail.lease = coordinator.acquire(detail.owner, detail.stop)
    } catch (error) {
      detail.error = error
    }
  }
  win.addEventListener(ACQUIRE_EVENT, handleAcquire)
  installations.set(win, {
    users: 1,
    remove: () => win.removeEventListener(ACQUIRE_EVENT, handleAcquire),
  })
  return () => releaseInstallation(win)
}

function releaseInstallation(win: Window) {
  const installation = installations.get(win)
  if (!installation) return
  installation.users -= 1
  if (installation.users > 0) return
  installations.delete(win)
  installation.remove()
}
