import { useDialog } from "@unifia/ui/context/dialog"
import { Icon } from "@unifia/ui/icon"
import { Switch } from "@unifia/ui/switch"
import { Tabs } from "@unifia/ui/tabs"
import { useMutation } from "@tanstack/solid-query"
import { showToast } from "@unifia/ui/toast"
import { useNavigate } from "@solidjs/router"
import { type Accessor, createEffect, createMemo, For, type JSXElement, onCleanup, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { ServerHealthIndicator } from "@/components/server/server-row"
import { ComputeIcon, computeKind } from "./compute-icon"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { normalizeServerUrl, ServerConnection, serverName, useServer } from "@/context/server"
import { useSync } from "@/context/sync"
import { useLspDiagnostics } from "@/context/lsp-diagnostics"
import { useCheckServerHealth, type ServerHealth } from "@/utils/server-health"

const pollMs = 10_000

const pluginEmptyMessage = (value: string, file: string): JSXElement => {
  const parts = value.split(file)
  if (parts.length === 1) return value
  return (
    <>
      {parts[0]}
      <code class="bg-surface-raised-base px-1.5 py-0.5 rounded-sm text-text-base">{file}</code>
      {parts.slice(1).join(file)}
    </>
  )
}

const listServersByHealth = (
  list: ServerConnection.Any[],
  active: ServerConnection.Key | undefined,
  status: Record<ServerConnection.Key, ServerHealth | undefined>,
) => {
  if (!list.length) return list
  const order = new Map(list.map((url, index) => [url, index] as const))
  const rank = (value?: ServerHealth) => {
    if (value?.healthy === true) return 0
    if (value?.healthy === false) return 2
    return 1
  }

  return list.slice().sort((a, b) => {
    if (ServerConnection.key(a) === active) return -1
    if (ServerConnection.key(b) === active) return 1
    const diff = rank(status[ServerConnection.key(a)]) - rank(status[ServerConnection.key(b)])
    if (diff !== 0) return diff
    return (order.get(a) ?? 0) - (order.get(b) ?? 0)
  })
}

const useServerHealth = (servers: Accessor<ServerConnection.Any[]>, enabled: Accessor<boolean>) => {
  const checkServerHealth = useCheckServerHealth()
  const [status, setStatus] = createStore({} as Record<ServerConnection.Key, ServerHealth | undefined>)

  createEffect(() => {
    if (!enabled()) {
      setStatus(reconcile({}))
      return
    }
    const list = servers()
    let dead = false

    const refresh = async () => {
      const results: Record<string, ServerHealth> = {}
      await Promise.all(
        list.map(async (conn) => {
          results[ServerConnection.key(conn)] = await checkServerHealth(conn.http)
        }),
      )
      if (dead) return
      setStatus(reconcile(results))
    }

    void refresh()
    const id = setInterval(() => void refresh(), pollMs)
    onCleanup(() => {
      dead = true
      clearInterval(id)
    })
  })

  return status
}

const useDefaultServerKey = (
  get: (() => string | Promise<string | null | undefined> | null | undefined) | undefined,
) => {
  const [state, setState] = createStore({
    url: undefined as string | undefined,
    tick: 0,
  })

  createEffect(() => {
    state.tick
    let dead = false
    const result = get?.()
    if (!result) {
      setState("url", undefined)
      onCleanup(() => {
        dead = true
      })
      return
    }

    if (result instanceof Promise) {
      void result.then((next) => {
        if (dead) return
        setState("url", next ? normalizeServerUrl(next) : undefined)
      })
      onCleanup(() => {
        dead = true
      })
      return
    }

    setState("url", normalizeServerUrl(result))
    onCleanup(() => {
      dead = true
    })
  })

  return {
    key: () => {
      const u = state.url
      if (!u) return
      return ServerConnection.key({ type: "http", http: { url: u } })
    },
    refresh: () => setState("tick", (value) => value + 1),
  }
}

const useMcpToggleMutation = () => {
  const sync = useSync()
  const sdk = useSDK()
  const language = useLanguage()

  return useMutation(() => ({
    mutationFn: async (name: string) => {
      const status = sync.data.mcp[name]
      await (status?.status === "connected" ? sdk.client.mcp.disconnect({ name }) : sdk.client.mcp.connect({ name }))
      const result = await sdk.client.mcp.status()
      if (result.data) sync.set("mcp", result.data)
    },
    onError: (err) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    },
  }))
}

