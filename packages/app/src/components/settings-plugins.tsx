// FORK: ADR-0005 Phase 5 — Plugin manager (MCP Servers full CRUD + Skills placeholder).
// Integrates as the "Plugins" tab in dialog-settings.tsx.
import { createResource, createSignal, For, Show, type Component } from "solid-js"
import { Button } from "@unifia/ui/button"
import { showToast } from "@unifia/ui/toast"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"

// ─── Skills section ─────────────────────────────────────────────────────────

type SkillInfo = { name: string; description: string; location: string; content: string }

function skillFileName(location: string): string {
  return location.replace(/\\/g, "/").split("/").slice(-2).join("/")
}

const SkillsSection: Component = () => {
  const language = useLanguage()
  const sdk = useSDK()
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

  const isGlobalSkill = (location: string) => {
    const norm = location.replace(/\\/g, "/")
    return norm.includes("/.claude/skills/") || norm.includes("/.agents/skills/")
  }

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

  return (
    <div class="flex flex-col gap-3">
      {/* Install via URL */}
      <div class="flex flex-col gap-2 px-1">
        <p class="text-11-regular text-text-weaker uppercase tracking-wide">
          {language.t("settings.fork.plugins.installSkill")}
        </p>
        <div class="flex gap-2">
          <input
            class="flex-1 bg-surface-base border border-border-weak-base rounded px-2 py-1.5 text-12-regular text-text-base outline-none focus:border-accent-primary placeholder:text-text-weakest"
            placeholder={language.t("settings.fork.plugins.skillUrlPlaceholder")}
            value={installUrl()}
            onInput={(e) => setInstallUrl(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleInstall()
            }}
            disabled={installing()}
          />
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

      {/* Installed skills list */}
      <Show when={skills.loading}>
        <div class="text-text-weak text-12-regular px-3 py-2">{language.t("settings.fork.plugins.loading")}</div>
      </Show>

      <Show when={!skills.loading && (skills()?.length ?? 0) > 0}>
        <div class="flex flex-col">
          <p class="text-11-regular text-text-weaker px-1 mb-1 uppercase tracking-wide">
            {language.t("settings.fork.plugins.skillsInstalled", { count: skills()!.length })}
          </p>
          <For each={skills()}>
            {(skill) => (
              <div class="flex items-start gap-2 px-2 py-2 hover:bg-surface-base rounded">
                <div class="flex flex-col flex-1 min-w-0 gap-0.5">
                  <div class="flex items-baseline gap-2">
                    <span class="text-12-medium text-text-strong">{skill.name}</span>
                    <span
                      class="text-11-regular text-text-weaker font-mono truncate max-w-[180px]"
                      title={skill.location}
                    >
                      {skillFileName(skill.location)}
                    </span>
                  </div>
                  <span class="text-11-regular text-text-weak leading-snug">{skill.description}</span>
                </div>
                <Show when={isGlobalSkill(skill.location)}>
                  <button
                    type="button"
                    disabled={removingName() === skill.name}
                    onClick={() => void handleUninstall(skill.name)}
                    class="text-10-regular text-text-weaker hover:text-error-base shrink-0 px-1 py-0.5 rounded"
                    title={language.t("settings.fork.plugins.uninstall")}
                  >
                    {removingName() === skill.name ? "…" : "✕"}
                  </button>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={!skills.loading && (skills()?.length ?? 0) === 0}>
        <div class="text-12-regular text-text-weaker text-center py-4 border border-dashed border-border-weak-base rounded-lg">
          {language.t("settings.fork.plugins.noSkills")}
        </div>
      </Show>

      {/* Format documentation */}
      <details class="bg-surface-base rounded-lg text-12-regular text-text-weak">
        <summary class="px-4 py-3 cursor-pointer select-none text-13-medium text-text-strong">
          {language.t("settings.fork.plugins.skillFormat")}
        </summary>
        <div class="px-4 pb-4 leading-relaxed">
          <p class="mb-3 mt-1">
            {language.t("settings.fork.plugins.skillDocumentation")}{" "}
            <span class="font-mono text-text-base">~/.config/opencode/skills/</span>{" "}
            {language.t("settings.fork.plugins.or")} <span class="font-mono text-text-base">.opencode/skills/</span> (
            {language.t("settings.fork.plugins.project")}.)
          </p>
          <pre class="bg-background-stronger rounded p-3 text-11-regular font-mono overflow-x-auto whitespace-pre text-text-base mb-3">{`---
name: my-skill
description: ${language.t("settings.fork.plugins.skillExampleDescription")}
metadata:
  category: text-only
---

# Instructions

${language.t("settings.fork.plugins.skillExampleInstructions")}`}</pre>
          <p class="text-11-regular opacity-70">
            {language.t("settings.fork.plugins.categories")} <span class="font-mono">text-only</span> (
            {language.t("settings.fork.plugins.systemPrompt")}), <span class="font-mono">js</span> (
            {language.t("settings.fork.plugins.webviewSandbox")}), <span class="font-mono">native</span> (
            {language.t("settings.fork.plugins.androidIntents")}).
          </p>
        </div>
      </details>
    </div>
  )
}

// ─── Main export ────────────────────────────────────────────────────────────

// The reference's Skills page (ADR-047: Plugins split into MCP and Skills).
export const SettingsPlugins: Component = () => <SkillsSection />
