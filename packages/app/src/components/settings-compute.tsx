/* SPDX-License-Identifier: MIT */

// Compute -- the reference's compute32 page (ADR-047). The computes are the
// app's real server list (this device's runtime, remote and SSH servers),
// with their health and the active one; "Connect" opens the server dialog.
// Access to this instance is the desktop remote-access settings. Automatic
// routing across computes has no engine yet: shown disabled as Coming soon.

import { createResource, For, Show } from "solid-js"
import { Button } from "@unifia/ui/button"
import { useDialog } from "@unifia/ui/context/dialog"
import { Switch } from "@unifia/ui/switch"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { ServerConnection, serverName, useServer } from "@/context/server"
import { useCheckServerHealth } from "@/utils/server-health"
import { ComputeIcon, computeKind } from "./compute-icon"
import { SettingsPage } from "./settings-page"
import { SettingsRemoteAccess } from "./settings-remote-access"
import { SettingsAndroid } from "./settings-android"

export function SettingsCompute() {
  const language = useLanguage()
  const platform = usePlatform()
  const server = useServer()
  const dialog = useDialog()
  const checkHealth = useCheckServerHealth()
  const soon = () => language.t("common.comingSoon")
  let access: HTMLDivElement | undefined

  const openServers = () => {
    void import("./dialog-select-server").then((x) => dialog.show(() => <x.DialogSelectServer />))
  }

  const [health] = createResource(
    () => server.list,
    async (list) => {
      const entries = await Promise.all(
        list.map(async (conn) => [ServerConnection.key(conn), await checkHealth(conn.http)] as const),
      )
      return Object.fromEntries(entries)
    },
  )
  const online = () => Object.values(health() ?? {}).filter((item) => item.healthy).length

  return (
    <SettingsPage
      title={language.t("settings.tab.compute")}
      subtitle={language.t("settings.compute.subtitle")}
      intro={{
        icon: "▣",
        title: language.t("settings.providers.intro.title"),
        text: language.t("settings.compute.intro"),
      }}
    >
      <div data-slot="compute-hero">
        <div data-slot="compute-card" title={soon()}>
          <div data-slot="compute-auto-icon">
            <ComputeIcon name="auto" />
          </div>
          <div data-slot="compute-copy">
            <b>{language.t("settings.compute.auto.title")}</b>
            <p>{language.t("settings.compute.auto.description")}</p>
          </div>
          <Switch checked={false} disabled hideLabel>
            {language.t("settings.compute.auto.title")}
          </Switch>
        </div>
        <div data-slot="compute-policy" data-soon title={soon()}>
          <h4>{language.t("settings.compute.policy.title")}</h4>
          <For each={["local", "long", "fallback"] as const}>
            {(row) => (
              <div data-slot="compute-policy-row">
                <span>{language.t(`settings.compute.policy.${row}.label`)}</span>
                <b>{language.t(`settings.compute.policy.${row}.value`)}</b>
              </div>
            )}
          </For>
        </div>
      </div>

      <div data-slot="compute-section-head">
        <h3>{language.t("settings.compute.computes")}</h3>
        <span data-slot="compute-count">
          {language.t("settings.compute.count", { online: online(), total: server.list.length })}
        </span>
        <Button size="small" variant="primary" onClick={openServers}>
          {language.t("settings.compute.connect")}
        </Button>
      </div>
      <div data-slot="compute-grid">
        <For each={server.list}>
          {(conn) => {
            const key = ServerConnection.key(conn)
            const kind = computeKind(conn)
            const state = () => health()?.[key]
            return (
              <article data-slot="compute-device">
                <div data-slot="compute-device-head">
                  <div data-slot="compute-device-icon">
                    <ComputeIcon name={kind === "local" || kind === "wsl" ? "monitor" : "server"} />
                  </div>
                  <div data-slot="compute-device-copy">
                    <b>{kind === "local" ? language.t("settings.compute.thisDevice") : serverName(conn)}</b>
                    <span>{language.t(`settings.compute.kind.${kind}`)}</span>
                  </div>
                  <span data-slot="compute-state" data-offline={state() && !state()!.healthy ? "" : undefined}>
                    {state() === undefined
                      ? "…"
                      : state()!.healthy
                        ? language.t("settings.compute.ready")
                        : language.t("settings.compute.offline")}
                  </span>
                </div>
                <div data-slot="compute-meta">
                  <div>
                    <span>{language.t("settings.compute.meta.address")}</span>
                    <b>{serverName(conn, true)}</b>
                  </div>
                  <div>
                    <span>{language.t("settings.compute.meta.version")}</span>
                    <b>{state()?.version ?? "—"}</b>
                  </div>
                </div>
                <div data-slot="compute-device-actions">
                  <button type="button" onClick={openServers}>
                    {language.t("settings.compute.details")}
                  </button>
                  <Show
                    when={server.key !== key}
                    fallback={
                      <button type="button" data-primary disabled>
                        {language.t("settings.compute.active")}
                      </button>
                    }
                  >
                    <button type="button" data-primary onClick={() => server.setActive(key)}>
                      {language.t("settings.compute.useHere")}
                    </button>
                  </Show>
                  <Show when={conn.type === "http"}>
                    <button type="button" onClick={() => server.remove(key)}>
                      {language.t("common.disconnect")}
                    </button>
                  </Show>
                </div>
              </article>
            )
          }}
        </For>
      </div>

      <div ref={access} data-slot="compute-section-head">
        <h3>{language.t("settings.compute.access")}</h3>
        <span data-slot="compute-count">{language.t("settings.compute.inbound")}</span>
      </div>
      <Show
        when={platform.getRemoteAccess}
        fallback={<p data-slot="settings-note">{language.t("settings.compute.desktopOnly")}</p>}
      >
        <SettingsRemoteAccess />
        <Show when={platform.os === "android"}>
          <SettingsAndroid />
        </Show>
      </Show>

      <div data-slot="compute-section-head">
        <h3>{language.t("settings.compute.connectSection")}</h3>
      </div>
      <div data-slot="compute-add-grid">
        <button type="button" data-slot="compute-add" onClick={openServers}>
          <ComputeIcon name="server" />
          <b>{language.t("settings.compute.add.remote.title")}</b>
          <p>{language.t("settings.compute.add.remote.description")}</p>
        </button>
        {/* Pairing lives in the desktop access settings above (QR). */}
        <button
          type="button"
          data-slot="compute-add"
          disabled={!platform.getRemoteAccess}
          title={platform.getRemoteAccess ? undefined : soon()}
          onClick={() => access?.scrollIntoView({ block: "start", behavior: "smooth" })}
        >
          <ComputeIcon name="phone" />
          <b>{language.t("settings.compute.add.pair.title")}</b>
          <p>{language.t("settings.compute.add.pair.description")}</p>
        </button>
      </div>
      <p data-slot="compute-note">
        <b>{language.t("settings.compute.note.lead")}</b> {language.t("settings.compute.note.text")}
      </p>
    </SettingsPage>
  )
}
