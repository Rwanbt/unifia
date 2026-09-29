<!-- SPDX-License-Identifier: MIT -->
# ADR-071: Voice Language and Voice Resolution — explicit order, no silent switch (2026-09-26)

> Companion to the ADR chain
> [ADR-058](../adr/ADR-058-voice-runtime.md) through
> [ADR-070](../adr/ADR-070-voice-error-taxonomy-readiness.md),
> and the
> [v2 parity RFC](../rfcs/RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md).

## Context

The v2 plan §16 requires an ADR titled "Language and Voice
Resolution" freezing the resolution order:

1. explicit user setting
2. final STT language
3. conversation language
4. application locale
5. English fallback

The plan adds: "Never silently switch to a voice incompatible
with the language."

The desktop `voice_host/live/language.py` already implements a
language router (referenced by ADR-060 / ADR-062). The Android
TypeScript code uses `Locale` directly in some flows and accepts
the user setting in others. Neither path records the resolved
language on a `voice_ready` event; neither path emits a warning
when the resolved voice is incompatible with the resolved
language.

## Decision

1. **Resolution order is canonical** (the shared `VoiceTurnEngine`
   owns the function, both platforms call it):

   ```
   resolveLanguage(session) → VoiceLang
     1. explicit user setting (audio settings, persisted per session)
     2. final STT language (from the most recent `stt_final`)
     3. conversation language (from the active session metadata)
     4. application locale (OS / browser locale)
     5. English fallback ("en-US" / "en-GB" pick the closest pinned voice)
   ```

   The function is pure (no side effects), deterministic given
   inputs, and observable in tests.

2. **Voice identity** is resolved by `resolveVoice(lang, settings)`:

   ```
   voice = if settings.voice_override: settings.voice_override
           else if settings.gender: pick the pinned voice for lang+gender
           else if last_session_used_voice_in_lang(lang): that voice
           else: the default pinned voice for lang
   ```

   The pinned voice map is the model artifact registry entry per
   language (per ADR-066). Each language has exactly one default
   voice in the registry; the user override is the only
   deviation.

3. **Never silently switch to an incompatible voice**. The
   `resolveVoice` function returns `null` (or a
   `VoiceResolution` with `status: "incompatible"`) when the
   resolved voice does not support the resolved language. The
   engine emits `voice_error` with
   `stage: "unsupported-capability"` and
   `code: "VOICE_LANG_INCOMPATIBLE"`. The UI surfaces the error
   and offers the supported voices for that language. There is
   no implicit switch to a voice that happens to be loaded for a
   different language.

4. **`voice_ready` carries the resolved language and voice**. The
   `voice_ready` event payload includes:

   ```ts
   {
     kind: "voice_ready"
     sessionID: string
     ts: number
     seq: number
     capabilities: VoiceCapabilities
     language: VoiceLang              // resolved language
     voice: VoiceId                  // resolved voice identity
     locale_source: "user" | "stt-final" | "conversation" | "app" | "fallback-en"
   }
   ```

   The UI binds its labels to `language` and `voice`; nothing
   else.

5. **Mid-turn language switch**. The v2 plan §36 mentions
   "language switch mid-turn" as an edge case. The behaviour:

   - On a fresh `stt_final` whose language differs from the
     resolved language, the engine re-runs `resolveLanguage` and
     `resolveVoice`. If the new voice is compatible, the engine
     emits `provider_fallback` with `from: <old>`, `to: <new>`,
     `reason: "stt-language-switch"`. The session continues.
   - If the new voice is not compatible, the engine emits
     `voice_error` with `code: "VOICE_LANG_INCOMPATIBLE"`. The
     TTS path stops, the agent run continues, the session
     surfaces the error to the user.
   - The user's explicit setting always wins; if the user has
     pinned a voice for the conversation language, a mid-turn
     `stt_final` in a different language does not silently switch
     away from the user's choice.

6. **Per-language capability matrix**. Each model entry in the
   registry declares its `languages` array (per ADR-066). The
   `voice_ready` payload's `capabilities` lists the languages
   that are actually backed by a loaded model/voice. A voice
   ready for EN + FR + ES + IT + DE looks different from a voice
   ready for EN only; the UI can render the language selector
   accordingly.

7. **No language change during a stream**. A `tts_audio` stream
   in progress cannot change voice mid-utterance. The current
   utterance finishes; the next utterance uses the resolved
   voice at the time the new `speech_segment_ready` is
   emitted. This is the same "never restart an utterance that
   already started playing" invariant from ADR-062.

## Consequences

- The Android adapter adds `resolveLanguage` and `resolveVoice`
  ports of the desktop language router; the WebView
  `speechSynthesis` language tag follows the resolved language,
  not the application locale directly.
- The desktop Python language router becomes the canonical
  implementation; the Android implementation is a TypeScript
  port with the same semantics and the same observability.
- A contract test enforces: `voice_ready` always carries
  `language`, `voice`, `locale_source`. A `voice_error` is
  emitted whenever `resolveVoice` returns `incompatible`.
- A UX test asserts that the user-visible voice identity matches
  the `voice` field on `voice_ready`.

## Open evidence requirements

- A five-language resolution test: each of EN/FR/ES/IT/DE is
  exercised with each of the five resolution sources (user,
  stt-final, conversation, app, fallback). The resolved voice
  matches the registry's pinned default.
- An incompatible test: an unsupported language produces
  `voice_error` with `code: VOICE_LANG_INCOMPATIBLE` and never
  silently picks another language's voice.
- A mid-turn switch test: a fresh `stt_final` in a new language
  either triggers `provider_fallback` (when a compatible voice
  is loaded) or `voice_error` (when none is). The user's pinned
  voice is not silently overridden.

## Status

**DRAFT** — not adopted. The resolution order and the readiness
payload are specified. Adoption requires the contract tests and
the resolution tests above to be green.

## References

- [ADR-058-voice-runtime.md](ADR-058-voice-runtime.md) §7
- [ADR-060-voice-turn-engine-design.md](ADR-060-voice-turn-engine-design.md)
- [ADR-062-voice-tts-routing.md](ADR-062-voice-tts-routing.md)
- [ADR-066-voice-model-artifact-registry.md](ADR-066-voice-model-artifact-registry.md)
- [ADR-067-voice-privacy-logging-metrics.md](ADR-067-voice-privacy-logging-metrics.md)
- [ADR-070-voice-error-taxonomy-readiness.md](ADR-070-voice-error-taxonomy-readiness.md)
- [RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md](../rfcs/RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md)
- [CHECKPOINT-VOICE-V2-2026-09-26.md](../CHECKPOINT-VOICE-V2-2026-09-26.md)
- v2 plan §7 (target languages), §16 (ADR campaign list),
  §36 (edge cases)
- `packages/voice-host/voice_host/live/language.py` — existing
  desktop language router
- `packages/voice-host/models/registry.json` — pinned voices per
  language (ADR-066 partial adoption)