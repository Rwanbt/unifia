/* SPDX-License-Identifier: MIT */

/**
 * Typed names and payloads for the window events the voice shells share.
 *
 * The names used to be string literals scattered across the desktop, mobile and
 * web shells, with payloads cast by hand at every listener. A typo in a name
 * silently disconnected a listener, and a payload change broke callers only at
 * runtime. The table makes both the compiler's job.
 */

export type SpeechEndReason = "done" | "unsupported" | "denied" | "error"

export type SpeechEndDetail = {
  kind: "stt" | "tts"
  reason: SpeechEndReason
  /** Stable native code, when the failure came from an engine. */
  code?: string
}

export const speechEvents = {
  sttStart: "stt-start",
  sttStop: "stt-stop",
  speechEnded: "speech-ended",
  sttLevel: "stt-level",
  ttsToggle: "tts-toggle",
  ttsAutoplay: "tts-autoplay",
  ttsLiveStart: "tts-live-start",
  ttsLiveEnded: "tts-live-ended",
} as const

export type SpeechEventName = (typeof speechEvents)[keyof typeof speechEvents]

export type SpeechPayloads = {
  "stt-start": undefined
  "stt-stop": undefined
  "speech-ended": SpeechEndDetail
  "stt-level": { level: number }
  "tts-toggle": { text?: string }
  "tts-autoplay": { text?: string }
  "tts-live-start": { id?: string; stop?: () => void }
  "tts-live-ended": { id?: string }
}

/** Dispatches a typed speech event. */
export function emitSpeech<K extends SpeechEventName>(
  target: EventTarget,
  name: K,
  detail: SpeechPayloads[K],
): void {
  target.dispatchEvent(new CustomEvent(name, detail === undefined ? undefined : { detail }))
}

/** Listens for a typed speech event and returns the matching unsubscribe. */
export function onSpeech<K extends SpeechEventName>(
  target: EventTarget,
  name: K,
  handler: (detail: SpeechPayloads[K]) => void,
): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<SpeechPayloads[K]>).detail)
  target.addEventListener(name, listener)
  return () => target.removeEventListener(name, listener)
}
