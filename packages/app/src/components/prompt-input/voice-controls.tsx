/* SPDX-License-Identifier: MIT */
import type { LiveVoiceError, LiveVoiceState } from "@unifia/contracts/speech"
import { IconButton } from "@unifia/ui/icon-button"
import { showToast } from "@unifia/ui/toast"
import { Tooltip } from "@unifia/ui/tooltip"
import { createEffect, createSignal, on, onCleanup, type Component, type JSX } from "solid-js"
import type { useLanguage } from "@/context/language"
import { emitSpeech, onSpeech, speechEvents, type SpeechEndDetail } from "@/voice/speech-events"
import { isLiveActive } from "@/voice/live-state"
import { liveDetails, liveState } from "@/voice/live-store"
import { nativeVoiceKey } from "@/voice/native-voice-error"

type Language = ReturnType<typeof useLanguage>

/** Non-live dictation: record, transcribe, insert into the prompt, never submit. */
export function createDictation(language: Language) {
  const [recording, setRecording] = createSignal(false)
  const [level, setLevel] = createSignal(0)
  // The speech engine ends dictation on its own (silence, error, missing
  // browser support): leave the recording state and say why (web-speech.ts).
  const onSpeechEnded = (detail: SpeechEndDetail) => {
    if (detail.kind === "stt") setRecording(false)
    if (detail.reason === "done") return
    showToast({ title: language.t(detail.code ? nativeVoiceKey(detail) : `speech.${detail.reason}`) })
  }
  const onStartFailed = () => setRecording(false)
  // The microphone button breathes with the captured signal: quiet and sober,
  // instead of a decorative animation over the text.
  const onLevel = (detail: { level: number }) => setLevel(detail.level)
  const unsubscribes = [
    onSpeech(window, speechEvents.speechEnded, onSpeechEnded),
    onSpeech(window, speechEvents.sttStartFailed, onStartFailed),
    onSpeech(window, speechEvents.sttLevel, onLevel),
  ]
  onCleanup(() => {
    for (const unsubscribe of unsubscribes) unsubscribe()
  })
  return {
    recording,
    level,
    start() {
      emitSpeech(window, speechEvents.sttStart, undefined)
      setRecording(true)
    },
    /** Ends the recording; the runtime transcribes it and inserts the text. */
    stop() {
      emitSpeech(window, speechEvents.sttStop, undefined)
      setRecording(false)
    },
  }
}

export type Dictation = ReturnType<typeof createDictation>

const LIVE_ERROR_KEYS: Record<LiveVoiceError, string> = {
  microphone_denied: "prompt.live.error.microphoneDenied",
  microphone_unavailable: "prompt.live.error.microphoneUnavailable",
  voice_host_unavailable: "prompt.live.error.hostUnavailable",
  voice_host_lan_disabled: "prompt.live.error.lanDisabled",
  local_voice_unavailable: "prompt.live.error.localVoiceUnavailable",
  stt_unavailable: "prompt.live.error.sttUnavailable",
  tts_unavailable: "prompt.live.error.ttsUnavailable",
  agent_unavailable: "prompt.live.error.agentUnavailable",
  binding_invalid: "prompt.live.error.connectionLost",
  connection_lost: "prompt.live.error.connectionLost",
  rate_limited: "prompt.live.error.rateLimited",
  voice_internal_error: "prompt.live.error.unknown",
}

function liveStatusKey(state: LiveVoiceState): string {
  return `prompt.live.state.${state}`
}

export const VoiceControls: Component<{
  dictation: Dictation
  language: Language
  style: JSX.CSSProperties | undefined
}> = (props) => {
  const t = (key: string) => props.language.t(key as Parameters<Language["t"]>[0])
  const live = () => liveState()
  const active = () => isLiveActive(live())

  createEffect(
    on(
      () => liveDetails().error,
      (error) => {
        if (!error) return
        showToast({ title: t(LIVE_ERROR_KEYS[error.legacyCode]) })
      },
      { defer: true },
    ),
  )

  // A notice is a failure the conversation survived (a speech output that
  // stayed silent): the user still learns the reason, but Live keeps listening
  // until the next click.
  createEffect(
    on(
      () => liveDetails().notice,
      (notice) => {
        if (!notice) return
        showToast({ title: t(LIVE_ERROR_KEYS[notice.legacyCode]) })
      },
      { defer: true },
    ),
  )

  return (
    <>
      <Tooltip
        placement="top"
        value={
          active()
            ? t("prompt.live.dictationDisabled")
            : props.dictation.recording()
              ? t("prompt.stopRecording")
              : t("prompt.voiceInput")
        }
      >
        <IconButton
          data-action="prompt-stt-toggle"
          icon="microphone"
          variant={props.dictation.recording() ? "primary" : "ghost"}
          class="size-8"
          style={
            typeof props.style === "string"
              ? props.style
              : { ...props.style, transform: `scale(${1 + props.dictation.level() * 0.3})`, "transform-origin": "center" }
          }
          disabled={active()}
          aria-label={props.dictation.recording() ? t("prompt.stopRecording") : t("prompt.voiceInput")}
          onClick={(event: MouseEvent) => {
            event.preventDefault()
            event.stopPropagation()
            if (props.dictation.recording()) props.dictation.stop()
            else props.dictation.start()
          }}
        />
      </Tooltip>
      <span
        data-slot="prompt-live-status"
        role="status"
        aria-live="polite"
        class="text-12-regular text-text-weak whitespace-nowrap truncate max-w-28 max-sm:sr-only"
        classList={{ hidden: live() === "idle" }}
      >
        {live() === "idle" ? "" : t(liveStatusKey(live()))}
      </span>
    </>
  )
}
