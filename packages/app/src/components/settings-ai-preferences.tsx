/* SPDX-License-Identifier: MIT */

// AI preferences -- the reference's "Préférences IA" page (routing91). Only
// the manual choice has a backend: it is the config's default `model`,
// written for the scope picked in the command bar. The automatic priorities,
// behaviour switches and per-capability routing have no engine behind them
// yet, so they are shown disabled as "Coming soon" (ADR-047).

import { createResource, For, Show } from "solid-js"
import { Select } from "@unifia/ui/select"
import { Switch } from "@unifia/ui/switch"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { SettingsPage, SettingsSection } from "./settings-page"
import { SettingsRow } from "./settings-row"
import { useSettingsScope } from "./settings-scope"

const PROFILES = ["private", "balanced", "quality", "economy", "manual"] as const
const CAPABILITIES = ["code", "reasoning"] as const

type ModelOption = { value: string; label: string }

export function SettingsAiPreferences() {
  const language = useLanguage()
  const models = useModels()
  const settings = useSettingsScope()
  const soon = () => language.t("common.comingSoon")

  const [config, configActions] = createResource(settings.scope, () => settings.config.get())
  const options = (): ModelOption[] =>
    models.list().map((model) => ({
      value: `${model.provider.id}/${model.id}`,
      label: `${model.name} · ${model.provider.name}`,
    }))
  const current = () => options().find((option) => option.value === config()?.model)

  const selectModel = async (option: ModelOption | undefined) => {
    if (!option) return
    const latest = await settings.config.get()
    await settings.config.update({ ...latest, model: option.value })
    await configActions.refetch()
  }

  return (
    <SettingsPage
      title={language.t("settings.aiPreferences.title")}
      subtitle={language.t("settings.aiPreferences.subtitle")}
      intro={{
        icon: "✦",
        title: language.t("settings.aiPreferences.intro.title"),
        text: language.t("settings.aiPreferences.intro.text"),
      }}
    >
      <h3>{language.t("settings.aiPreferences.priority")}</h3>
      <div data-slot="settings-profile-grid">
        <For each={PROFILES}>
          {(profile) => (
            // Manual is what Unifia does today: the model you pick is the one used.
            <button
              type="button"
              data-slot="settings-profile-card"
              aria-pressed={profile === "manual"}
              disabled={profile !== "manual"}
              title={profile === "manual" ? undefined : soon()}
            >
              <b>{language.t(`settings.aiPreferences.profile.${profile}.title`)}</b>
              <span>{language.t(`settings.aiPreferences.profile.${profile}.description`)}</span>
            </button>
          )}
        </For>
      </div>

      <SettingsSection title={language.t("settings.aiPreferences.manual")}>
        <SettingsRow
          title={language.t("settings.aiPreferences.model.title")}
          description={language.t("settings.aiPreferences.model.description")}
        >
          <Select
            options={options()}
            current={current()}
            value={(option) => option.value}
            label={(option) => option.label}
            placeholder={language.t("settings.aiPreferences.model.none")}
            onSelect={(option) => void selectModel(option)}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>
      </SettingsSection>
      <p data-slot="settings-note">
        {language.t("settings.aiPreferences.effective")}{" "}
        <b>{current()?.label ?? language.t("settings.aiPreferences.model.none")}</b>
      </p>

      <SettingsSection title={language.t("settings.aiPreferences.behaviour")}>
        <For each={["local", "cloudFallback"] as const}>
          {(key) => (
            <SettingsRow
              title={language.t(`settings.aiPreferences.${key}.title`)}
              description={language.t(`settings.aiPreferences.${key}.description`)}
            >
              <span title={soon()}>
                <Switch checked={false} disabled hideLabel>
                  {language.t(`settings.aiPreferences.${key}.title`)}
                </Switch>
              </span>
            </SettingsRow>
          )}
        </For>
      </SettingsSection>

      {/* Technical details only: routing by capability. */}
      <Show when={settings.detail() === "technical"}>
        <SettingsSection title={language.t("settings.aiPreferences.routing")}>
          <For each={CAPABILITIES}>
            {(capability) => (
              <SettingsRow
                title={language.t(`settings.aiPreferences.routing.${capability}.title`)}
                description={language.t(`settings.aiPreferences.routing.${capability}.description`)}
              >
                <span title={soon()}>
                  <Select
                    options={["auto"]}
                    current="auto"
                    label={() => language.t("settings.aiPreferences.routing.auto")}
                    onSelect={() => undefined}
                    disabled
                    variant="secondary"
                    size="small"
                    triggerVariant="settings"
                  />
                </span>
              </SettingsRow>
            )}
          </For>
        </SettingsSection>
      </Show>
    </SettingsPage>
  )
}
