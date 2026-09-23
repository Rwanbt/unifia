import { type Component, Show, createMemo, createSignal } from "solid-js"
import { Dialog } from "@unifia/ui/dialog"
import { Tabs } from "@unifia/ui/tabs"
import { Icon } from "@unifia/ui/icon"
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

// ADR-047: the maquette's five groups. Pages the maquette merges live under
// its name: Remote access (and Android) is Compute, Se connecter is Security,
// Plugins is MCP until its skills move to their own page. Tab ids keep their
// old values so existing links still open the right page.
export const SettingsPanel: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const [tab, setTab] = createSignal("general")

  return (
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
              <Tabs.SectionTitle>{language.t("settings.section.desktop")}</Tabs.SectionTitle>
              <Tabs.Trigger value="general">
                <Icon name="sliders" />
                {language.t("settings.tab.general")}
              </Tabs.Trigger>
              <Tabs.Trigger value="audio">
                <Icon name="speaker" />
                {language.t("settings.fork.audio.title")}
              </Tabs.Trigger>
              <Tabs.Trigger value="shortcuts">
                <Icon name="keyboard" />
                {language.t("settings.tab.shortcuts")}
              </Tabs.Trigger>
              <Tabs.Trigger value="memory">
                <Icon name="brain" />
                {language.t("settings.fork.memory.title")}
              </Tabs.Trigger>

              <Tabs.SectionTitle>{language.t("settings.section.ai")}</Tabs.SectionTitle>
              <Tabs.Trigger value="providers">
                <Icon name="providers" />
                {language.t("settings.providers.title")}
              </Tabs.Trigger>
              <Tabs.Trigger value="models">
                <Icon name="models" />
                {language.t("settings.models.title")}
              </Tabs.Trigger>
              <Tabs.Trigger value="benchmark">
                <Icon name="speedometer" />
                {language.t("settings.fork.benchmark.title")}
              </Tabs.Trigger>

              <Tabs.SectionTitle>{language.t("settings.section.infrastructure")}</Tabs.SectionTitle>
              <Tabs.Trigger value="remote">
                <Icon name="server" />
                {language.t("settings.tab.compute")}
              </Tabs.Trigger>
              <Tabs.Trigger value="account">
                <Icon name="shield" />
                {language.t("settings.tab.security")}
              </Tabs.Trigger>
              <Tabs.Trigger value="configuration">
                <Icon name="console" />
                {language.t("settings.localConfig.title")}
              </Tabs.Trigger>
              <Tabs.Trigger value="observability">
                <Icon name="eye" />
                {language.t("settings.fork.observability.title")}
              </Tabs.Trigger>

              <Tabs.SectionTitle>{language.t("settings.section.extensions")}</Tabs.SectionTitle>
              <Tabs.Trigger value="plugins">
                <Icon name="mcp" />
                {language.t("settings.tab.mcp")}
              </Tabs.Trigger>
            </nav>
            <div data-v110="settings-version" class="flex flex-col">
              <span>{language.t("app.name.desktop")}</span>
              <b>v{platform.version}</b>
            </div>
          </div>
        </Tabs.List>
        <Tabs.Content value="general" class="no-scrollbar">
          <SettingsGeneral />
        </Tabs.Content>
        <Tabs.Content value="audio" class="no-scrollbar">
          <SettingsAudio />
        </Tabs.Content>
        <Tabs.Content value="shortcuts" class="no-scrollbar">
          <SettingsKeybinds />
        </Tabs.Content>
        <Tabs.Content value="memory" class="no-scrollbar">
          <SettingsMemory />
        </Tabs.Content>
        <Tabs.Content value="providers" class="no-scrollbar">
          <SettingsProviders />
        </Tabs.Content>
        <Tabs.Content value="models" class="no-scrollbar">
          <SettingsModels />
        </Tabs.Content>
        <Tabs.Content value="benchmark" class="no-scrollbar">
          <SettingsBenchmark />
        </Tabs.Content>
        <Tabs.Content value="remote" class="no-scrollbar">
          <SettingsRemoteAccess />
          <Show when={platform.os === "android"}>
            <SettingsAndroid />
          </Show>
        </Tabs.Content>
        <Tabs.Content value="account" class="no-scrollbar">
          <SettingsCollaborativeAuth />
        </Tabs.Content>
        <Tabs.Content value="configuration" class="no-scrollbar">
          <SettingsConfiguration />
        </Tabs.Content>
        <Tabs.Content value="observability" class="no-scrollbar">
          <SettingsObservability />
        </Tabs.Content>
        <Tabs.Content value="plugins" class="no-scrollbar">
          <SettingsPlugins />
        </Tabs.Content>
      </Tabs>
    </div>
  )
}

const DialogSettingsDesktop: Component = SettingsPanel
