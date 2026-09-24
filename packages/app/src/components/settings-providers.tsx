import { Button } from "@unifia/ui/button"
import { useDialog } from "@unifia/ui/context/dialog"
import { ProviderIcon } from "@unifia/ui/provider-icon"
import { showToast } from "@unifia/ui/toast"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { createMemo, type Component, For, type JSX, type ParentProps, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
// Dialog modules below are loaded on-demand (see dialog.show() callers) to keep
// the main chunk lean — each of them pulls its own form/validation tree.
import { SettingsPage } from "./settings-page"

type ProviderSource = "env" | "api" | "config" | "custom"
type ProviderItem = ReturnType<ReturnType<typeof useProviders>["connected"]>[number]

const PROVIDER_NOTES = [
  { match: (id: string) => id === "local-llm", key: "dialog.provider.localLlm.note" },
  { match: (id: string) => id === "unifia", key: "dialog.provider.opencode.note" },
  { match: (id: string) => id === "unifia-go", key: "dialog.provider.opencodeGo.tagline" },
  { match: (id: string) => id === "anthropic", key: "dialog.provider.anthropic.note" },
  { match: (id: string) => id.startsWith("github-copilot"), key: "dialog.provider.copilot.note" },
  { match: (id: string) => id === "openai", key: "dialog.provider.openai.note" },
  { match: (id: string) => id === "google", key: "dialog.provider.google.note" },
  { match: (id: string) => id === "openrouter", key: "dialog.provider.openrouter.note" },
  { match: (id: string) => id === "vercel", key: "dialog.provider.vercel.note" },
] as const

export const SettingsProviders: Component = () => {
  const dialog = useDialog()
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const providers = useProviders()

  const connected = createMemo(() => {
    return providers.connected().filter((p) => p.id !== "unifia" || Object.values(p.models).find((m) => m.cost?.input))
  })

  const popular = createMemo(() => {
    const connectedIDs = new Set(connected().map((p) => p.id))
    const items = providers
      .popular()
      .filter((p) => !connectedIDs.has(p.id))
      .slice()
    items.sort((a, b) => popularProviders.indexOf(a.id) - popularProviders.indexOf(b.id))
    return items
  })

  const source = (item: ProviderItem): ProviderSource | undefined => {
    if (!("source" in item)) return
    const value = item.source
    if (value === "env" || value === "api" || value === "config" || value === "custom") return value
    return
  }

  const type = (item: ProviderItem) => {
    const current = source(item)
    if (current === "env") return language.t("settings.providers.tag.environment")
    if (current === "api") return language.t("provider.connect.method.apiKey")
    if (current === "config") {
      if (isConfigCustom(item.id)) return language.t("settings.providers.tag.custom")
      return language.t("settings.providers.tag.config")
    }
    if (current === "custom") return language.t("settings.providers.tag.custom")
    return language.t("settings.providers.tag.other")
  }

  const canDisconnect = (item: ProviderItem) => source(item) !== "env"

  const note = (id: string) => PROVIDER_NOTES.find((item) => item.match(id))?.key

  const isConfigCustom = (providerID: string) => {
    const provider = globalSync.data.config?.provider?.[providerID]
    if (!provider) return false
    if (provider.npm !== "@ai-sdk/openai-compatible") return false
    if (!provider.models || Object.keys(provider.models).length === 0) return false
    return true
  }

  const disableProvider = async (providerID: string, name: string) => {
    const before = globalSync.data.config?.disabled_providers ?? []
    const next = before.includes(providerID) ? before : [...before, providerID]
    globalSync.set("config", "disabled_providers", next)

    await globalSync
      .updateConfig({ disabled_providers: next })
      .then(() => {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("provider.disconnect.toast.disconnected.title", { provider: name }),
          description: language.t("provider.disconnect.toast.disconnected.description", { provider: name }),
        })
      })
      .catch((err: unknown) => {
        globalSync.set("config", "disabled_providers", before)
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
  }

  const disconnect = async (providerID: string, name: string) => {
    if (isConfigCustom(providerID)) {
      await globalSDK.client.auth.remove({ providerID }).catch(() => undefined)
      await disableProvider(providerID, name)
      return
    }
    await globalSDK.client.auth
      .remove({ providerID })
      .then(async () => {
        await globalSDK.client.global.dispose()
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("provider.disconnect.toast.disconnected.title", { provider: name }),
          description: language.t("provider.disconnect.toast.disconnected.description", { provider: name }),
        })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
  }

  const openLocalModels = () => {
    void import("./dialog-local-llm").then((x) => {
      dialog.show(() => <x.DialogLocalLLM />)
    })
  }
  const connectProvider = (id: string) => {
    void import("./dialog-connect-provider").then((x) => {
      dialog.show(() => <x.DialogConnectProvider provider={id} />)
    })
  }

  // The reference's single .provider-list: connected providers first, then
  // local AI, then everything that can still be connected.
  return (
    <SettingsPage
      title={language.t("settings.providers.title")}
      intro={{
        icon: "☁",
        title: language.t("settings.providers.intro.title"),
        text: language.t("settings.providers.intro.text"),
      }}
    >
      <h3>{language.t("settings.providers.section.connected")}</h3>
      <section data-slot="provider-list" data-component="connected-providers-section">
        <For each={connected()}>
          {(item) => (
            <ProviderCard
              id={item.id}
              name={item.name}
              badges={
                <>
                  <span data-slot="settings-badge">{type(item)}</span>
                  <span data-slot="settings-badge" data-tone="success">
                    {language.t("settings.providers.state.ready")}
                  </span>
                </>
              }
            >
              <Show
                when={canDisconnect(item)}
                fallback={
                  <span data-slot="settings-value">
                    {language.t("settings.providers.connected.environmentDescription")}
                  </span>
                }
              >
                <Button size="small" data-tone="danger" onClick={() => void disconnect(item.id, item.name)}>
                  {language.t("common.disconnect")}
                </Button>
              </Show>
            </ProviderCard>
          )}
        </For>

        <ProviderCard
          id="local-llm"
          name={language.t("settings.fork.providers.localAi")}
          description={language.t("dialog.provider.localLlm.note")}
          badges={
            <span data-slot="settings-badge" data-tone="success">
              {language.t("settings.fork.providers.onDevice")}
            </span>
          }
        >
          <Button size="small" onClick={openLocalModels}>
            {language.t("dialog.model.manage")}
          </Button>
        </ProviderCard>

        <For each={popular().filter((p) => p.id !== "local-llm")}>
          {(item) => (
            <ProviderCard
              id={item.id}
              name={item.name}
              description={note(item.id) ? language.t(note(item.id)!) : undefined}
              badges={
                <>
                  <Show when={item.id === "unifia" || item.id === "unifia-go"}>
                    <span data-slot="settings-badge">{language.t("dialog.provider.tag.recommended")}</span>
                  </Show>
                  <span data-slot="settings-badge">{language.t("settings.providers.state.notConnected")}</span>
                </>
              }
            >
              <Button size="small" onClick={() => connectProvider(item.id)}>
                {language.t("common.connect")}
              </Button>
            </ProviderCard>
          )}
        </For>

        <ProviderCard
          id="synthetic"
          name={language.t("provider.custom.title")}
          description={language.t("settings.providers.custom.description")}
          component="custom-provider-section"
          badges={
            <>
              <span data-slot="settings-badge">{language.t("settings.providers.tag.custom")}</span>
              <span data-slot="settings-badge">{language.t("settings.providers.state.notConnected")}</span>
            </>
          }
        >
          <Button
            size="small"
            onClick={() => {
              void import("./dialog-custom-provider").then((x) => {
                dialog.show(() => <x.DialogCustomProvider back="close" />)
              })
            }}
          >
            {language.t("common.connect")}
          </Button>
        </ProviderCard>
      </section>

      <div data-slot="settings-center-action">
        <Button
          size="small"
          onClick={() => {
            void import("./dialog-select-provider").then((x) => {
              dialog.show(() => <x.DialogSelectProvider />)
            })
          }}
        >
          {language.t("dialog.provider.viewAll")}
        </Button>
      </div>
    </SettingsPage>
  )
}

/** One `.provider-card`: logo box, name with its badges, a description, an action. */
function ProviderCard(
  props: ParentProps<{ id: string; name: string; description?: string; badges?: JSX.Element; component?: string }>,
) {
  return (
    <div data-slot="provider-card" data-component={props.component}>
      <div data-slot="provider-logo">
        <ProviderIcon id={props.id} class="icon-strong-base" />
      </div>
      <div class="min-w-0">
        <div data-slot="provider-title">
          <span>{props.name}</span>
          {props.badges}
        </div>
        <Show when={props.description}>
          <div data-slot="setting-desc">{props.description}</div>
        </Show>
      </div>
      <div>{props.children}</div>
    </div>
  )
}
