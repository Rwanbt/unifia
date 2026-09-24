import { type Component, createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import { Switch } from "@unifia/ui/switch"
import { Select } from "@unifia/ui/select"
import { Button } from "@unifia/ui/button"
import { IconButton } from "@unifia/ui/icon-button"
import { Tooltip } from "@unifia/ui/tooltip"
import { showToast } from "@unifia/ui/toast"
import { SettingsPage, SettingsSection } from "./settings-page"
import { SettingsRow } from "./settings-row"
import { createStore } from "solid-js/store"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import {
  loadAudioSettings as loadVoiceSettings,
  saveAudioSettings,
  type AudioSettingsV2,
} from "@/voice/audio-settings"
import { requestAudioCapture, type AudioCaptureLease } from "@/voice/audio-capture-coordinator"

export type AudioSettings = AudioSettingsV2

// Pocket TTS voices (Les Misérables + custom)
const TTS_VOICES: { id: string; label: string }[] = [
  { id: "alba", label: "Alba" },
  { id: "fantine", label: "Fantine" },
  { id: "cosette", label: "Cosette" },
  { id: "eponine", label: "Eponine" },
  { id: "azelma", label: "Azelma" },
  { id: "marius", label: "Marius" },
  { id: "javert", label: "Javert" },
  { id: "jean", label: "Jean" },
]

function invokeTauri(cmd: string, args?: Record<string, unknown>): Promise<any> {
  const tauri = (globalThis as any).__TAURI__
  if (!tauri?.core?.invoke) return Promise.reject("Tauri not available")
  return tauri.core.invoke(cmd, args)
}

export const loadAudioSettings = loadVoiceSettings

const SELECT = { variant: "secondary", size: "small", triggerVariant: "settings" } as const

export const SettingsAudio: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const isMobile = () => platform.platform === "mobile"

  const [settings, setSettings] = createStore<AudioSettings>(loadAudioSettings())

  const update = <K extends keyof AudioSettings>(key: K, value: AudioSettings[K]) => {
    setSettings(key, value as any)
    saveAudioSettings({ ...settings, [key]: value })
  }

  const handleProviderChange = (provider: AudioSettings["ttsProvider"]) => {
    update("ttsProvider", provider)
    if (provider === "pocket" && !settings.voiceByLanguage.en) {
      update("voiceByLanguage", { ...settings.voiceByLanguage, en: "alba" })
    }
  }

  return (
    <SettingsPage title={language.t("settings.fork.audio.title")}>
      <SettingsSection title={language.t("settings.fork.audio.stt")}>
        <SettingsRow
          title={language.t("settings.fork.audio.enableStt")}
          description={language.t("settings.fork.audio.enableSttDescription")}
        >
          <div data-action="settings-audio-stt-enabled">
            <Switch checked={settings.sttEnabled} onChange={(value) => update("sttEnabled", value)} />
          </div>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.fork.audio.engine")}
          description={language.t("settings.fork.audio.engineDescription")}
        >
          <Select
            {...SELECT}
            options={["parakeet"]}
            current="parakeet"
            label={() => language.t("settings.fork.audio.parakeet")}
            onSelect={() => undefined}
          />
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.fork.audio.language")}
          description={language.t("settings.fork.audio.languageDescription")}
        >
          <Select
            {...SELECT}
            options={["auto", "en", "fr", "de", "es", "it"]}
            current={settings.sttLanguage}
            label={(value) => {
              const labels: Record<string, Parameters<typeof language.t>[0]> = {
                auto: "settings.fork.audio.languageAuto",
                en: "settings.fork.audio.languageEnglish",
                fr: "settings.fork.audio.languageFrench",
                de: "settings.fork.audio.languageGerman",
                es: "settings.fork.audio.languageSpanish",
                it: "settings.fork.audio.languageItalian",
              }
              return labels[value] ? language.t(labels[value]) : value
            }}
            onSelect={(value) => {
              if (value) update("sttLanguage", value as AudioSettings["sttLanguage"])
            }}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={language.t("settings.fork.audio.tts")}>
        <SettingsRow
          title={language.t("settings.fork.audio.enableTts")}
          description={language.t("settings.fork.audio.enableTtsDescription")}
        >
          <div data-action="settings-audio-tts-enabled">
            <Switch checked={settings.ttsEnabled} onChange={(value) => update("ttsEnabled", value)} />
          </div>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.fork.audio.provider")}
          description={language.t("settings.fork.audio.providerDescription")}
        >
          <Select
            {...SELECT}
            options={["auto", "pocket", "piper"]}
            current={settings.ttsProvider}
            label={(id) => id === "pocket" ? language.t("settings.fork.audio.pocketOption") : id === "piper" ? "Piper" : "Auto"}
            onSelect={(value) => {
              if (value) handleProviderChange(value as AudioSettings["ttsProvider"])
            }}
          />
        </SettingsRow>
        <Show when={settings.ttsProvider !== "piper"}>
        <SettingsRow
          title={language.t("settings.fork.audio.voice")}
          description={language.t("settings.fork.audio.pocketVoiceDescription")}
        >
          <Select
            {...SELECT}
            options={TTS_VOICES.map((voice) => voice.id)}
            current={settings.voiceByLanguage.en ?? "alba"}
            label={(id) => TTS_VOICES.find((voice) => voice.id === id)?.label ?? id}
            onSelect={(value) => {
              if (value) update("voiceByLanguage", { ...settings.voiceByLanguage, en: value })
            }}
          />
        </SettingsRow>
        </Show>
        <SettingsRow
          title={language.t("settings.fork.audio.speed")}
          description={language.t("settings.fork.audio.speedDescription")}
        >
          <Select
            {...SELECT}
            options={["0.75", "1.0", "1.25", "1.5", "2.0"]}
            current={String(settings.ttsSpeed)}
            label={(value) => `${value}x`}
            onSelect={(value) => {
              if (value) update("ttsSpeed", parseFloat(value))
            }}
          />
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.fork.audio.autoPlay")}
          description={language.t("settings.fork.audio.autoPlayDescription")}
        >
          <Switch checked={settings.ttsAutoPlay} onChange={(value) => update("ttsAutoPlay", value)} />
        </SettingsRow>
        <Show when={settings.ttsProvider !== "piper"}>
          <p data-slot="settings-note">{language.t("settings.fork.audio.poweredPocket")}</p>
        </Show>
      </SettingsSection>

      <Show when={!isMobile()}>
        <VoiceCloneSection
          enabled={settings.ttsEnabled && settings.ttsProvider === "pocket"}
          currentVoice={settings.voiceByLanguage.en ?? "alba"}
          onSelectClone={(name) => update("voiceByLanguage", { ...settings.voiceByLanguage, en: name })}
        />
      </Show>
    </SettingsPage>
  )
}

