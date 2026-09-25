/* SPDX-License-Identifier: MIT */
import { TurnEndpointing } from "./turn-endpointing"
import type { LocalVoiceTransport } from "./live-controller"

type TauriInvoke = (command: string, args?: Record<string, unknown>) => Promise<any>

const SAMPLE_RATE = 16_000
const FRAME_MS = 20
const RMS_SPEECH_THRESHOLD = 0.018
const MAX_CAPTURE_SECONDS = 60

/** Android WebView audio capture, local Parakeet inference and installed offline TTS. */
export function createAndroidLocalVoiceTransport(invoke: TauriInvoke): LocalVoiceTransport {
  let stream: MediaStream | undefined
  let audioContext: AudioContext | undefined
  let processor: ScriptProcessorNode | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let mute: GainNode | undefined
  let frames: Float32Array[] = []
  let frameSamples = 0
  let endpointing: TurnEndpointing | undefined
  let handlers: { onSpeaking(speaking: boolean): void; onUtterance(audio: string): void } | undefined
  let speechUtterance: SpeechSynthesisUtterance | undefined
  let selectedVoice: SpeechSynthesisVoice | undefined
  let stopped = true
  let backgroundRms = 0.006

  function finishUtterance() {
    const samples = frames
    frames = []
    frameSamples = 0
    if (samples.length === 0) return
    void samplesToWavBase64(samples, audioContext?.sampleRate ?? SAMPLE_RATE).then((audio) => {
      if (!stopped) handlers?.onUtterance(audio)
    }).catch((error) => console.error("[Live] Local audio encoding failed", error))
  }

  function processAudio(event: AudioProcessingEvent) {
    if (stopped || !endpointing) return
    const input = event.inputBuffer.getChannelData(0)
    const samplesPerFrame = Math.max(1, Math.floor(input.length * FRAME_MS / (input.length / (audioContext?.sampleRate ?? SAMPLE_RATE) * 1000)))
    for (let offset = 0; offset < input.length; offset += samplesPerFrame) {
      const frame = input.slice(offset, Math.min(offset + samplesPerFrame, input.length))
      let squareSum = 0
      for (const sample of frame) squareSum += sample * sample
      const rms = Math.sqrt(squareSum / frame.length)
      const active = rms >= Math.max(RMS_SPEECH_THRESHOLD, backgroundRms * 3)
      if (!endpointing.isSpeechActive && !active) backgroundRms = backgroundRms * 0.96 + rms * 0.04
      const wasSpeechActive = endpointing.isSpeechActive
      const accepted = endpointing.accept(active ? 0.9 : 0.1, frame.length / (audioContext?.sampleRate ?? SAMPLE_RATE) * 1000)
      for (const transition of accepted) {
        if (transition.type === "speech-started") handlers?.onSpeaking(true)
        else {
          handlers?.onSpeaking(false)
          finishUtterance()
        }
      }
      if (wasSpeechActive && !endpointing.isSpeechActive && accepted.length === 0) handlers?.onSpeaking(false)
      if (!endpointing.isSpeechActive && frames.length > 0 && accepted.length === 0) {
        frames = []
        frameSamples = 0
      }
      if (endpointing.isSpeechActive) {
        frameSamples += frame.length
        if (frameSamples <= (audioContext?.sampleRate ?? SAMPLE_RATE) * MAX_CAPTURE_SECONDS) frames.push(frame)
      }
    }
  }

  return {
    async start(nextHandlers) {
      if (stopped === false) return
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) throw new Error("Android microphone capture is unavailable")
        if (typeof speechSynthesis === "undefined" || typeof SpeechSynthesisUtterance === "undefined") {
          throw new Error("Android local text-to-speech is unavailable")
        }
        const language = (document.documentElement.lang || navigator.language || "en").slice(0, 2).toLowerCase()
        selectedVoice = (await availableVoices()).find((voice) => voice.localService && voice.lang.toLowerCase().startsWith(language))
        if (!selectedVoice) throw new Error(`No installed offline TTS voice is available for ${language}`)
      stopped = false
      handlers = nextHandlers
      endpointing = new TurnEndpointing()
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
        audioContext = new AudioContext()
        await audioContext.resume()
        source = audioContext.createMediaStreamSource(stream)
        processor = audioContext.createScriptProcessor(4096, 1, 1)
        mute = audioContext.createGain()
        mute.gain.value = 0
        processor.onaudioprocess = processAudio
        source.connect(processor)
        processor.connect(mute)
        mute.connect(audioContext.destination)
        const available = await invoke("stt_available")
        if (!available) await invoke("stt_download_model")
        await invoke("stt_load_model")
      } catch (error) {
        this.stop()
        throw error
      }
    },
    async transcribe(audioBase64) {
      return invoke("stt_transcribe", { audioBase64 })
    },
    speak(text) {
      return speakWithInstalledVoice(text)
    },
    stop() {
      if (stopped) return
      stopped = true
      endpointing?.reset()
      handlers?.onSpeaking(false)
      frames = []
      processor?.disconnect()
      source?.disconnect()
      mute?.disconnect()
      processor = undefined
      source = undefined
      mute = undefined
      stream?.getTracks().forEach((track) => track.stop())
      stream = undefined
      void audioContext?.close()
      audioContext = undefined
    },
    stopSpeaking() {
      if (speechUtterance) speechSynthesis.cancel()
      speechUtterance = undefined
    },
  }

  function speakWithInstalledVoice(text: string): Promise<void> {
    if (typeof speechSynthesis === "undefined" || typeof SpeechSynthesisUtterance === "undefined") {
      return Promise.reject(new Error("Android local text-to-speech is unavailable"))
    }
    return (async () => {
      const utterance = new SpeechSynthesisUtterance(text)
      const language = selectedVoice?.lang ?? document.documentElement.lang ?? navigator.language ?? "en"
      utterance.lang = language
      return new Promise<void>((resolve, reject) => {
        if (!selectedVoice) {
          reject(new Error("Offline TTS voice was not initialized"))
          return
        }
        utterance.voice = selectedVoice
        speechUtterance = utterance
        utterance.onend = () => {
          if (speechUtterance === utterance) speechUtterance = undefined
          resolve()
        }
        utterance.onerror = (event) => {
          if (speechUtterance !== utterance || event.error === "canceled" || event.error === "interrupted") resolve()
          else {
            speechUtterance = undefined
            reject(new Error(`Local TTS failed: ${event.error}`))
          }
        }
        speechSynthesis.speak(utterance)
      })
    })()
  }
}

