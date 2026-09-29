import { type Component, type JSX, For, Show, createMemo, createSignal } from "solid-js"
import { Dialog } from "@unifia/ui/dialog"
import { Tabs } from "@unifia/ui/tabs"
import { useLanguage } from "@/context/language"
import { useModeInspector } from "@/context/mode-inspector"
import { settingsInspectorCards } from "./settings-inspector-cards"
import { usePlatform } from "@/context/platform"
import { useViewport, type Viewport } from "@/shell/v110-store"
import { SettingsMobileNav } from "./settings-mobile-nav"
import { SettingsGeneral } from "./settings-general"
import { SettingsAudio } from "./settings-audio"
import { SettingsConfiguration } from "./settings-configuration"
import { SettingsKeybinds } from "./settings-keybinds"
import { SettingsProviders } from "./settings-providers"
import { SettingsModels } from "./settings-models"
import { SettingsAiPreferences } from "./settings-ai-preferences"
import { SettingsBenchmark } from "./settings-benchmark"
import { SettingsSkills } from "./settings-skills"
import { SettingsHooks } from "./settings-hooks"
import { SettingsSystem } from "./settings-system"
import { SettingsMcp } from "./settings-mcp"
import { SettingsObservability } from "./settings-observability"
import { SettingsMemory } from "./settings-memory"
import { SettingsCompute } from "./settings-compute"
import { SettingsSecurity } from "./settings-security"
import { SettingsNetwork } from "./settings-network"
import { SettingsCommandBar } from "./settings-command-bar"
import { SettingsScopeProvider } from "./settings-scope"
import { SettingsPageBoundary } from "./settings-page"
import { SettingsNavIcon, type SettingsIconName } from "./settings-nav-icon"

export const DialogSettings: Component = () => (
  <Dialog size="x-large" transition>
    <SettingsPanel />
  </Dialog>
)

// ADR-047: the maquette's five groups, in its order. Pages the maquette
// merges live under its name: Remote access (and Android) is Compute, Se
// connecter is Security, Plugins is MCP. Tab ids keep their old values so
// existing links still open the right page.
export type SettingsPage = { id: string; icon: SettingsIconName; label: string; render: () => JSX.Element }
export type SettingsGroup = { label: string; pages: SettingsPage[] }

function settingsGroups(language: ReturnType<typeof useLanguage>): SettingsGroup[] {
  return [
    {
      label: language.t("settings.section.desktop"),
      pages: [
        {
          id: "general",
          icon: "general",
          label: language.t("settings.tab.general"),
          render: () => <SettingsGeneral />,
        },
        { id: "audio", icon: "audio", label: language.t("settings.fork.audio.title"), render: () => <SettingsAudio /> },
        {
          id: "shortcuts",
          icon: "shortcuts",
          label: language.t("settings.tab.shortcuts"),
          render: () => <SettingsKeybinds />,
        },
        {
          id: "memory",
          icon: "memory",
          label: language.t("settings.fork.memory.title"),
          render: () => <SettingsMemory />,
        },
      ],
    },
    {
      label: language.t("settings.section.ai"),
      pages: [
        {
          id: "providers",
          icon: "providers",
          label: language.t("settings.providers.title"),
          render: () => <SettingsProviders />,
        },
        { id: "models", icon: "models", label: language.t("settings.models.title"), render: () => <SettingsModels /> },
        {
          id: "routing",
          icon: "routing",
          label: language.t("settings.aiPreferences.title"),
          render: () => <SettingsAiPreferences />,
        },
        {
          id: "benchmark",
          icon: "benchmark",
          label: language.t("settings.fork.benchmark.title"),
          render: () => <SettingsBenchmark />,
        },
      ],
    },
    {
      label: language.t("settings.section.infrastructure"),
      pages: [
        {
          id: "remote",
          icon: "compute",
          label: language.t("settings.tab.compute"),
          render: () => <SettingsCompute />,
        },
        {
          id: "account",
          icon: "security",
          label: language.t("settings.tab.security"),
          render: () => <SettingsSecurity />,
        },
        {
          id: "configuration",
          icon: "configuration",
          label: language.t("settings.localConfig.title"),
          render: () => <SettingsConfiguration />,
        },
        {
          id: "network",
          icon: "network",
          label: language.t("settings.network.title"),
          render: () => <SettingsNetwork />,
        },
        {
          id: "observability",
          icon: "observability",
          label: language.t("settings.fork.observability.title"),
          render: () => <SettingsObservability />,
        },
      ],
    },
    {
      label: language.t("settings.section.extensions"),
      pages: [
        { id: "plugins", icon: "mcp", label: language.t("settings.tab.mcp"), render: () => <SettingsMcp /> },
        {
          id: "skills",
          icon: "skills",
          label: language.t("settings.fork.plugins.tabSkills"),
          render: () => <SettingsSkills />,
        },
        { id: "hooks", icon: "hooks", label: language.t("settings.hooks.title"), render: () => <SettingsHooks /> },
      ],
    },
    {
      label: language.t("settings.section.system"),
      pages: [
        { id: "system", icon: "system", label: language.t("settings.system.title"), render: () => <SettingsSystem /> },
      ],
    },
  ]
}

/** Overlay families get the drill-down instead of the side-by-side tabs (ADR-083). */
function isOverlay(viewport: Viewport, os: ReturnType<typeof usePlatform>["os"]) {
  if (os === "ios" || os === "android") return true
  return viewport === "phone-portrait" || viewport === "tablet-portrait" || viewport === "compact-landscape"
}

export const SettingsPanel: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const viewport = useViewport()
  const [tab, setTab] = createSignal("general")
  // The drill-down's open page; the desktop tabs always show `tab`.
  const [mobilePage, setMobilePage] = createSignal<string>()
  const groups = createMemo(() => settingsGroups(language))
  useModeInspector().publish("settings", () => {
    const group = groups().find((candidate) => candidate.pages.some((page) => page.id === tab()))
    const page = group?.pages.find((candidate) => candidate.id === tab())
    return settingsInspectorCards({ section: group?.label, page: page?.label }, language.t)
  })
  const overlay = createMemo(() => isOverlay(viewport(), platform.os))
  const openPage = (id: string) => {
    setTab(id)
    setMobilePage(id)
  }

  return (
    <SettingsScopeProvider onOpenPage={openPage}>
      <div data-v110="settings-frame" data-overlay={overlay() ? "" : undefined} class="h-full">
        <SettingsCommandBar tab={tab()} />
        <Show
          when={!overlay()}
          fallback={
            <SettingsMobileNav
              groups={groups()}
              page={mobilePage()}
              active={tab()}
              onOpen={openPage}
              onBack={() => setMobilePage(undefined)}
            />
          }
        >
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
                // WHY: a page's resources would otherwise suspend the app-level
                // Suspense (app.tsx) and blank the whole session while they load.
                <Tabs.Content value={page.id}>
                  <SettingsPageBoundary>{page.render()}</SettingsPageBoundary>
                </Tabs.Content>
              )}
            </For>
          </Tabs>
        </Show>
      </div>
    </SettingsScopeProvider>
  )
}
