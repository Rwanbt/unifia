/* SPDX-License-Identifier: MIT */

// MCP -- the reference's MCP page (ADR-047): counters, a search and category
// filters over one card grid. The configured servers come first, with their
// real status and actions (connect / disconnect, authorize, remove); the
// suggested integrations below prefill the add form, which the user reviews
// before `mcp.add` writes the server to the global config.

import { createMemo, createSignal, For, onMount, Show, type Component } from "solid-js"
import { useMutation } from "@tanstack/solid-query"
import { Button } from "@unifia/ui/button"
import { Icon } from "@unifia/ui/icon"
import { showToast } from "@unifia/ui/toast"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import { MCP_CATALOG, MCP_CATEGORIES, type McpCategory, type McpTemplate } from "./settings-mcp-catalog"
import { SettingsPage } from "./settings-page"

type McpStatusKind = "connected" | "disabled" | "failed" | "needs_auth" | "needs_client_registration"
type McpStatus = { status: McpStatusKind; error?: string }

function statusLabel(language: ReturnType<typeof useLanguage>, kind: McpStatusKind | undefined) {
  if (kind === "connected") return language.t("settings.fork.plugins.statusConnected")
  if (kind === "failed") return language.t("settings.fork.plugins.statusError")
  if (kind === "needs_auth") return language.t("settings.fork.plugins.statusAuthRequired")
  if (kind === "needs_client_registration") return language.t("settings.fork.plugins.statusRegistrationRequired")
  if (kind === "disabled") return language.t("settings.fork.plugins.statusDisabled")
  return ""
}

const initials = (name: string) =>
  name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("")

