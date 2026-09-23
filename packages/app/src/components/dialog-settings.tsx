import { type Component, type JSX, For, Show, createMemo, createSignal } from "solid-js"
import { Dialog } from "@unifia/ui/dialog"
import { Tabs } from "@unifia/ui/tabs"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useViewport } from "@/shell/v110-store"
import { SettingsMobileNav } from "./settings-mobile-nav"
import { SettingsGeneral } from "./settings-general"
import { SettingsAudio } from "./settings-audio"
import { SettingsConfiguration } from "./settings-configuration"
import { SettingsKeybinds } from "./settings-keybinds"
import { SettingsProviders } from "./settings-providers"
import { SettingsModels } from "./settings-models"
import { SettingsBenchmark } from "./settings-benchmark"
import { SettingsPlugins } from "./settings-plugins"
import { SettingsAndroid } from "./settings-android"
import { SettingsObservability } from "./settings-observability"
import { SettingsMemory } from "./settings-memory"
import { SettingsRemoteAccess } from "./settings-remote-access"
import { SettingsCollaborativeAuth } from "./settings-collaborative-auth"
import { SettingsCommandBar } from "./settings-command-bar"
import { SettingsScopeProvider } from "./settings-scope"
import { SettingsNavIcon, type SettingsIconName } from "./settings-nav-icon"

export const DialogSettings: Component = () => {
  const platform = usePlatform()
  const viewport = useViewport()
  const isMobile = createMemo(() => {
    const v = viewport()
    if (platform.os === "ios" || platform.os === "android") return true
    return v === "phone-portrait" || v === "tablet-portrait" || v === "compact-landscape"
  })

  return (
    <Dialog size="x-large" transition>
      <Show when={isMobile()} fallback={<DialogSettingsDesktop />}>
        <SettingsMobileNav />
      </Show>
    </Dialog>
  )
}

// ADR-047: the maquette's five groups, in its order. Pages the maquette
// merges live under its name: Remote access (and Android) is Compute, Se
// connecter is Security, Plugins is MCP. Tab ids keep their old values so
// existing links still open the right page.
type SettingsPage = { id: string; icon: SettingsIconName; label: string; render: () => JSX.Element }
type SettingsGroup = { label: string; pages: SettingsPage[] }

function settingsGroups(language: ReturnType<typeof useLanguage>, platform: ReturnType<typeof usePlatform>): SettingsGroup[] {
  return [
    {
      label: language.t("settings.section.desktop"),
      pages: [
        { id: "general", icon: "general", label: language.t("settings.tab.general"), render: () => <SettingsGeneral /> },
        { id: "audio", icon: "audio", label: language.t("settings.fork.audio.title"), render: () => <SettingsAudio /> },
        { id: "shortcuts", icon: "shortcuts", label: language.t("settings.tab.shortcuts"), render: () => <SettingsKeybinds /> },
        { id: "memory", icon: "memory", label: language.t("settings.fork.memory.title"), render: () => <SettingsMemory /> },
      ],
    },
    {
      label: language.t("settings.section.ai"),
      pages: [
        { id: "providers", icon: "providers", label: language.t("settings.providers.title"), render: () => <SettingsProviders /> },
        { id: "models", icon: "models", label: language.t("settings.models.title"), render: () => <SettingsModels /> },
        { id: "benchmark", icon: "benchmark", label: language.t("settings.fork.benchmark.title"), render: () => <SettingsBenchmark /> },
      ],
    },
    {
      label: language.t("settings.section.infrastructure"),
      pages: [
        {
          id: "remote",
          icon: "compute",
          label: language.t("settings.tab.compute"),
          render: () => (
            <>
              <SettingsRemoteAccess />
              <Show when={platform.os === "android"}>
                <SettingsAndroid />
              </Show>
            </>
          ),
        },
        { id: "account", icon: "security", label: language.t("settings.tab.security"), render: () => <SettingsCollaborativeAuth /> },
        { id: "configuration", icon: "configuration", label: language.t("settings.localConfig.title"), render: () => <SettingsConfiguration /> },
        { id: "observability", icon: "observability", label: language.t("settings.fork.observability.title"), render: () => <SettingsObservability /> },
      ],
    },
    {
      label: language.t("settings.section.extensions"),
      pages: [{ id: "plugins", icon: "mcp", label: language.t("settings.tab.mcp"), render: () => <SettingsPlugins /> }],
    },
  ]
}

export const SettingsPanel: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const [tab, setTab] = createSignal("general")
  const groups = createMemo(() => settingsGroups(language, platform))

  return (
    <SettingsScopeProvider>
      <div data-v110="settings-frame" class="h-full">
        <SettingsCommandBar tab={tab()} />
        <Tabs
          orientation="vertical"
          variant="settings"
          value={tab()}
          onChange={setTab}
          class="settings-dialog min-h-0"
          data-v110="settings-dialog"
          data-parity="settings.dialog"
        >
          <Tabs.List>
            <div class="flex flex-col justify-between h-full w-full">
              <nav data-v110="settings-nav" class="flex flex-col w-full">
                <For each={groups()}>
                  {(group) => (
                    <>
                      <Tabs.SectionTitle>{group.label}</Tabs.SectionTitle>
                      <For each={group.pages}>
                        {(page) => (
                          <Tabs.Trigger value={page.id}>
                            <SettingsNavIcon name={page.icon} />
                            {page.label}
                          </Tabs.Trigger>
                        )}
                      </For>
                    </>
                  )}
                </For>
              </nav>
              <div data-v110="settings-version" class="flex flex-col">
                <span>{language.t("app.name.desktop")}</span>
                <b>v{platform.version}</b>
              </div>
            </div>
          </Tabs.List>
          <For each={groups().flatMap((group) => group.pages)}>
            {(page) => (
              <Tabs.Content value={page.id}>
                {page.render()}
              </Tabs.Content>
            )}
          </For>
        </Tabs>
      </div>
    </SettingsScopeProvider>
  )
}

const DialogSettingsDesktop: Component = SettingsPanel
