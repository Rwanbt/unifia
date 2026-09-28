// SPDX-License-Identifier: MIT
package ai.unifia.mobile

import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import java.io.File
import java.util.Locale
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

private const val INIT_TIMEOUT_SECONDS = 10L
private const val SYNTHESIS_TIMEOUT_SECONDS = 60L

/**
 * Renders text to a WAV file with the device's installed text-to-speech
 * engine, restricted to voices that are installed and need no network.
 *
 * WHY a file and not TextToSpeech.speak(): Voice owns playback. The WAV is
 * read back as PCM by Rust and played through the canonical TTS router and
 * the native Oboe output, so this engine obeys playback arbitration and
 * barge-in like any other backend (ADR-062). The Android WebView exposes no
 * voices to speechSynthesis, which is why this goes through native code.
 *
 * Errors are thrown with a stable prefix the TypeScript backend maps to the
 * canonical TTS error codes. Must not be called on the main thread.
 */
class SystemSpeechSynthesizer(private val context: Context) {
  private val mainHandler = Handler(Looper.getMainLooper())
  @Volatile private var engine: TextToSpeech? = null

  @Synchronized
  fun synthesizeToFile(text: String, languageTag: String, rate: Float): String {
    check(Looper.myLooper() != Looper.getMainLooper()) { "SYSTEM_TTS_THREAD: synthesis must not block the main thread" }
    val tts = engine ?: initialize().also { engine = it }
    tts.voice = offlineVoice(tts, Locale.forLanguageTag(languageTag))
    tts.setSpeechRate(rate.coerceIn(0.5f, 2f))

    val output = File(context.cacheDir, "system-tts-${UUID.randomUUID()}.wav")
    val utteranceId = output.name
    val done = CountDownLatch(1)
    var failure: String? = null
    tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
      override fun onStart(id: String?) {}
      override fun onDone(id: String?) { if (id == utteranceId) done.countDown() }
      @Deprecated("Deprecated in Java")
      override fun onError(id: String?) { onError(id, TextToSpeech.ERROR) }
      override fun onError(id: String?, errorCode: Int) {
        if (id != utteranceId) return
        failure = "SYSTEM_TTS_FAILED: engine error $errorCode"
        done.countDown()
      }
    })
    if (tts.synthesizeToFile(text, Bundle(), output, utteranceId) != TextToSpeech.SUCCESS) {
      throw IllegalStateException("SYSTEM_TTS_FAILED: synthesis was not queued")
    }
    if (!done.await(SYNTHESIS_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
      tts.stop()
      output.delete()
      throw IllegalStateException("SYSTEM_TTS_FAILED: synthesis timed out")
    }
    failure?.let {
      output.delete()
      throw IllegalStateException(it)
    }
    return output.absolutePath
  }

  fun shutdown() {
    engine?.shutdown()
    engine = null
  }

  private fun initialize(): TextToSpeech {
    val ready = CountDownLatch(1)
    var status = TextToSpeech.ERROR
    var created: TextToSpeech? = null
    // The init callback is delivered on the main looper; create it there too.
    mainHandler.post {
      created = TextToSpeech(context) { result ->
        status = result
        ready.countDown()
      }
    }
    if (!ready.await(INIT_TIMEOUT_SECONDS, TimeUnit.SECONDS) || status != TextToSpeech.SUCCESS) {
      created?.shutdown()
      throw IllegalStateException("SYSTEM_TTS_UNAVAILABLE: no text-to-speech engine could start")
    }
    return created ?: throw IllegalStateException("SYSTEM_TTS_UNAVAILABLE: engine missing after init")
  }

  /** The best installed, network-free voice for the language, or a classified failure. */
  private fun offlineVoice(tts: TextToSpeech, locale: Locale): Voice {
    val candidates = tts.voices.orEmpty().filter { voice ->
      voice.locale.language == locale.language &&
        !voice.isNetworkConnectionRequired &&
        TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED !in voice.features
    }
    return candidates.maxWithOrNull(compareBy<Voice>({ it.locale.country == locale.country }, { it.quality }))
      ?: throw IllegalStateException("SYSTEM_TTS_LANGUAGE_UNAVAILABLE: no offline voice installed for ${locale.language}")
  }
}
