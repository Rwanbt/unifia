/* SPDX-License-Identifier: MIT */

// Security -- the reference's security91 page (ADR-047). Its switches and
// selects are the config's real permission rules, written for the scope
// picked in the command bar: "confirm sensitive actions" is edit + bash on
// "ask", files outside the project is `external_directory`, tool network
// access is `webfetch`. Locking secrets with the session has no backend yet
// (Coming soon). Signing in to a collaborative server stays on this page.

import { createResource, For, Show } from "solid-js"
import { Button } from "@unifia/ui/button"
import { Select } from "@unifia/ui/select"
import { Switch } from "@unifia/ui/switch"
import { useLanguage } from "@/context/language"
import type { Config } from "@/types/sdk-shim"
import { SettingsCollaborativeAuth } from "./settings-collaborative-auth"
import { SettingsPage, SettingsSection } from "./settings-page"
import { SettingsRow } from "./settings-row"
import { useSettingsScope } from "./settings-scope"

type Action = "ask" | "allow" | "deny"
type Permission = Exclude<NonNullable<Config["permission"]>, string>

const ACTIONS: Action[] = ["ask", "deny", "allow"]
// The engine's defaults when a rule is unset (agent.ts: "*" allow,
// external_directory "*" ask).
const DEFAULT_ACTION: Record<string, Action> = { external_directory: "ask" }

export function SettingsSecurity() {
  const language = useLanguage()
  const settings = useSettingsScope()

  const [config, configActions] = createResource(settings.scope, () => settings.config.get())
  const raw = () => config()?.permission
  // A single action string applies to every tool; editing per-rule from
  // here would silently change the others, so the controls stay read-only.
  const global = () => (typeof raw() === "string" ? (raw() as Action) : undefined)
  const rules = (): Permission => (typeof raw() === "object" ? (raw() as Permission) : {})
  // A rule may be one action or per-pattern ({ "*": ..., "<dir>": ... }):
  // the page shows and edits its "*" entry, keeping the patterns.
  const action = (key: string): Action => {
    const value = global() ?? rules()[key]
    if (typeof value === "string") return value as Action
    if (value && typeof value === "object" && !Array.isArray(value) && "*" in value) return value["*"] as Action
    return DEFAULT_ACTION[key] ?? "allow"
  }
  const confirming = () => action("edit") === "ask" || action("bash") === "ask"

  const write = async (patch: Record<string, Action>) => {
    const latest = await settings.config.get()
    const current: Permission = typeof latest.permission === "object" ? latest.permission : {}
    const next: Permission = { ...current }
    for (const [key, value] of Object.entries(patch)) {
      const existing = current[key]
      next[key] =
        existing && typeof existing === "object" && !Array.isArray(existing) ? { ...existing, "*": value } : value
    }
    await settings.config.update({ ...latest, permission: next })
    await configActions.refetch()
  }

  const actionLabel = (value: Action) => language.t(`settings.security.action.${value}`)

  const status = () => [
    { key: "secrets", value: language.t("settings.security.status.secrets.value") },
    {
      key: "actions",
      value: language.t(
        confirming() ? "settings.security.status.actions.value" : "settings.security.status.actions.off",
      ),
    },
    {
      key: "scope",
      value: language.t(
        settings.scope() === "project" ? "settings.security.status.scope.project" : "settings.scope.personal",
      ),
    },
  ]

  return (
    <SettingsPage title={language.t("settings.tab.security")} subtitle={language.t("settings.security.subtitle")}>
      <div data-slot="settings-status-cards">
        <For each={status()}>
          {(item) => (
            <div>
              <span>{language.t(`settings.security.status.${item.key}.label`)}</span>
              <b>{item.value}</b>
              <small>{language.t(`settings.security.status.${item.key}.description`)}</small>
            </div>
          )}
        </For>
      </div>

      <SettingsSection title={language.t("settings.security.protection")}>
        <SettingsRow
          title={language.t("settings.security.confirm.title")}
          description={language.t("settings.security.confirm.description")}
        >
          <Switch
            checked={confirming()}
            disabled={config.loading || global() !== undefined}
            onChange={(on) => void write({ edit: on ? "ask" : "allow", bash: on ? "ask" : "allow" })}
            hideLabel
          >
            {language.t("settings.security.confirm.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.security.lock.title")}
          description={language.t("settings.security.lock.description")}
        >
          <span title={language.t("common.comingSoon")}>
            <Switch checked={false} disabled hideLabel>
              {language.t("settings.security.lock.title")}
            </Switch>
          </span>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.security.keys.title")}
          description={language.t("settings.security.keys.description")}
        >
          <Button size="small" onClick={() => settings.openPage("providers")}>
            {language.t("settings.security.keys.manage")}
          </Button>
        </SettingsRow>
      </SettingsSection>
      <Show when={global()}>
        <p data-slot="settings-note">
          {language.t("settings.security.globalRule", { action: actionLabel(global()!) })}
        </p>
      </Show>

      {/* Technical details only, as in the reference. */}
      <Show when={settings.detail() === "technical"}>
        <SettingsSection title={language.t("settings.security.technical")}>
          <For each={["external_directory", "webfetch"] as const}>
            {(key) => (
              <SettingsRow
                title={language.t(`settings.security.rule.${key}.title`)}
                description={language.t(`settings.security.rule.${key}.description`)}
              >
                <Select
                  options={ACTIONS}
                  current={action(key)}
                  label={actionLabel}
                  disabled={config.loading || global() !== undefined}
                  onSelect={(value) => {
                    if (value) void write({ [key]: value })
                  }}
                  variant="secondary"
                  size="small"
                  triggerVariant="settings"
                />
              </SettingsRow>
            )}
          </For>
        </SettingsSection>
      </Show>

      <h3>{language.t("settings.security.account")}</h3>
      <SettingsCollaborativeAuth />
    </SettingsPage>
  )
}
