/* SPDX-License-Identifier: MIT */
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@unifia/util/encode"
import type { useLanguage } from "@/context/language"
import type { useLocal } from "@/context/local"
import type { Platform } from "@/context/platform"
import type { useSDK } from "@/context/sdk"
import { useCollaborativeAuth } from "@/context/collaborative-auth"
import { useServer } from "@/context/server"
import { serverBasicAuthorization } from "@/utils/server"
import type { LiveContext } from "@/voice/live-controller"
import { createLiveHostClient } from "@/voice/live-host"
import { createAndroidLocalVoiceTransport } from "@/voice/android-local-voice"
import { createLocalVoiceSession } from "@/voice/local-session"
import { createSdkLivePromptStream } from "@/voice/sdk-live-prompt-stream"
import { createTauriVoiceCoreRuntime } from "@/voice/voice-core-runtime"
import { bindLiveRuntime } from "@/voice/live-store"
import { loadAudioSettings } from "@/voice/audio-settings"

/**
 * Binds the Live conversation to this composer: the server the app talks to
 * (its existing authentication is the pairing), the selected agent/model, the
 * current session, and navigation to a session created by a first voice turn.
 */
export function createLiveBinding(input: {
  platform: Platform
  sdk: ReturnType<typeof useSDK>
  params: { id?: string }
  local: ReturnType<typeof useLocal>
  language: ReturnType<typeof useLanguage>
  /** Runs before Live takes the microphone (finalizes a dictation in progress). */
  beforeStart: () => void
}) {
  const server = useServer()
  const collaborativeAuth = useCollaborativeAuth()
  const navigate = useNavigate()
  const tauri = (
    globalThis as {
      __TAURI__?: { core?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } }
    }
  ).__TAURI__
  const isMobile = input.platform.platform === "mobile"
  const voiceCore = isMobile && tauri?.core?.invoke
    ? createTauriVoiceCoreRuntime((command, args) => tauri.core!.invoke!(command, args))
    : undefined
  const directory = () => input.sdk.directory
  const promptStream = createSdkLivePromptStream({
    events: input.sdk.event,
    promptAsync: async (request) => {
      const result = await input.sdk.client.session.promptAsync({
        sessionID: request.sessionID,
        messageID: request.messageID,
        directory: request.directory,
        agent: request.agent,
        model: request.model,
        variant: request.variant,
        parts: request.parts,
      })
      return { error: result.error }
    },
  })
  const localSession = createLocalVoiceSession({
    client: {
      create: (request) => input.sdk.client.session.create(request),
      prompt: (request) => input.sdk.client.session.prompt(request),
      promptStream,
    },
    voiceCore,
    directory: directory(),
    sessionID: input.params.id,
    onSession: (sessionID) => {
      if (input.params.id !== sessionID) navigate(`/${base64Encode(directory())}/session/${sessionID}`)
    },
  })
  // Android uses the local audio adapter; other platforms retain host LiveKit.
  const available = typeof navigator !== "undefined"
    && !!navigator.mediaDevices
    && loadAudioSettings().liveEnabled
    && (!isMobile || typeof tauri?.core?.invoke === "function")
  const context = (): LiveContext => {
    const model = input.local.model.current()
    return {
      transport: isMobile ? "local" : "host",
      directory: directory(),
      sessionID: input.params.id,
      agent: input.local.agent.current()?.name,
      model: model ? { providerID: model.provider.id, modelID: model.id } : undefined,
      variant: input.local.model.variant.current(),
      locale: input.language.locale(),
      closeVoiceCoreSession: () => localSession.closeVoiceCoreSession(),
      submitTurn: (transcript, signal) => localSession.submit(transcript, {
        agent: input.local.agent.current()?.name,
        model: model ? { providerID: model.provider.id, modelID: model.id } : undefined,
        variant: input.local.model.variant.current(),
      }, signal),
      submitTurnStream: (transcript, signal) => localSession.submitStream(transcript, {
        agent: input.local.agent.current()?.name,
        model: model ? { providerID: model.provider.id, modelID: model.id } : undefined,
        variant: input.local.model.variant.current(),
      }, signal),
    }
  }

  bindLiveRuntime({
    localVoice: isMobile && tauri?.core?.invoke
      ? createAndroidLocalVoiceTransport(tauri.core.invoke)
      : undefined,
    host: createLiveHostClient({
      platform: input.platform.platform,
      server: () => {
        const http = server.current?.http
        return {
          url: http?.url ?? location.origin,
          authorization: collaborativeAuth.authorization() ?? (http ? serverBasicAuthorization(http) : undefined),
        }
      },
      invoke: tauri?.core?.invoke,
      fetch: input.platform.fetch,
    }),
    onSession: (sessionID) => {
      if (input.params.id === sessionID) return
      navigate(`/${base64Encode(directory())}/session/${sessionID}`)
    },
    context,
    available,
    beforeStart: input.beforeStart,
  })

  return { available }
}
