/* SPDX-License-Identifier: MIT */

// Hooks -- the reference's hooks49 page (ADR-047). The server has no hook
// configuration yet: lifecycle actions are what plugins provide today. The
// page lists the configured plugins (the config's `plugin` entries, read
// only) and shows the reference's hook templates disabled as Coming soon,
// never as hooks that would run.

import { createResource, For, Show } from "solid-js"
import { Switch } from "@unifia/ui/switch"
import { useLanguage } from "@/context/language"
import { SettingsPage } from "./settings-page"
import { useSettingsScope } from "./settings-scope"

const TEMPLATES = ["guard", "audit", "context", "memory", "format", "incident"] as const

export function SettingsHooks() {
  const language = useLanguage()
  const settings = useSettingsScope()
  const soon = () => language.t("common.comingSoon")
  const [config] = createResource(settings.scope, () => settings.config.get())
  const plugins = () =>
    (config.latest?.plugin ?? []).map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)))

  return (
    <SettingsPage
      large
      title={language.t("settings.hooks.title")}
      subtitle={language.t("settings.hooks.subtitle")}
      actions={
        <button type="button" data-slot="mcp-action" data-primary disabled title={soon()}>
          {language.t("settings.hooks.new")}
        </button>
      }
    >
      <h3>{language.t("settings.hooks.plugins")}</h3>
      <Show
        when={plugins().length > 0}
        fallback={
          <p data-slot="settings-note" data-flush>
            {language.t("settings.hooks.noPlugins")}
          </p>
        }
      >
        <div data-slot="hook-list">
          <For each={plugins()}>
            {(plugin) => (
              <div data-slot="hook-row">
                <div data-slot="skill-copy">
                  <b>{plugin}</b>
                  <span>{language.t("settings.hooks.pluginDescription")}</span>
                </div>
                <span data-slot="hook-event">{language.t("settings.hooks.pluginBadge")}</span>
              </div>
            )}
          </For>
        </div>
      </Show>

      <h3>{language.t("settings.hooks.templates")}</h3>
      <div data-slot="hook-list" data-soon title={soon()}>
        <For each={TEMPLATES}>
          {(template) => (
            <div data-slot="hook-row">
              <div data-slot="skill-copy">
                <b>{language.t(`settings.hooks.template.${template}.title`)}</b>
                <span>{language.t(`settings.hooks.template.${template}.description`)}</span>
              </div>
              <span data-slot="hook-event">{language.t(`settings.hooks.template.${template}.event`)}</span>
              <Switch checked={false} disabled hideLabel>
                {language.t(`settings.hooks.template.${template}.title`)}
              </Switch>
            </div>
          )}
        </For>
      </div>
    </SettingsPage>
  )
}