export function StatusPopoverBody(props: { shown: Accessor<boolean> }) {
  const sync = useSync()
  const server = useServer()
  const platform = usePlatform()
  const dialog = useDialog()
  const language = useLanguage()
  const navigate = useNavigate()
  const sdk = useSDK()
  const diagnostics = useLspDiagnostics()

  const [load, setLoad] = createStore({
    lspDone: false,
    lspLoading: false,
    mcpDone: false,
    mcpLoading: false,
  })

  const fail = (err: unknown) => {
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: err instanceof Error ? err.message : String(err),
    })
  }

  createEffect(() => {
    if (!props.shown()) return

    if (!sync.data.mcp_ready && !load.mcpDone && !load.mcpLoading) {
      setLoad("mcpLoading", true)
      void sdk.client.mcp
        .status()
        .then((result) => {
          sync.set("mcp", result.data ?? {})
          sync.set("mcp_ready", true)
        })
        .catch((err) => {
          setLoad("mcpDone", true)
          fail(err)
        })
        .finally(() => {
          setLoad("mcpLoading", false)
        })
    }

    if (!sync.data.lsp_ready && !load.lspDone && !load.lspLoading) {
      setLoad("lspLoading", true)
      void sdk.client.lsp
        .status()
        .then((result) => {
          sync.set("lsp", result.data ?? [])
          sync.set("lsp_ready", true)
        })
        .catch((err) => {
          setLoad("lspDone", true)
          fail(err)
        })
        .finally(() => {
          setLoad("lspLoading", false)
        })
    }
  })

  let dialogRun = 0
  let dialogDead = false
  onCleanup(() => {
    dialogDead = true
    dialogRun += 1
  })
  const servers = createMemo(() => {
    const current = server.current
    const list = server.list
    if (!current) return list
    if (list.every((item) => ServerConnection.key(item) !== ServerConnection.key(current))) return [current, ...list]
    return [current, ...list.filter((item) => ServerConnection.key(item) !== ServerConnection.key(current))]
  })
  const health = useServerHealth(servers, props.shown)
  const sortedServers = createMemo(() => listServersByHealth(servers(), server.key, health))
  const online = createMemo(
    () => servers().filter((s) => health[ServerConnection.key(s)]?.healthy === true).length,
  )
  const toggleMcp = useMcpToggleMutation()
  const defaultServer = useDefaultServerKey(platform.getDefaultServer)
  const mcpNames = createMemo(() => Object.keys(sync.data.mcp ?? {}).sort((a, b) => a.localeCompare(b)))
  const mcpStatus = (name: string) => sync.data.mcp?.[name]?.status
  const mcpConnected = createMemo(() => mcpNames().filter((name) => mcpStatus(name) === "connected").length)
  const lspItems = createMemo(() => sync.data.lsp ?? [])
  const lspCount = createMemo(() => lspItems().length)
  // LSP diagnostics counts — pulled from the diagnostics store which subscribes
  // to `lsp.updated` events. Used to badge the LSP tab trigger and group the
  // tab body by file when the user opens the popover.
  const diagTotal = createMemo(() => diagnostics.total())
  const diagFiles = createMemo(() => diagnostics.files())
  const plugins = createMemo(() =>
    (sync.data.config?.plugin ?? []).map((item) => (typeof item === "string" ? item : item[0])),
  )
  const pluginCount = createMemo(() => plugins().length)
  const pluginEmpty = createMemo(() => pluginEmptyMessage(language.t("dialog.plugins.empty"), "unifia.json"))

  const label = (value?: string) => {
    if (value === "connected") return language.t("mcp.status.connected")
    if (value === "failed") return language.t("mcp.status.failed")
    if (value === "needs_auth") return language.t("mcp.status.needs_auth")
    if (value === "disabled") return language.t("mcp.status.disabled")
  }

  const manage = () => {
    const run = ++dialogRun
    void import("./dialog-select-server").then((x) => {
      if (dialogDead || dialogRun !== run) return
      dialog.show(() => <x.DialogSelectServer />, defaultServer.refresh)
    })
  }

  return (
    <div
      data-v110="status-popover"
      class="flex w-full flex-col rounded-[14px] border border-border-strong-base bg-background-strong p-2 shadow-[var(--shadow-lg-border-base)]"
    >
      <div class="flex items-center gap-2 px-[5px] pt-1 pb-[9px]">
        <div class="flex min-w-0 items-baseline gap-1.5">
          <span class="truncate text-12-medium text-text-strong">
            {language.t("settings.tab.compute")}
          </span>
          <span class="shrink-0 text-11-regular text-text-weak">
            {language.t("settings.compute.count", { online: online(), total: servers().length })}
          </span>
        </div>
        <span class="flex-1" />
        <Show when={server.current}>
          {(conn) => (
            <span class="min-w-0 max-w-[45%] shrink-0 truncate text-11-regular text-text-weak">
              {serverName(conn())}
            </span>
          )}
        </Show>
      </div>

      <Tabs aria-label={language.t("status.popover.ariaLabel")} defaultValue="compute" variant="pill">
        <Tabs.List class="w-full gap-1 border border-border-base bg-background-stronger p-[3px] [&_[data-slot=tabs-trigger]]:px-2.5">
          <Tabs.Trigger value="compute" class="h-7 min-w-0 flex-1 rounded-[7px] text-12-medium">
            {language.t("settings.tab.compute")}
          </Tabs.Trigger>
          <Tabs.Trigger value="servers" class="h-7 min-w-0 flex-1 rounded-[7px] text-12-medium">
            {sortedServers().length > 0 ? `${sortedServers().length} ` : ""}
            {language.t("status.popover.tab.servers")}
          </Tabs.Trigger>
          <Tabs.Trigger value="mcp" class="h-7 min-w-0 flex-1 rounded-[7px] text-12-medium">
            {mcpConnected() > 0 ? `${mcpConnected()} ` : ""}
            {language.t("status.popover.tab.mcp")}
          </Tabs.Trigger>
          <Tabs.Trigger value="lsp" class="h-7 min-w-0 flex-1 rounded-[7px] text-12-medium">
            {lspCount() > 0 ? `${lspCount()} ` : ""}
            {language.t("status.popover.tab.lsp")}
            <Show when={diagTotal() > 0}>
              <span class="ml-1 text-icon-critical-base">{diagTotal()}</span>
            </Show>
          </Tabs.Trigger>
          <Tabs.Trigger value="plugins" class="h-7 min-w-0 flex-1 rounded-[7px] text-12-medium">
            {pluginCount() > 0 ? `${pluginCount()} ` : ""}
            {language.t("status.popover.tab.plugins")}
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="compute" class="max-h-[60vh]">
          <div class="flex min-h-14 flex-col">
            {/* Auto routing has no engine yet (ADR-047): disabled like the
                settings page, so the side keeps the maquette's recommendation. */}
            <button
              type="button"
              disabled
              title={language.t("common.comingSoon")}
              class="grid min-h-[52px] w-full grid-cols-[30px_1fr_auto] items-center gap-[9px] rounded-[10px] px-2 py-[7px] text-left disabled:opacity-45"
            >
              <span class="grid size-7 place-items-center rounded-[9px] border border-border-base bg-surface-raised-base text-text-weak">
                <ComputeIcon name="auto" />
              </span>
              <span class="flex min-w-0 flex-col gap-0.5">
                <span class="truncate text-12-medium text-text-strong">
                  {language.t("settings.compute.auto.title")}
                </span>
                <span class="truncate text-11-regular text-text-weak">
                  {language.t("settings.compute.auto.description")}
                </span>
              </span>
              <span class="text-11-regular text-text-weak">
                {language.t("dialog.provider.tag.recommended")}
              </span>
            </button>
            <div class="mx-0.5 my-[5px] h-px bg-border-base" />
            <For each={sortedServers()}>
              {(s) => {
                const key = ServerConnection.key(s)
                const kind = computeKind(s)
                const state = () => health[key]
                const blocked = () => state()?.healthy === false
                const active = () => server.key === key
                const side = () => {
                  if (active()) return language.t("settings.compute.active")
                  if (state()?.healthy) return language.t("settings.compute.ready")
                  if (blocked()) return language.t("settings.compute.offline")
                  return "…"
                }
                return (
                  <button
                    type="button"
                    title={serverName(s)}
                    class="grid min-h-[52px] w-full grid-cols-[30px_1fr_auto] items-center gap-[9px] rounded-[10px] px-2 py-[7px] text-left transition-colors hover:bg-surface-3"
                    classList={{
                      "bg-surface-3": active(),
                      "cursor-not-allowed opacity-45": blocked(),
                    }}
                    aria-disabled={blocked()}
                    onClick={() => {
                      if (blocked()) return
                      server.setActive(key)
                    }}
                  >
                    <span class="grid size-7 place-items-center rounded-[9px] border border-border-base bg-surface-raised-base text-text-weak">
                      <ComputeIcon name={kind === "local" || kind === "wsl" ? "monitor" : "server"} />
                    </span>
                    <span class="flex min-w-0 flex-col gap-0.5">
                      <span class="truncate text-12-medium text-text-strong">
                        {kind === "local" ? language.t("settings.compute.thisDevice") : serverName(s)}
                      </span>
                      <span class="truncate text-11-regular text-text-weak">
                        {language.t(`settings.compute.kind.${kind}`)}
                      </span>
                    </span>
                    <span
                      class="text-11-regular"
                      classList={{ "text-accent-base": active(), "text-text-weak": !active() }}
                    >
                      {side()}
                    </span>
                  </button>
                )
              }}
            </For>
            <div class="flex gap-1.5 px-0.5 pt-1.5 pb-px">
              <button
                type="button"
                class="h-8 flex-1 rounded-[9px] border border-border-base bg-background-stronger px-2 text-12-medium text-text-weak hover:text-text-strong"
                onClick={manage}
              >
                {language.t("status.popover.action.manageServers")}
              </button>
              <button
                type="button"
                class="h-8 flex-1 rounded-[9px] border border-accent-base bg-accent-base px-2 text-12-medium text-text-on-accent hover:brightness-105 hover:shadow-[0_0_0_2px_var(--accent-glow)]"
                onClick={manage}
              >
                {language.t("settings.compute.connect")}
              </button>
            </div>
          </div>
        </Tabs.Content>

        <Tabs.Content value="servers" class="max-h-[60vh]">
          <div class="flex min-h-14 flex-col">
            <For each={sortedServers()}>
              {(s) => {
                const key = ServerConnection.key(s)
                const blocked = () => health[key]?.healthy === false
                const detail = () => {
                  const version = health[key]?.version
                  if (version) return `v${version}`
                  if (s.displayName) return serverName(s, true)
                  return ""
                }
                return (
                  <button
                    type="button"
                    title={serverName(s)}
                    class="grid min-h-[52px] w-full grid-cols-[30px_1fr_auto] items-center gap-[9px] rounded-[10px] px-2 py-[7px] text-left transition-colors"
                    classList={{
                      "hover:bg-surface-raised-base-hover": !blocked(),
                      "cursor-not-allowed opacity-45": blocked(),
                    }}
                    aria-disabled={blocked()}
                    onClick={() => {
                      if (blocked()) return
                      navigate("/")
                      queueMicrotask(() => server.setActive(key))
                    }}
                  >
                    <span class="grid size-7 place-items-center rounded-[9px] border border-border-base bg-surface-raised-base text-text-weak">
                      <Icon name="server" size="small" />
                    </span>
                    <span class="flex min-w-0 flex-col gap-0.5">
                      <span class="truncate text-12-medium text-text-strong">{serverName(s)}</span>
                      <Show when={detail()}>
                        <span class="truncate text-11-regular text-text-weak">{detail()}</span>
                      </Show>
                    </span>
                    <span class="flex items-center gap-1.5">
                      <Show when={key === defaultServer.key()}>
                        <span class="rounded-md bg-surface-base px-1.5 py-0.5 text-11-regular text-text-base">
                          {language.t("common.default")}
                        </span>
                      </Show>
                      <Show
                        when={server.current && key === ServerConnection.key(server.current)}
                        fallback={<ServerHealthIndicator health={health[key]} />}
                      >
                        <Icon name="check" size="small" class="text-icon-success-base" />
                      </Show>
                    </span>
                  </button>
                )
              }}
            </For>
          </div>
        </Tabs.Content>

        <Tabs.Content value="mcp" class="max-h-[60vh]">
          <div class="flex min-h-14 flex-col">
            <Show
              when={mcpNames().length > 0}
              fallback={
                <div class="my-auto px-4 py-6 text-center text-12-regular text-text-weak">
                  {language.t("dialog.mcp.empty")}
                </div>
              }
            >
              <For each={mcpNames()}>
                {(name) => {
                  const status = () => mcpStatus(name)
                  const enabled = () => status() === "connected"
                  return (
                    <button
                      type="button"
                      class="grid min-h-[52px] w-full grid-cols-[30px_1fr_auto] items-center gap-[9px] rounded-[10px] px-2 py-[7px] text-left transition-colors hover:bg-surface-raised-base-hover"
                      onClick={() => {
                        if (toggleMcp.isPending) return
                        toggleMcp.mutate(name)
                      }}
                      disabled={toggleMcp.isPending && toggleMcp.variables === name}
                    >
                      <span class="grid size-7 place-items-center rounded-[9px] border border-border-base bg-surface-raised-base text-text-weak">
                        <Icon name="mcp" size="small" />
                      </span>
                      <span class="flex min-w-0 flex-col gap-0.5">
                        <span class="truncate text-12-medium text-text-strong">{name}</span>
                        <Show when={label(status())}>
                          <span
                            class="truncate text-11-regular"
                            classList={{
                              "text-icon-critical-base": status() === "failed",
                              "text-icon-warning-base": status() === "needs_auth",
                              "text-text-weak": status() !== "failed" && status() !== "needs_auth",
                            }}
                          >
                            {label(status())}
                          </span>
                        </Show>
                      </span>
                      <div onClick={(event) => event.stopPropagation()}>
                        <Switch
                          checked={enabled()}
                          disabled={toggleMcp.isPending && toggleMcp.variables === name}
                          onChange={() => {
                            if (toggleMcp.isPending) return
                            toggleMcp.mutate(name)
                          }}
                        />
                      </div>
                    </button>
                  )
                }}
              </For>
            </Show>
          </div>
        </Tabs.Content>

        <Tabs.Content value="lsp" class="max-h-[60vh]">
          <div class="flex min-h-14 flex-col">
            <Show
              when={lspItems().length > 0 || diagFiles().length > 0}
              fallback={
                <div class="my-auto px-4 py-6 text-center text-12-regular text-text-weak">
                  {language.t("dialog.lsp.empty")}
                </div>
              }
            >
              <For each={lspItems()}>
                {(item) => (
                  <div class="grid min-h-[52px] w-full grid-cols-[30px_1fr_auto] items-center gap-[9px] rounded-[10px] px-2 py-[7px]">
                    <span class="grid size-7 place-items-center rounded-[9px] border border-border-base bg-surface-raised-base text-text-weak">
                      <Icon name="code" size="small" />
                    </span>
                    <span class="flex min-w-0 flex-col gap-0.5">
                      <span class="truncate text-12-medium text-text-strong">{item.name || item.id}</span>
                      <Show when={item.name && item.id}>
                        <span class="truncate text-11-regular text-text-weak">{item.id}</span>
                      </Show>
                    </span>
                    <span
                      classList={{
                        "size-1.5 rounded-full": true,
                        "bg-icon-success-base": item.status === "connected",
                        "bg-icon-critical-base": item.status === "error",
                        "bg-border-weak-base": item.status !== "connected" && item.status !== "error",
                      }}
                    />
                  </div>
                )}
              </For>
              <Show when={diagFiles().length > 0}>
                <div class="mt-1 border-t border-border-weak-base pt-1">
                  <div class="px-2 pt-1 pb-1 text-11-regular text-text-weak">
                    {language.t("status.popover.lsp.diagnostics")}
                  </div>
                  <For each={diagFiles()}>
                    {(file) => {
                      const list = diagnostics.for(file)
                      const err = list.filter((d) => d.severity === 1).length
                      const warn = list.filter((d) => d.severity === 2).length
                      return (
                        <div
                          class="flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5"
                          title={list
                            .map((d) => `${d.severity === 1 ? "E" : "W"} L${d.range.start.line + 1}: ${d.message}`)
                            .join("\n")}
                        >
                          <span class="min-w-0 flex-1 truncate text-12-regular text-text-base">{file}</span>
                          <Show when={err > 0}>
                            <span class="text-11-regular text-icon-critical-base">{err}</span>
                          </Show>
                          <Show when={warn > 0}>
                            <span class="text-11-regular text-icon-warning-base">{warn}</span>
                          </Show>
                        </div>
                      )
                    }}
                  </For>
                </div>
              </Show>
            </Show>
          </div>
        </Tabs.Content>

        <Tabs.Content value="plugins" class="max-h-[60vh]">
          <div class="flex min-h-14 flex-col">
            <Show
              when={plugins().length > 0}
              fallback={
                <div class="my-auto px-4 py-6 text-center text-12-regular text-text-weak">{pluginEmpty()}</div>
              }
            >
              <For each={plugins()}>
                {(plugin) => (
                  <div class="grid min-h-[52px] w-full grid-cols-[30px_1fr_auto] items-center gap-[9px] rounded-[10px] px-2 py-[7px]">
                    <span class="grid size-7 place-items-center rounded-[9px] border border-border-base bg-surface-raised-base text-text-weak">
                      <Icon name="dot-grid" size="small" />
                    </span>
                    <span class="truncate text-12-medium text-text-strong">{plugin}</span>
                    <span class="size-1.5 rounded-full bg-icon-success-base" />
                  </div>
                )}
              </For>
            </Show>
          </div>
        </Tabs.Content>
      </Tabs>
    </div>
  )
}
