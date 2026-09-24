/* SPDX-License-Identifier: MIT */

// Skills -- the reference's skills49 page (ADR-047). The cards are the skills
// the server really loads. Their switch is the config's `permission.skill`
// rule for that name, written for the picked scope: off is "deny", which the
// engine drops from the agent's list (skill/index.ts). Import installs a
// SKILL.md from a URL; Add shows the format for writing one by hand.

import { createMemo, createResource, createSignal, For, Show, type Component } from "solid-js"
import { Button } from "@unifia/ui/button"
import { Switch } from "@unifia/ui/switch"
import { showToast } from "@unifia/ui/toast"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import type { Config } from "@/types/sdk-shim"
import { SettingsPage } from "./settings-page"
import { useSettingsScope } from "./settings-scope"

type SkillInfo = { name: string; description: string; location: string; content: string }
type Permission = Exclude<NonNullable<Config["permission"]>, string>
type Panel = "import" | "format" | undefined

function skillFileName(location: string): string {
  return location.replace(/\\/g, "/").split("/").slice(-2).join("/")
}

const isGlobalSkill = (location: string) => {
  const norm = location.replace(/\\/g, "/")
  return norm.includes("/.claude/skills/") || norm.includes("/.agents/skills/")
}

export const SettingsSkills: Component = () => {
  const language = useLanguage()
  const sdk = useSDK()
  const settings = useSettingsScope()
  const [query, setQuery] = createSignal("")
  const [panel, setPanel] = createSignal<Panel>()
  const [installUrl, setInstallUrl] = createSignal("")
  const [installing, setInstalling] = createSignal(false)
  const [removingName, setRemovingName] = createSignal<string | null>(null)

  const [skills, { refetch: refetchSkills }] = createResource(
    () => sdk.directory,
    async (dir) => {
      try {
        const res = await sdk.client.app.skills({ directory: dir })
        return (res.data ?? []) as SkillInfo[]
      } catch {
        return [] as SkillInfo[]
      }
    },
  )
  const [config, configActions] = createResource(settings.scope, () => settings.config.get())

  const rules = () => {
    const permission = config()?.permission
    const skill = typeof permission === "object" ? permission.skill : undefined
    return typeof skill === "object" && !Array.isArray(skill) ? skill : {}
  }
  const enabled = (name: string) => rules()[name] !== "deny"

  const setEnabled = async (name: string, on: boolean) => {
    const latest = await settings.config.get()
    const permission: Permission = typeof latest.permission === "object" ? latest.permission : {}
    const current = typeof permission.skill === "object" && !Array.isArray(permission.skill) ? permission.skill : {}
    const next = { ...current }
    if (on) delete next[name]
    else next[name] = "deny"
    await settings.config.update({ ...latest, permission: { ...permission, skill: next } })
    await configActions.refetch()
  }

  const visible = createMemo(() => {
    const term = query().trim().toLowerCase()
    return (skills() ?? []).filter((skill) => `${skill.name} ${skill.description}`.toLowerCase().includes(term))
  })

  async function handleInstall() {
    const url = installUrl().trim()
    if (!url) return
    setInstalling(true)
    try {
      const res = await fetch(`${sdk.url}/skill/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      })
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as { error: string }
        showToast({ variant: "error", title: language.t("settings.fork.plugins.installFailed"), description: error })
      } else {
        const info = (await res.json()) as SkillInfo
        showToast({
          variant: "success",
          title: language.t("settings.fork.plugins.skillInstalled", { name: info.name }),
        })
        setInstallUrl("")
        setPanel(undefined)
        void refetchSkills()
      }
    } catch (e) {
      showToast({ variant: "error", title: language.t("settings.fork.plugins.networkError"), description: String(e) })
    } finally {
      setInstalling(false)
    }
  }

  async function handleUninstall(name: string) {
    setRemovingName(name)
    try {
      const res = await fetch(`${sdk.url}/skill/${encodeURIComponent(name)}`, { method: "DELETE" })
      if (!res.ok) {
        showToast({ variant: "error", title: language.t("settings.fork.plugins.uninstallFailed") })
      } else {
        showToast({ variant: "success", title: language.t("settings.fork.plugins.skillUninstalled", { name }) })
        void refetchSkills()
      }
    } catch (e) {
      showToast({ variant: "error", title: language.t("settings.fork.plugins.networkError"), description: String(e) })
    } finally {
      setRemovingName(null)
    }
  }

  const toggle = (next: Panel) => setPanel(panel() === next ? undefined : next)

  return (
    <SettingsPage
      large
      title={language.t("settings.fork.plugins.tabSkills")}
      subtitle={language.t("settings.skills.subtitle")}
      actions={
        <>
          <button
            type="button"
            data-slot="mcp-action"
            aria-pressed={panel() === "import"}
            onClick={() => toggle("import")}
          >
            {language.t("settings.skills.import")}
          </button>
          <button
            type="button"
            data-slot="mcp-action"
            data-primary
            aria-pressed={panel() === "format"}
            onClick={() => toggle("format")}
          >
            {language.t("settings.skills.add")}
          </button>
        </>
      }
    >
      <Show when={panel() === "import"}>
        <div data-slot="mcp-form">
          <b>{language.t("settings.fork.plugins.installSkill")}</b>
          <input
            type="text"
            data-slot="settings-text-field"
            aria-label={language.t("settings.fork.plugins.installSkill")}
            placeholder={language.t("settings.fork.plugins.skillUrlPlaceholder")}
            value={installUrl()}
            onInput={(e) => setInstallUrl(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleInstall()
            }}
            disabled={installing()}
          />
          <div data-slot="mcp-form-actions">
            <Button size="small" onClick={() => setPanel(undefined)}>
              {language.t("common.cancel")}
            </Button>
            <Button
              size="small"
              variant="primary"
              disabled={!installUrl().trim() || installing()}
              onClick={() => void handleInstall()}
            >
              {installing()
                ? language.t("settings.fork.plugins.installing")
                : language.t("settings.fork.plugins.installSkill")}
            </Button>
          </div>
        </div>
      </Show>

      <Show when={panel() === "format"}>
        <div data-slot="mcp-form">
          <b>{language.t("settings.fork.plugins.skillFormat")}</b>
          <p data-slot="settings-note" data-flush>
            {language.t("settings.fork.plugins.skillDocumentation")}{" "}
            <code data-slot="settings-code">~/.config/opencode/skills/</code> {language.t("settings.fork.plugins.or")}{" "}
            <code data-slot="settings-code">.opencode/skills/</code> ({language.t("settings.fork.plugins.project")}.)
          </p>
          <pre data-slot="settings-pre">{`---
name: my-skill
description: ${language.t("settings.fork.plugins.skillExampleDescription")}
metadata:
  category: text-only
---

# Instructions

${language.t("settings.fork.plugins.skillExampleInstructions")}`}</pre>
          <p data-slot="settings-note" data-flush>
            {language.t("settings.fork.plugins.categories")} <code data-slot="settings-code">text-only</code> (
            {language.t("settings.fork.plugins.systemPrompt")}), <code data-slot="settings-code">js</code> (
            {language.t("settings.fork.plugins.webviewSandbox")}), <code data-slot="settings-code">native</code> (
            {language.t("settings.fork.plugins.androidIntents")}).
          </p>
        </div>
      </Show>

      <div data-slot="mcp-toolbar">
        <label data-slot="mcp-search">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6" />
            <path d="m20 20-4.2-4.2" />
          </svg>
          <input
            type="search"
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
            placeholder={language.t("settings.skills.search")}
            aria-label={language.t("settings.skills.search")}
          />
        </label>
      </div>

      <Show
        when={!skills.loading}
        fallback={<p data-slot="settings-empty">{language.t("settings.fork.plugins.loading")}</p>}
      >
        <Show
          when={visible().length > 0}
          fallback={<p data-slot="settings-empty">{language.t("settings.fork.plugins.noSkills")}</p>}
        >
          <div data-slot="skill-grid">
            <For each={visible()}>
              {(skill) => (
                <div data-slot="skill-card">
                  <div data-slot="skill-icon" aria-hidden="true">
                    ✦
                  </div>
                  <div data-slot="skill-copy" title={skill.location}>
                    <b>{skill.name}</b>
                    <span>{skill.description || skillFileName(skill.location)}</span>
                  </div>
                  <div data-slot="skill-actions">
                    <Show when={isGlobalSkill(skill.location)}>
                      <button
                        type="button"
                        disabled={removingName() === skill.name}
                        onClick={() => void handleUninstall(skill.name)}
                        title={language.t("settings.fork.plugins.uninstall")}
                        aria-label={language.t("settings.fork.plugins.uninstall")}
                      >
                        {removingName() === skill.name ? "…" : "✕"}
                      </button>
                    </Show>
                    <Switch
                      checked={enabled(skill.name)}
                      disabled={config.loading}
                      onChange={(on) => void setEnabled(skill.name, on)}
                      hideLabel
                    >
                      {skill.name}
                    </Switch>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </SettingsPage>
  )
}
