/* SPDX-License-Identifier: MIT */
import {
  DisconnectReason,
  ParticipantEvent,
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteTrack,
} from "livekit-client"
import type { LiveRoom } from "./live-controller"

/**
 * livekit-client implementation of the Live transport. Capture uses the
 * platform's echo cancellation, noise suppression and gain control so the
 * microphone can stay open while the assistant speaks (barge-in).
 */
export function createLiveKitRoom(): LiveRoom {
  let room: Room | undefined
  const elements = new Set<HTMLMediaElement>()

  const clearElements = () => {
    for (const element of elements) element.remove()
    elements.clear()
  }

  return {
    async connect(grant, handlers, options) {
      const current = new Room({
        adaptiveStream: false,
        dynacast: false,
        disconnectOnPageLeave: true,
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          deviceId: options.inputDeviceId,
        },
        audioOutput: options.outputDeviceId ? { deviceId: options.outputDeviceId } : undefined,
      })
      room = current
      const agentAttributes = (participant: Participant) => {
        if (participant.isAgent) handlers.onAgentAttributes({ ...participant.attributes })
      }
      current
        .on(RoomEvent.Reconnecting, handlers.onReconnecting)
        .on(RoomEvent.SignalReconnecting, handlers.onReconnecting)
        .on(RoomEvent.Reconnected, handlers.onReconnected)
        .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
          clearElements()
          handlers.onDisconnected(
            reason === DisconnectReason.CLIENT_INITIATED
              ? "client"
              : reason === DisconnectReason.SERVER_SHUTDOWN || reason === DisconnectReason.ROOM_DELETED
                ? "server"
                : "lost",
          )
        })
        .on(RoomEvent.ParticipantConnected, (participant) => {
          if (!participant.isAgent) return
          handlers.onAgentJoined()
          agentAttributes(participant)
        })
        .on(RoomEvent.ParticipantDisconnected, (participant) => {
          if (participant.isAgent) handlers.onAgentLeft()
        })
        .on(RoomEvent.ParticipantAttributesChanged, (_changed, participant) => agentAttributes(participant))
        .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
          if (track.kind !== Track.Kind.Audio) return
          const element = track.attach()
          element.setAttribute("data-live-voice-output", "")
          element.hidden = true
          document.body.appendChild(element)
          elements.add(element)
        })
        .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
          for (const element of track.detach()) {
            element.remove()
            elements.delete(element)
          }
        })
      current.localParticipant.on(ParticipantEvent.IsSpeakingChanged, handlers.onUserSpeaking)
      await current.connect(grant.url, grant.token, { autoSubscribe: true })
      // The click that started Live is the user gesture that unlocks playback.
      await current.startAudio().catch(() => undefined)
      for (const participant of current.remoteParticipants.values()) {
        if (!participant.isAgent) continue
        handlers.onAgentJoined()
        agentAttributes(participant)
      }
    },
    async setMicrophone(enabled) {
      await room?.localParticipant.setMicrophoneEnabled(enabled)
    },
    async disconnect() {
      const current = room
      room = undefined
      clearElements()
      await current?.disconnect()
    },
  }
}