export const SettingsMcp: Component = () => {
  const language = useLanguage()
  const sdk = useSDK()
  // WHY the local fallback: the settings dialog renders through the shared
  // DialogOutlet at RouterRoot, above SyncProvider (route-scoped), so
  // `useSync()` throws there and MCP management was unreachable from Settings
  // ("unavailable outside an active session" — reproduced in CI, issue #101).
  // Outside the dialog the sync store stays the one in-memory source; inside
  // it, the same real backend route (`mcp.status`) feeds a local signal.
  let sync: ReturnType<typeof useSync> | undefined
  try {
    sync = useSync()
  } catch {}
  const [local, setLocal] = createSignal<Record<string, McpStatus> | undefined>()
  const data = () => (sync?.data.mcp as Record<string, McpStatus> | undefined) ?? local() ?? {}

  const refreshStatus = async () => {
    const result = await sdk.client.mcp.status()
    if (!result.data) return
    if (sync) sync.set("mcp", result.data)
    else setLocal(result.data as Record<string, McpStatus>)
  }
  onMount(() => {
    if (!sync) void refreshStatus().catch(() => undefined)
  })

  const [query, setQuery] = createSignal("")
  const [category, setCategory] = createSignal<McpCategory | "all">("all")
  const [showAdd, setShowAdd] = createSignal(false)
  const [addType, setAddType] = createSignal<"remote" | "local">("remote")
  const [addName, setAddName] = createSignal("")
  const [addTarget, setAddTarget] = createSignal("")
  let form: HTMLDivElement | undefined

  const openForm = (template?: McpTemplate) => {
    setAddType(template?.transport ?? "remote")
    setAddName(template?.id ?? "")
    setAddTarget(template?.target ?? "")
    setShowAdd(true)
    requestAnimationFrame(() => form?.scrollIntoView({ block: "center", behavior: "smooth" }))
  }
  const closeForm = () => {
    setShowAdd(false)
    setAddName("")
    setAddTarget("")
  }

  const matches = (text: string) => text.toLowerCase().includes(query().trim().toLowerCase())
  const servers = createMemo(() =>
    Object.entries(data())
      .map(([name, status]) => ({ name, status }))
      .filter((server) => matches(server.name))
      .sort((a, b) => a.name.localeCompare(b.name)),
  )
  const suggestions = createMemo(() =>
    MCP_CATALOG.filter(
      (item) =>
        !(item.id in data()) &&
        (category() === "all" || item.category === category()) &&
        matches(`${item.name} ${language.t(`settings.mcp.catalog.${item.id}`)}`),
    ),
  )
  const connected = () => Object.values(data()).filter((server) => server.status === "connected").length

  const fail = (title: string) => (err: unknown) =>
    showToast({ variant: "error", title, description: err instanceof Error ? err.message : String(err) })

  const toggle = useMutation(() => ({
    mutationFn: async (name: string) => {
      if (data()[name]?.status === "connected") await sdk.client.mcp.disconnect({ name })
      else await sdk.client.mcp.connect({ name })
      await refreshStatus()
    },
    onError: fail(language.t("settings.fork.plugins.mcpError")),
  }))
  const remove = useMutation(() => ({
    mutationFn: async (name: string) => {
      await sdk.client.mcp.remove({ name })
      await refreshStatus()
    },
    onError: fail(language.t("settings.fork.plugins.mcpError")),
  }))
  const auth = useMutation(() => ({
    mutationFn: async (name: string) => {
      await sdk.client.mcp.auth.authenticate({ name })
      await refreshStatus()
    },
    onError: fail(language.t("settings.fork.plugins.mcpAuth")),
  }))
  const addServer = useMutation(() => ({
    mutationFn: async () => {
      const name = addName().trim()
      if (!name) throw new Error(language.t("settings.fork.plugins.nameRequired"))
      // McpLocalConfig.command is string[] (command + args as array)
      const config =
        addType() === "remote"
          ? { type: "remote" as const, url: addTarget().trim(), enabled: true }
          : { type: "local" as const, command: addTarget().trim().split(/\s+/).filter(Boolean), enabled: true }
      await sdk.client.mcp.add({ name, config })
      closeForm()
      await refreshStatus()
    },
    onError: fail(language.t("settings.fork.plugins.addFailed")),
  }))

  const pending = (name: string) =>
    (toggle.isPending && toggle.variables === name) ||
    (remove.isPending && remove.variables === name) ||
    (auth.isPending && auth.variables === name)

  return (
    <SettingsPage
      large
      title={language.t("settings.tab.mcp")}
      subtitle={language.t("settings.mcp.subtitle")}
      actions={
        <>
          <button type="button" data-slot="mcp-action" onClick={() => setCategory("all")}>
            {language.t("settings.mcp.catalogAction")}
          </button>
          <button
            type="button"
            data-slot="mcp-action"
            data-primary
            data-action="settings-mcp-add-toggle"
            onClick={() => openForm()}
          >
            {language.t("settings.mcp.custom")}
          </button>
        </>
      }
    >
      <div data-slot="mcp-summary">
        <div>
          <b>{connected()}</b>
          <span>{language.t("settings.mcp.connected")}</span>
        </div>
        <div>
          <b>{MCP_CATALOG.length}</b>
          <span>{language.t("settings.mcp.suggested")}</span>
        </div>
        <div>
          <b>{language.t("settings.mcp.global")}</b>
          <span>{language.t("settings.mcp.scope")}</span>
        </div>
      </div>

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
            placeholder={language.t("settings.mcp.search")}
            aria-label={language.t("settings.mcp.search")}
          />
        </label>
        <div data-slot="mcp-filters" role="group">
          <For each={["all", ...MCP_CATEGORIES] as const}>
            {(value) => (
              <button type="button" aria-pressed={category() === value} onClick={() => setCategory(value)}>
                {language.t(`settings.mcp.category.${value}`)}
              </button>
            )}
          </For>
        </div>
      </div>

      <Show when={showAdd()}>
        <div ref={form} data-slot="mcp-form">
          <b>{language.t("settings.fork.plugins.newMcp")}</b>
          <div data-slot="settings-segmented" role="group">
            <button
              type="button"
              aria-pressed={addType() === "remote"}
              data-action="settings-mcp-type-remote"
              onClick={() => setAddType("remote")}
            >
              {language.t("settings.fork.plugins.remote")}
            </button>
            <button
              type="button"
              aria-pressed={addType() === "local"}
              data-action="settings-mcp-type-local"
              onClick={() => setAddType("local")}
            >
              {language.t("settings.fork.plugins.local")}
            </button>
          </div>
          <input
            type="text"
            data-slot="settings-text-field"
            data-action="settings-mcp-name"
            aria-label={language.t("settings.fork.plugins.name")}
            value={addName()}
            onInput={(event) => setAddName(event.currentTarget.value)}
            placeholder={language.t("settings.fork.plugins.serverNamePlaceholder")}
          />
          <input
            type="text"
            data-slot="settings-text-field"
            data-action={addType() === "remote" ? "settings-mcp-url" : "settings-mcp-command"}
            aria-label={language.t(
              addType() === "remote" ? "settings.fork.plugins.url" : "settings.fork.plugins.command",
            )}
            value={addTarget()}
            onInput={(event) => setAddTarget(event.currentTarget.value)}
            placeholder={language.t(
              addType() === "remote"
                ? "settings.fork.plugins.urlPlaceholderExample"
                : "settings.fork.plugins.commandPlaceholderExample",
            )}
          />
          <div data-slot="mcp-form-actions">
            <Button size="small" onClick={closeForm}>
              {language.t("common.cancel")}
            </Button>
            <Button
              size="small"
              variant="primary"
              disabled={addServer.isPending || !addName().trim() || !addTarget().trim()}
              data-action="settings-mcp-submit"
              onClick={() => addServer.mutate()}
            >
              {addServer.isPending
                ? language.t("settings.fork.plugins.adding")
                : language.t("settings.fork.plugins.add")}
            </Button>
          </div>
        </div>
      </Show>

      <div data-slot="mcp-catalog">
        <For each={servers()}>
          {(server) => {
            const kind = () => server.status.status
            return (
              <article
                data-slot="mcp-card"
                data-connected={kind() === "connected" ? "" : undefined}
                data-mcp-server={server.name}
              >
                <div data-slot="mcp-logo">{initials(server.name)}</div>
                <div data-slot="mcp-copy">
                  <div data-slot="mcp-title">
                    <b>{server.name}</b>
                    <span data-slot="mcp-badge">{statusLabel(language, kind())}</span>
                  </div>
                  <Show when={server.status.error} fallback={<p>{language.t("settings.mcp.configured")}</p>}>
                    <p data-tone="error">{server.status.error}</p>
                  </Show>
                  <div data-slot="mcp-meta">
                    <Show when={kind() === "needs_auth" || kind() === "needs_client_registration"}>
                      <button type="button" disabled={pending(server.name)} onClick={() => auth.mutate(server.name)}>
                        {language.t("settings.fork.plugins.authorize")}
                      </button>
                    </Show>
                    <button
                      type="button"
                      disabled={pending(server.name)}
                      title={language.t("settings.fork.plugins.confirmRemove", { name: server.name })}
                      data-action="settings-mcp-remove"
                      onClick={() => remove.mutate(server.name)}
                    >
                      <Icon name="trash" size="small" />
                      {language.t("settings.mcp.remove")}
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  data-slot="mcp-connect"
                  disabled={pending(server.name)}
                  onClick={() => toggle.mutate(server.name)}
                >
                  {kind() === "connected" ? language.t("settings.mcp.isConnected") : language.t("common.connect")}
                </button>
              </article>
            )
          }}
        </For>
        <For each={suggestions()}>
          {(item) => (
            <article data-slot="mcp-card" data-mcp-template={item.id}>
              <div data-slot="mcp-logo">{item.logo}</div>
              <div data-slot="mcp-copy">
                <div data-slot="mcp-title">
                  <b>{item.name}</b>
                  <span data-slot="mcp-badge">{language.t(`settings.mcp.category.${item.category}`)}</span>
                </div>
                <p>{language.t(`settings.mcp.catalog.${item.id}`)}</p>
                <div data-slot="mcp-meta">
                  <span>
                    {language.t(
                      item.transport === "remote" ? "settings.fork.plugins.remote" : "settings.fork.plugins.local",
                    )}
                  </span>
                </div>
              </div>
              <button type="button" data-slot="mcp-connect" onClick={() => openForm(item)}>
                {language.t("common.connect")}
              </button>
            </article>
          )}
        </For>
      </div>
      <Show when={servers().length === 0 && suggestions().length === 0}>
        <p data-slot="settings-empty">{language.t("settings.mcp.none")}</p>
      </Show>
    </SettingsPage>
  )
}
