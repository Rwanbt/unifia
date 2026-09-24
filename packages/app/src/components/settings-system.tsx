/* SPDX-License-Identifier: MIT */

// Système -- the reference's system91 page (ADR-047): three status cards,
// Maintenance (updates, diagnostics) and the settings backup (export /
// import). Updates and export / import moved here from Général. The cards
// only show what the app knows: the version and update preference, the
// local AI models configured, and whether the config loads. Diagnostics has
// no backend yet and is shown disabled as Coming soon.

import { type Component, createResource, createSignal } from "solid-js"
import { Button } from "@unifia/ui/button"
import { Switch } from "@unifia/ui/switch"
import { showToast } from "@unifia/ui/toast"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { SettingsPage, SettingsSection } from "./settings-page"
import { SettingsRow } from "./settings-row"

const LOCAL_PROVIDER = "local-llm"

function useUpdateCheck() {
  const language = useLanguage()
  const platform = usePlatform()
  const [checking, setChecking] = createSignal(false)

  const check = () => {
    if (!platform.checkUpdate) return
    setChecking(true)
    void platform
      .checkUpdate()
      .then((result) => {
        if (!result.updateAvailable) {
          showToast({
            variant: "success",
            icon: "circle-check",
            title: language.t("settings.updates.toast.latest.title"),
            description: language.t("settings.updates.toast.latest.description", { version: platform.version ?? "" }),
          })
          return
        }
        const notYet = { label: language.t("toast.update.action.notYet"), onClick: "dismiss" as const }
        const install =
          platform.update && platform.restart
            ? [
                {
                  label: language.t("toast.update.action.installRestart"),
                  onClick: async () => {
                    await platform.update!()
                    await platform.restart!()
                  },
                },
              ]
            : []
        showToast({
          persistent: true,
          icon: "download",
          title: language.t("toast.update.title"),
          description: language.t("toast.update.description", { version: result.version ?? "" }),
          actions: [...install, notYet],
        })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
      .finally(() => setChecking(false))
  }

  return { checking, check, available: () => !!platform.checkUpdate }
}

// FORK: ADR-0005 Phase 6 — Export / Import global configuration.
function useConfigBackup() {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const [exporting, setExporting] = createSignal(false)
  const [importing, setImporting] = createSignal(false)

  const exportConfig = async () => {
    setExporting(true)
    try {
      const result = await globalSDK.client.config.get()
      if (!result.data) throw new Error(language.t("settings.fork.config.noDataReceived"))
      const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = "unifia-config.json"
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("settings.fork.config.exportFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setExporting(false)
    }
  }

  const importConfig = async (file: File) => {
    setImporting(true)
    try {
      const data = JSON.parse(await file.text())
      const result = await globalSDK.client.config.update(data)
      if (result.error) throw new Error(JSON.stringify(result.error))
      showToast({ variant: "success", title: language.t("settings.fork.config.imported") })
      setTimeout(() => window.location.reload(), 1500)
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("settings.fork.config.importFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setImporting(false)
    }
  }

  return { exporting, importing, exportConfig, importConfig }
}

export const SettingsSystem: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const settings = useSettings()
  const globalSDK = useGlobalSDK()
  const updates = useUpdateCheck()
  const backup = useConfigBackup()
  const soon = () => language.t("common.comingSoon")
  let fileInput!: HTMLInputElement

  const [config] = createResource(async () => {
    const result = await globalSDK.client.global.config.get()
    return result.error ? undefined : result.data
  })
  const localModels = () => Object.keys(config.latest?.provider?.[LOCAL_PROVIDER]?.models ?? {}).length
  const providerCount = () => Object.keys(config.latest?.provider ?? {}).length
  const mcpCount = () => Object.keys(config.latest?.mcp ?? {}).length

  return (
    <SettingsPage title={language.t("settings.system.title")} subtitle={language.t("settings.system.subtitle")}>
      <div data-slot="settings-status-cards">
        <div>
          <span>{language.t("app.name.desktop")}</span>
          <b>v{platform.version}</b>
          <small>
            {settings.updates.startup()
              ? language.t("settings.system.card.updatesAuto")
              : language.t("settings.system.card.updatesManual")}
          </small>
        </div>
        <div>
          <span>{language.t("settings.system.card.localAi")}</span>
          <b>llama.cpp</b>
          <small>
            {localModels() > 0
              ? language.t("settings.system.card.localModels", { count: localModels() })
              : language.t("settings.system.card.localNone")}
          </small>
        </div>
        <div>
          <span>{language.t("settings.system.card.config")}</span>
          <b>
            {config.loading && !config.latest
              ? "…"
              : config.latest
                ? language.t("settings.system.card.configValid")
                : language.t("settings.system.card.configError")}
          </b>
          <small>
            {language.t("settings.system.card.configCounts", { providers: providerCount(), mcp: mcpCount() })}
          </small>
        </div>
      </div>

      <SettingsSection title={language.t("settings.system.maintenance")}>
        <SettingsRow
          title={language.t("settings.system.updates.title")}
          description={language.t("settings.system.updates.description")}
        >
          <Button
            size="small"
            variant="secondary"
            disabled={updates.checking() || !updates.available()}
            onClick={updates.check}
          >
            {updates.checking()
              ? language.t("settings.updates.action.checking")
              : language.t("settings.system.updates.action")}
          </Button>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.updates.row.startup.title")}
          description={language.t("settings.updates.row.startup.description")}
        >
          <div data-action="settings-updates-startup">
            <Switch
              checked={settings.updates.startup()}
              disabled={!updates.available()}
              onChange={(checked) => settings.updates.setStartup(checked)}
            />
          </div>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.general.row.releaseNotes.title")}
          description={language.t("settings.general.row.releaseNotes.description")}
        >
          <div data-action="settings-release-notes">
            <Switch
              checked={settings.general.releaseNotes()}
              onChange={(checked) => settings.general.setReleaseNotes(checked)}
            />
          </div>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.system.diagnostics.title")}
          description={language.t("settings.system.diagnostics.description")}
        >
          <span title={soon()}>
            <Button size="small" variant="secondary" disabled>
              {language.t("settings.system.diagnostics.action")}
            </Button>
          </span>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={language.t("settings.system.backup")}>
        <SettingsRow
          title={language.t("settings.system.export.title")}
          description={language.t("settings.system.export.description")}
        >
          <Button size="small" variant="secondary" disabled={backup.exporting()} onClick={backup.exportConfig}>
            {backup.exporting()
              ? language.t("settings.fork.config.exporting")
              : language.t("settings.fork.config.export")}
          </Button>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.system.import.title")}
          description={language.t("settings.system.import.description")}
        >
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              if (file) void backup.importConfig(file)
              event.currentTarget.value = ""
            }}
          />
          <Button size="small" variant="secondary" disabled={backup.importing()} onClick={() => fileInput.click()}>
            {backup.importing()
              ? language.t("settings.fork.config.importing")
              : language.t("settings.fork.config.import")}
          </Button>
        </SettingsRow>
      </SettingsSection>
    </SettingsPage>
  )
}
