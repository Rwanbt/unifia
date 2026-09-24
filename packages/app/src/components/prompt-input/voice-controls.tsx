/* SPDX-License-Identifier: MIT */
import type { LiveVoiceError, LiveVoiceState } from "@unifia/contracts/speech"
import { IconButton } from "@unifia/ui/icon-button"
import { showToast } from "@unifia/ui/toast"
import { Tooltip } from "@unifia/ui/tooltip"
import { createEffect, createSignal, on, onCleanup, Show, type Component, type JSX } from "solid-js"
import type { useLanguage } from "@/context/language"
import type { SpeechEndDetail } from "@/hooks/web-speech"
import type { LiveContext } from "@/voice/live-controller"
import { isLiveActive } from "@/voice/live-state"
import { liveController, liveDetails, liveState } from "@/voice/live-store"

type Language = ReturnType<typeof useLanguage>

/** Non-live dictation: record, transcribe, insert into the prompt, never submit. */
export function createDictation(language: Language) {
  const [recording, setRecording] = createSignal(false)
  // The speech engine ends dictation on its own (silence, error, missing
  // browser support): leave the recording state and say why (web-speech.ts).
  const onSpeechEnded = (event: Event) => {
    const detail = (event as CustomEvent<SpeechEndDetail>).detail
    if (detail.kind === "stt") setRecording(false)
    if (detail.reason === "done") return
    showToast({ title: language.t(`speech.${detail.reason}`) })
  }
  const onStartFailed = () => setRecording(false)
  window.addEventListener("speech-ended", onSpeechEnded)
  window.addEventListener("stt-start-failed", onStartFailed)
  onCleanup(() => {
    window.removeEventListener("speech-ended", onSpeechEnded)
    window.removeEventListener("stt-start-failed", onStartFailed)
  })
  return {
    recording,
    start() {
      window.dispatchEvent(new CustomEvent("stt-start"))
      setRecording(true)
    },
    /** Ends the recording; the runtime transcribes it and inserts the text. */
    stop() {
      window.dispatchEvent(new CustomEvent("stt-stop"))
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
  stt_unavailable: "prompt.live.error.sttUnavailable",
  tts_unavailable: "prompt.live.error.ttsUnavailable",
  agent_unavailable: "prompt.live.error.agentUnavailable",
  binding_invalid: "prompt.live.error.connectionLost",
  connection_lost: "prompt.live.error.connectionLost",
  rate_limited: "prompt.live.error.rateLimited",
  unknown: "prompt.live.error.unknown",
}

function liveStatusKey(state: LiveVoiceState): string {
  return `prompt.live.state.${state}`
}

export const VoiceControls: Component<{
  dictation: Dictation
  liveAvailable: boolean
  liveContext: () => LiveContext
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
        showToast({ title: t(LIVE_ERROR_KEYS[error] ?? LIVE_ERROR_KEYS.unknown) })
      },
      { defer: true },
    ),
  )

  const toggleLive = () => {
    const controller = liveController()
    if (active()) {
      void controller.stop()
      return
    }
    controller.reset()
    // Finalize a dictation in progress first: its text lands in the prompt,
    // then Live takes the microphone.
    if (props.dictation.recording()) props.dictation.stop()
    void controller.start(props.liveContext())
  }

  const liveLabel = () => (active() ? t("prompt.live.stop") : t("prompt.live.start"))

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
          style={props.style}
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
      <Show when={props.liveAvailable}>
        <Tooltip placement="top" value={active() ? t(liveStatusKey(live())) : liveLabel()}>
          <IconButton
            data-action="prompt-live-toggle"
            data-live-state={live()}
            icon="speaker"
            variant={active() ? "primary" : "ghost"}
            class="size-8 data-[live-state=connecting]:motion-safe:animate-pulse data-[live-state=reconnecting]:motion-safe:animate-pulse"
            style={props.style}
            aria-label={liveLabel()}
            aria-pressed={active()}
            onClick={(event: MouseEvent) => {
              event.preventDefault()
              event.stopPropagation()
              toggleLive()
            }}
          />
        </Tooltip>
      </Show>
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
