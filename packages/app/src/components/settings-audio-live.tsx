/* SPDX-License-Identifier: MIT */
import { type Component, createResource, Show } from "solid-js"
import { Select } from "@unifia/ui/select"
import { Switch } from "@unifia/ui/switch"
import { SettingsSection } from "./settings-page"
import { SettingsRow } from "./settings-row"
import { useLanguage } from "@/context/language"
import type { AudioSettingsV2 } from "@/voice/audio-settings"

const SELECT = { variant: "secondary", size: "small", triggerVariant: "settings" } as const
const DEFAULT_DEVICE = "default"

async function listDevices(kind: MediaDeviceKind): Promise<MediaDeviceInfo[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return []
  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [])
  return devices.filter((device) => device.kind === kind && device.deviceId && device.deviceId !== "default")
}

/**
 * Live conversation settings. Normal users see on/off and devices; the
 * Voice Host exposure and CPU profile are advanced options (desktop only,
 * where the Voice Host runs).
 */
export const SettingsAudioLive: Component<{
  settings: AudioSettingsV2
  update: <K extends keyof AudioSettingsV2>(key: K, value: AudioSettingsV2[K]) => void
  hostsVoice: boolean
}> = (props) => {
  const language = useLanguage()
  const [inputs] = createResource(() => listDevices("audioinput"))
  const [outputs] = createResource(() => listDevices("audiooutput"))
  const deviceOptions = (devices: MediaDeviceInfo[] | undefined) => [DEFAULT_DEVICE, ...(devices ?? []).map((device) => device.deviceId)]
  const deviceLabel = (devices: MediaDeviceInfo[] | undefined, id: string) =>
    id === DEFAULT_DEVICE
      ? language.t("settings.fork.audio.liveDefaultDevice")
      : devices?.find((device) => device.deviceId === id)?.label || id.slice(0, 8)

  return (
    <SettingsSection title={language.t("settings.fork.audio.live")}>
      <SettingsRow
        title={language.t("settings.fork.audio.liveEnable")}
        description={language.t("settings.fork.audio.liveEnableDescription")}
      >
        <div data-action="settings-audio-live-enabled">
          <Switch checked={props.settings.liveEnabled} onChange={(value) => props.update("liveEnabled", value)} />
        </div>
      </SettingsRow>
      <Show when={props.settings.liveEnabled}>
        <SettingsRow
          title={language.t("settings.fork.audio.liveInput")}
          description={language.t("settings.fork.audio.liveInputDescription")}
        >
          <Select
            {...SELECT}
            options={deviceOptions(inputs())}
            current={props.settings.liveInputDeviceId ?? DEFAULT_DEVICE}
            label={(id) => deviceLabel(inputs(), id)}
            onSelect={(value) => props.update("liveInputDeviceId", value && value !== DEFAULT_DEVICE ? value : undefined)}
          />
        </SettingsRow>
        <Show when={(outputs()?.length ?? 0) > 0}>
          <SettingsRow
            title={language.t("settings.fork.audio.liveOutput")}
            description={language.t("settings.fork.audio.liveOutputDescription")}
          >
            <Select
              {...SELECT}
              options={deviceOptions(outputs())}
              current={props.settings.liveOutputDeviceId ?? DEFAULT_DEVICE}
              label={(id) => deviceLabel(outputs(), id)}
              onSelect={(value) => props.update("liveOutputDeviceId", value && value !== DEFAULT_DEVICE ? value : undefined)}
            />
          </SettingsRow>
        </Show>
        <Show when={props.hostsVoice}>
          <SettingsRow
            title={language.t("settings.fork.audio.liveHost")}
            description={language.t("settings.fork.audio.liveHostDescription")}
          >
            <div data-action="settings-audio-live-host">
              <Select
                {...SELECT}
                options={["local", "lan"]}
                current={props.settings.voiceHostMode}
                label={(mode) =>
                  mode === "lan" ? language.t("settings.fork.audio.liveHostLan") : language.t("settings.fork.audio.liveHostLocal")
                }
                onSelect={(value) => props.update("voiceHostMode", value === "lan" ? "lan" : "local")}
              />
            </div>
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.fork.audio.liveCpu")}
            description={language.t("settings.fork.audio.liveCpuDescription")}
          >
            <Select
              {...SELECT}
              options={["eco", "balanced", "fast"]}
              current={props.settings.cpuProfile}
              label={(profile) =>
                profile === "eco"
                  ? language.t("settings.fork.audio.liveCpuEco")
                  : profile === "fast"
                    ? language.t("settings.fork.audio.liveCpuFast")
                    : language.t("settings.fork.audio.liveCpuBalanced")
              }
              onSelect={(value) => props.update("cpuProfile", value === "eco" || value === "fast" ? value : "balanced")}
            />
          </SettingsRow>
        </Show>
        <p data-slot="settings-note">
          {props.hostsVoice ? language.t("settings.fork.audio.liveNoteDesktop") : language.t("settings.fork.audio.liveNoteRemote")}
        </p>
      </Show>
    </SettingsSection>
  )
}
