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
}) {
  const server = useServer()
  const collaborativeAuth = useCollaborativeAuth()
  const navigate = useNavigate()
  const tauri = (globalThis as { __TAURI__?: { core?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } } }).__TAURI__
  const directory = () => input.sdk.directory

  bindLiveRuntime({
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
  })

  return {
    // Live needs a microphone and a server; settings can turn the button off.
    available: typeof navigator !== "undefined" && !!navigator.mediaDevices && loadAudioSettings().liveEnabled,
    context: (): LiveContext => {
      const model = input.local.model.current()
      return {
        directory: directory(),
        sessionID: input.params.id,
        agent: input.local.agent.current()?.name,
        model: model ? { providerID: model.provider.id, modelID: model.id } : undefined,
        variant: input.local.model.variant.current(),
        locale: input.language.locale(),
      }
    },
  }
}
