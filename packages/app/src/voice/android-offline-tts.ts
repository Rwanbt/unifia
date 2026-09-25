/* SPDX-License-Identifier: MIT */

/** Uses only Android system voices marked as local by the WebView speech API. */
export class AndroidOfflineTts {
  private utterance: SpeechSynthesisUtterance | undefined
  private readonly voices = new Map<string, SpeechSynthesisVoice>()

  async prepare(language: string): Promise<void> {
    await this.voice(language)
  }

  async speak(text: string, language: string, rate = 1): Promise<void> {
    if (typeof speechSynthesis === "undefined" || typeof SpeechSynthesisUtterance === "undefined") {
      throw new Error("Android local text-to-speech is unavailable")
    }
    const voice = await this.voice(language)
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = voice.lang
    utterance.voice = voice
    utterance.rate = Math.min(2, Math.max(0.5, rate))
    await new Promise<void>((resolve, reject) => {
      this.utterance = utterance
      utterance.onend = () => {
        if (this.utterance === utterance) this.utterance = undefined
        resolve()
      }
      utterance.onerror = (event) => {
        if (this.utterance !== utterance || event.error === "canceled" || event.error === "interrupted") resolve()
        else {
          this.utterance = undefined
          reject(new Error(`Android local TTS failed: ${event.error}`))
        }
      }
      speechSynthesis.speak(utterance)
    })
  }

  pause(): void {
    if (this.utterance) speechSynthesis.pause()
  }

  resume(): void {
    if (this.utterance) speechSynthesis.resume()
  }

  stop(): void {
    if (!this.utterance) return
    this.utterance = undefined
    speechSynthesis.cancel()
  }

  private async voice(language: string): Promise<SpeechSynthesisVoice> {
    if (typeof speechSynthesis === "undefined") throw new Error("Android local text-to-speech is unavailable")
    const normalizedLanguage = language.slice(0, 2).toLowerCase()
    const cached = this.voices.get(normalizedLanguage)
    if (cached) return cached
    const available = await getAvailableVoices()
    const selected = available.find((voice) => voice.localService && voice.lang.toLowerCase().startsWith(normalizedLanguage))
    if (!selected) throw new Error(`No installed offline TTS voice is available for ${normalizedLanguage}`)
    this.voices.set(normalizedLanguage, selected)
    return selected
  }
}

function getAvailableVoices(): Promise<SpeechSynthesisVoice[]> {
  const current = speechSynthesis.getVoices()
  if (current.length) return Promise.resolve(current)
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      speechSynthesis.removeEventListener("voiceschanged", update)
      resolve(speechSynthesis.getVoices())
    }, 1_500)
    const update = () => {
      const voices = speechSynthesis.getVoices()
      if (!voices.length) return
      clearTimeout(timeout)
      speechSynthesis.removeEventListener("voiceschanged", update)
      resolve(voices)
    }
    speechSynthesis.addEventListener("voiceschanged", update)
  })
}
