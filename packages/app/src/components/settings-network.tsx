/* SPDX-License-Identifier: MIT */

// Network -- the reference's network91 page (ADR-047). The server reads its
// proxy from the system environment (HTTP(S)_PROXY) and exposes no setting
// for it or for extra certificates, so those controls are Coming soon. The
// status cards are real: browser connectivity, whether the active server is
// on this machine, and the system proxy the server actually uses.

import { createSignal, For, onCleanup } from "solid-js"
import { Switch } from "@unifia/ui/switch"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { SettingsPage, SettingsSection } from "./settings-page"
import { SettingsRow } from "./settings-row"

export function SettingsNetwork() {
  const language = useLanguage()
  const server = useServer()
  const soon = () => language.t("common.comingSoon")

  const [online, setOnline] = createSignal(navigator.onLine)
  const update = () => setOnline(navigator.onLine)
  window.addEventListener("online", update)
  window.addEventListener("offline", update)
  onCleanup(() => {
    window.removeEventListener("online", update)
    window.removeEventListener("offline", update)
  })

  const status = () => [
    {
      label: language.t("settings.network.status.internet"),
      value: language.t(online() ? "settings.network.status.online" : "settings.network.status.offline"),
      note: language.t(online() ? "settings.network.status.onlineNote" : "settings.network.status.offlineNote"),
    },
    {
      label: language.t("settings.network.status.local"),
      value: language.t(server.isLocal() ? "settings.network.status.localhost" : "settings.network.status.remote"),
      note: language.t(
        server.isLocal() ? "settings.network.status.localhostNote" : "settings.network.status.remoteNote",
      ),
    },
    {
      label: language.t("settings.network.status.proxy"),
      value: language.t("settings.network.status.system"),
      note: language.t("settings.network.status.systemNote"),
    },
  ]

  return (
    <SettingsPage
      title={language.t("settings.network.title")}
      subtitle={language.t("settings.network.subtitle")}
      intro={{
        icon: "◎",
        title: language.t("settings.network.intro.title"),
        text: language.t("settings.network.intro.text"),
      }}
    >
      <SettingsSection title={language.t("settings.network.connection")}>
        <SettingsRow
          title={language.t("settings.network.proxy.title")}
          description={language.t("settings.network.proxy.description")}
        >
          <input
            type="text"
            data-slot="settings-text-field"
            data-wide
            disabled
            title={soon()}
            placeholder={language.t("settings.network.proxy.placeholder")}
            aria-label={language.t("settings.network.proxy.title")}
          />
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.network.certificates.title")}
          description={language.t("settings.network.certificates.description")}
        >
          <span title={soon()}>
            <Switch checked={false} disabled hideLabel>
              {language.t("settings.network.certificates.title")}
            </Switch>
          </span>
        </SettingsRow>
      </SettingsSection>

      <h3>{language.t("settings.network.state")}</h3>
      <div data-slot="settings-status-cards">
        <For each={status()}>
          {(item) => (
            <div>
              <span>{item.label}</span>
              <b>{item.value}</b>
              <small>{item.note}</small>
            </div>
          )}
        </For>
      </div>
    </SettingsPage>
  )
}
