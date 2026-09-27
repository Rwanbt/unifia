/* SPDX-License-Identifier: MIT */
/**
 * selectStreamingStt — streaming-first provider selection with an
 * honest final-only fallback (campaign §20).
 *
 * WHY a router: the nominal Live path wants a real streaming provider,
 * but targets where none is qualified must degrade explicitly — the
 * choice records *what* was bypassed and *why* so the fallback can
 * surface as a `provider_fallback` diagnostic instead of quietly
 * masquerading as streaming (same discipline as the TTS router: no
 * silent substitution).
 */

import type { SpeechLanguage } from "@unifia/contracts/speech"
import {
  STREAMING_STT_ERROR_CODES,
  type StreamingSttProvider,
  type StreamingSttProviderId,
} from "@unifia/contracts/streaming-stt"
import { codeOf, messageOf } from "./stt-errors"

const { LANGUAGE_UNSUPPORTED, PROVIDER_LOAD_FAILED } = STREAMING_STT_ERROR_CODES

export interface SttChoice {
  readonly provider: StreamingSttProvider
  readonly providerId: StreamingSttProviderId
  /** Present only when a streaming candidate was bypassed — what was
   *  attempted and why, for provider_fallback diagnostics. */
  readonly fallback?: {
    readonly attempted?: StreamingSttProviderId
    readonly reason: string
  }
}

/** Diagnostics-only reason builders (stable prefixes, free-form tail). */
const reason = {
  absent: "streaming_provider_absent",
  language: (language: string) => `${LANGUAGE_UNSUPPORTED}:${language}`,
  prepare: (error: unknown) =>
    `prepare_failed:${codeOf(error, PROVIDER_LOAD_FAILED)}:${messageOf(error)}`,
} as const

/** Try the streaming candidate for `language`; returns "" when usable
 *  or the fallback reason otherwise. */
async function probe(
  streaming: StreamingSttProvider,
  language: SpeechLanguage,
  signal?: AbortSignal,
): Promise<string> {
  if (!streaming.capabilities.languages.includes(language)) return reason.language(language)
  try {
    await streaming.prepare({ language }, signal)
    return ""
  } catch (error) {
    if (signal?.aborted) throw error
    return reason.prepare(error)
  }
}

/** Select the streaming provider when it can serve `language`;
 *  otherwise return the honest final-only fallback with a diagnostic
 *  reason. Throws only when the fallback itself cannot prepare — a
 *  choice must never return with no usable provider. */
export async function selectStreamingStt(options: {
  readonly language: SpeechLanguage
  readonly streaming?: StreamingSttProvider
  readonly fallback: StreamingSttProvider
  readonly signal?: AbortSignal
}): Promise<SttChoice> {
  const { language, streaming, fallback, signal } = options
  if (streaming) {
    const why = await probe(streaming, language, signal)
    if (!why) return { provider: streaming, providerId: streaming.id }
    await fallback.prepare({ language }, signal)
    return {
      provider: fallback,
      providerId: fallback.id,
      fallback: { attempted: streaming.id, reason: why },
    }
  }
  await fallback.prepare({ language }, signal)
  return { provider: fallback, providerId: fallback.id, fallback: { reason: reason.absent } }
}