function VoiceCloneSection(props: {
  enabled: boolean
  currentVoice: string
  onSelectClone: (name: string) => void
}) {
  const language = useLanguage()
  const [clones, setClones] = createSignal<string[]>([])
  const [uploading, setUploading] = createSignal(false)
  const [recording, setRecording] = createSignal(false)
  const [testing, setTesting] = createSignal<string | null>(null)
  const [cloningSupported, setCloningSupported] = createSignal<boolean | null>(null)
  const [checkingCapability, setCheckingCapability] = createSignal(false)
  const [capabilityCheckFailed, setCapabilityCheckFailed] = createSignal(false)
  let mediaRecorder: MediaRecorder | null = null
  let audioChunks: Blob[] = []
  let captureLease: AudioCaptureLease | undefined
  let captureStream: MediaStream | undefined
  let discardCapture = false
  let mounted = true
  let capabilityRequestId = 0

  const canClone = () => props.enabled && cloningSupported() === true
  const checkCapability = async (requestId: number) => {
    setCheckingCapability(true)
    setCapabilityCheckFailed(false)
    try {
      const supported = await invokeTauri("tts_voice_cloning_supported")
      if (requestId === capabilityRequestId) setCloningSupported(supported)
    } catch {
      if (requestId === capabilityRequestId) {
        setCloningSupported(null)
        setCapabilityCheckFailed(true)
      }
    } finally {
      if (requestId === capabilityRequestId) setCheckingCapability(false)
    }
  }

  createEffect(() => {
    const requestId = ++capabilityRequestId
    if (props.enabled) {
      void checkCapability(requestId)
    } else {
      setCloningSupported(null)
      setCheckingCapability(false)
      setCapabilityCheckFailed(false)
    }
  })

  const loadClones = async () => {
    try {
      const list: string[] = await invokeTauri("tts_list_voice_clones")
      setClones(list)
    } catch {}
  }

  const stopVoiceCloneCapture = () => {
    discardCapture = true
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop()
    } else {
      captureStream?.getTracks().forEach((track) => track.stop())
      captureStream = undefined
      captureLease?.release()
      captureLease = undefined
      if (mounted) setRecording(false)
    }
  }

  onCleanup(() => {
    mounted = false
    stopVoiceCloneCapture()
  })

  // Load on mount
  loadClones()

  // Synthesize a short test phrase with a given voice so the user can verify
  // a freshly-recorded clone actually produces audio before triggering TTS
  // on a real message. The common failure mode is the Pocket TTS server
  // accepting the WAV but returning empty/garbled audio for a voice the
  // user thought was selected — this button surfaces it immediately.
  const handleTest = async (voiceName: string) => {
    if (!canClone() || testing()) return
    setTesting(voiceName)
    const requestId = crypto.randomUUID()
    const onPreviewEnded = (event: Event) => {
      if ((event as CustomEvent<{ id: string }>).detail?.id !== requestId) return
      window.removeEventListener("tts-preview-ended", onPreviewEnded)
      setTesting(null)
    }
    window.addEventListener("tts-preview-ended", onPreviewEnded)
    window.dispatchEvent(new CustomEvent("tts-toggle", {
      detail: {
        text: "Voice test, one two three.",
        voice: voiceName,
        provider: "pocket",
        replacePlayback: true,
        requestId,
      },
    }))
  }

  const handleUpload = async () => {
    if (!canClone()) return
    const input = document.createElement("input")
    input.type = "file"
    input.accept = "audio/wav,audio/wave,.wav"
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return

      setUploading(true)
      try {
        const buffer = await file.arrayBuffer()
        const bytes = new Uint8Array(buffer)
        let binary = ""
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
        const base64 = btoa(binary)

        const name = file.name.replace(/\.wav$/i, "").replace(/[^a-zA-Z0-9_-]/g, "_")
        await invokeTauri("tts_save_voice_clone", { audioBase64: base64, name })
        await loadClones()
        props.onSelectClone(name)
      } catch (e) {
        console.error("Voice clone upload failed:", e)
      }
      setUploading(false)
    }
    input.click()
  }

  const handleDelete = async (name: string) => {
    try {
      await invokeTauri("tts_delete_voice_clone", { name })
      await loadClones()
      if (props.currentVoice === name) {
        props.onSelectClone("alba")
      }
    } catch (e) {
      console.error("Delete voice clone failed:", e)
    }
  }

  const handleRecord = async () => {
    if (recording()) {
      // Stop recording
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop()
      }
      return
    }

    if (!canClone()) return

    let stream: MediaStream | undefined
    let lease: AudioCaptureLease | undefined
    try {
      lease = requestAudioCapture(window, "voice-clone", stopVoiceCloneCapture)
      if (!lease) {
        showToast({ title: language.t("speech.error") })
        return
      }
      captureLease = lease
      const acquiredStream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: { ideal: 24000 }, channelCount: 1 },
      })
      stream = acquiredStream
      if (!lease.isCurrent()) {
        acquiredStream.getTracks().forEach((track) => track.stop())
        return
      }
      captureStream = acquiredStream
      audioChunks = []
      discardCapture = false
      mediaRecorder = new MediaRecorder(acquiredStream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      })

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data)
      }

      mediaRecorder.onstop = async () => {
        acquiredStream.getTracks().forEach((t) => t.stop())
        captureStream = undefined
        if (captureLease?.id === lease?.id) captureLease = undefined
        lease?.release()
        if (mounted) setRecording(false)
        if (discardCapture) {
          discardCapture = false
          audioChunks = []
          return
        }
        if (audioChunks.length === 0) return

        setUploading(true)
        try {
          const blob = new Blob(audioChunks, { type: mediaRecorder!.mimeType })
          // Convert to WAV
          const arrayBuffer = await blob.arrayBuffer()
          const audioCtx = new AudioContext({ sampleRate: 24000 })
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
          await audioCtx.close()

          const samples = audioBuffer.getChannelData(0)
          const wavBuffer = encodeWav(samples, 24000)
          const bytes = new Uint8Array(wavBuffer)
          let binary = ""
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
          const base64 = btoa(binary)

          const name = `voice_${Date.now()}`
          await invokeTauri("tts_save_voice_clone", { audioBase64: base64, name })
          await loadClones()
          props.onSelectClone(name)
        } catch (e) {
          console.error("Voice recording failed:", e)
        }
        setUploading(false)
      }

      mediaRecorder.start(250)
      setRecording(true)
    } catch (e) {
      console.error("Mic access failed:", e)
      stream?.getTracks().forEach((track) => track.stop())
      lease?.release()
      if (captureLease?.id === lease?.id) captureLease = undefined
      if (captureStream === stream) captureStream = undefined
      const name = (e as { name?: string } | null)?.name
      showToast({ title: language.t(name === "NotAllowedError" || name === "PermissionDeniedError" ? "speech.denied" : "speech.error") })
    }
  }

  return (
    <>
      <SettingsSection title={language.t("settings.fork.audio.voiceCloning")}>
        <div class="py-3">
          <div class="flex items-center justify-between gap-2 pb-3">
            <div class="flex flex-col gap-0.5">
              <span class="text-14-medium text-text-strong">{language.t("settings.fork.audio.cloneVoice")}</span>
              <span class="text-12-regular text-text-weak">
                {recording() ? language.t("settings.fork.audio.stopRecording") : language.t("settings.fork.audio.cloneDescription")}
              </span>
            </div>
            <div class="flex items-center gap-1.5">
              <Button
                size="small"
                variant="secondary"
                onClick={handleUpload}
                disabled={!canClone() || checkingCapability() || uploading() || recording()}
              >
                {uploading() ? language.t("settings.fork.audio.processing") : language.t("settings.fork.audio.uploadWav")}
              </Button>
              <Tooltip placement="top" value={recording() ? language.t("settings.fork.audio.stopRecording") : language.t("settings.fork.audio.recordVoice")}>
                <IconButton
                  icon="microphone"
                  variant={recording() ? "primary" : "ghost"}
                  class="size-8"
                  aria-label={recording() ? language.t("settings.fork.audio.stopRecording") : language.t("settings.fork.audio.recordVoice")}
                  onClick={handleRecord}
                  disabled={(!canClone() && !recording()) || checkingCapability() || uploading()}
                />
              </Tooltip>
            </div>
          </div>
          <Show when={recording()}>
            <div class="flex items-center gap-1 pb-2">
              <div class="flex items-end gap-0.5 h-4">
                <div class="w-0.5 bg-icon-critical-base rounded-full animate-stt-bar1" />
                <div class="w-0.5 bg-icon-critical-base rounded-full animate-stt-bar2" />
                <div class="w-0.5 bg-icon-critical-base rounded-full animate-stt-bar3" />
                <div class="w-0.5 bg-icon-critical-base rounded-full animate-stt-bar4" />
                <div class="w-0.5 bg-icon-critical-base rounded-full animate-stt-bar5" />
                <div class="w-0.5 bg-icon-critical-base rounded-full animate-stt-bar3" />
                <div class="w-0.5 bg-icon-critical-base rounded-full animate-stt-bar1" />
                <div class="w-0.5 bg-icon-critical-base rounded-full animate-stt-bar4" />
              </div>
              <span class="text-12-regular text-text-critical-base ml-1">{language.t("settings.fork.audio.recording")}</span>
            </div>
          </Show>
          <Show when={clones().length > 0}>
            <div class="flex flex-col gap-1 border-t border-border-weak-base pt-2">
              <span class="text-12-medium text-text-weak pb-1">{language.t("settings.fork.audio.customVoices")}</span>
              <For each={clones()}>
                {(name) => (
                  <div class="flex items-center justify-between gap-2 py-1.5">
                    <button
                      type="button"
                      class="text-13-regular text-text-strong hover:text-text-strong truncate text-left"
                      classList={{ "text-syntax-property!": props.currentVoice === name }}
                      onClick={() => props.onSelectClone(name)}
                      disabled={!canClone() || checkingCapability()}
                    >
                      {name}
                      <Show when={props.currentVoice === name}>
                        <span class="text-11-regular text-text-weak ml-2">{language.t("settings.fork.audio.active")}</span>
                      </Show>
                    </button>
                    <div class="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        class="text-12-regular text-text-weak hover:text-text-strong disabled:opacity-50"
                        disabled={!canClone() || checkingCapability() || testing() !== null}
                        onClick={() => handleTest(name)}
                      >
                        {testing() === name ? language.t("settings.fork.audio.voiceTesting") : language.t("settings.fork.audio.voiceTest")}
                      </button>
                      <button
                        type="button"
                        class="text-12-regular text-text-critical-base hover:underline"
                        onClick={() => handleDelete(name)}
                      >
                        {language.t("settings.fork.audio.voiceDelete")}
                      </button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </SettingsSection>
      <Show when={props.enabled && checkingCapability()}>
        <p data-slot="settings-note">{language.t("settings.fork.audio.cloneCapabilityChecking")}</p>
      </Show>
      <Show when={props.enabled && cloningSupported() === false}>
        <p data-slot="settings-note" role="status">
          {language.t("settings.fork.audio.cloneCapabilityUnsupported")}
        </p>
      </Show>
      <Show when={props.enabled && capabilityCheckFailed()}>
        <p data-slot="settings-note" role="status">
          {language.t("settings.fork.audio.cloneCapabilityError")}
        </p>
      </Show>
      <Show when={canClone()}>
        <p data-slot="settings-note">{language.t("settings.fork.audio.cloningDescription")}</p>
      </Show>
    </>
  )
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buf)
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  w(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); w(8, "WAVE"); w(12, "fmt ")
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buf
}