function availableVoices(): Promise<SpeechSynthesisVoice[]> {
  const current = speechSynthesis.getVoices()
  if (current.length) return Promise.resolve(current)
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      speechSynthesis.removeEventListener("voiceschanged", update)
      resolve(speechSynthesis.getVoices())
    }, 1_500)
    const update = () => {
      const voices = speechSynthesis.getVoices()
      if (voices.length === 0) return
      clearTimeout(timeout)
      speechSynthesis.removeEventListener("voiceschanged", update)
      resolve(voices)
    }
    speechSynthesis.addEventListener("voiceschanged", update)
  })
}

async function samplesToWavBase64(frames: Float32Array[], sourceRate: number): Promise<string> {
  const sourceLength = frames.reduce((length, frame) => length + frame.length, 0)
  const source = new Float32Array(sourceLength)
  let cursor = 0
  for (const frame of frames) {
    source.set(frame, cursor)
    cursor += frame.length
  }
  const outputLength = Math.floor(source.length * SAMPLE_RATE / sourceRate)
  const wav = new ArrayBuffer(44 + outputLength * 2)
  const view = new DataView(wav)
  const write = (offset: number, value: string) => { for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index)) }
  write(0, "RIFF"); view.setUint32(4, 36 + outputLength * 2, true); write(8, "WAVE")
  write(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true)
  view.setUint16(22, 1, true); view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, "data"); view.setUint32(40, outputLength * 2, true)
  for (let index = 0; index < outputLength; index++) {
    const sourceIndex = index * sourceRate / SAMPLE_RATE
    const lower = Math.floor(sourceIndex)
    const upper = Math.min(lower + 1, source.length - 1)
    const fraction = sourceIndex - lower
    const sample = Math.max(-1, Math.min(1, source[lower] * (1 - fraction) + source[upper] * fraction))
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  const bytes = new Uint8Array(wav)
  let binary = ""
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  return btoa(binary)
}
