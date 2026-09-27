import { useDialog } from "@unifia/ui/context/dialog"
import { Switch } from "@unifia/ui/switch"
import { Tabs } from "@unifia/ui/tabs"
import { useMutation } from "@tanstack/solid-query"
import { showToast } from "@unifia/ui/toast"
import { useNavigate } from "@solidjs/router"
import { type Accessor, createEffect, createMemo, createSignal, For, type JSXElement, onCleanup, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { ComputeIcon, computeGlyph, computeKind } from "./compute-icon"
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

  type StatusTab = "compute" | "servers" | "mcp" | "lsp" | "plugins"
  const [tab, setTab] = createSignal<StatusTab>("compute")
  // The head names the open tab, as the reference's head names its only list.
  const head = createMemo(() => {
    const current = tab()
    if (current === "compute" || current === "servers") {
      return {
        title: language.t(current === "compute" ? "settings.tab.compute" : "status.popover.tab.servers"),
        count: language.t("settings.compute.count", { online: online(), total: servers().length }),
      }
    }
    if (current === "mcp") return { title: language.t("status.popover.tab.mcp"), count: `${mcpConnected()}/${mcpNames().length}` }
    if (current === "lsp") return { title: language.t("status.popover.tab.lsp"), count: String(lspCount()) }
    return { title: language.t("status.popover.tab.plugins"), count: String(pluginCount()) }
  })

  const manage = () => {
    const run = ++dialogRun
    void import("./dialog-select-server").then((x) => {
      if (dialogDead || dialogRun !== run) return
      dialog.show(() => <x.DialogSelectServer />, defaultServer.refresh)
    })
  }

  const serverSide = (key: ServerConnection.Key) => {
    if (server.key === key) return `✓ ${language.t("settings.compute.active")}`
    if (health[key]?.healthy) return language.t("settings.compute.ready")
    if (health[key]?.healthy === false) return language.t("settings.compute.offline")
    return "…"
  }

  const actions = () => (
    <div data-slot="status-actions">
      <button type="button" onClick={manage}>
        {language.t("status.popover.action.manageServers")}
      </button>
      <button type="button" data-tone="primary" onClick={manage}>
        {language.t("settings.compute.connect")}
      </button>
    </div>
  )

  return (
    <div data-v110="status-popover">
      <div data-slot="status-head">
        <div>
          <b>{head().title}</b>
          <span>{head().count}</span>
        </div>
        <span data-slot="status-head-spacer" />
        <Show when={server.current}>{(conn) => <span data-slot="status-head-target">{serverName(conn())}</span>}</Show>
      </div>

      <Tabs
        aria-label={language.t("status.popover.ariaLabel")}
        value={tab()}
        onChange={(value) => setTab(value as StatusTab)}
        variant="pill"
      >
        <Tabs.List class="w-full">
          <Tabs.Trigger value="compute" class="min-w-0 flex-1">
            {language.t("settings.tab.compute")}
          </Tabs.Trigger>
          <Tabs.Trigger value="servers" class="min-w-0 flex-1">
            <Show when={sortedServers().length > 0}>
              <i data-slot="status-count">{sortedServers().length}</i>
            </Show>
            {language.t("status.popover.tab.servers")}
          </Tabs.Trigger>
          <Tabs.Trigger value="mcp" class="min-w-0 flex-1">
            <Show when={mcpConnected() > 0}>
              <i data-slot="status-count">{mcpConnected()}</i>
            </Show>
            {language.t("status.popover.tab.mcp")}
          </Tabs.Trigger>
          <Tabs.Trigger value="lsp" class="min-w-0 flex-1">
            <Show when={lspCount() > 0}>
              <i data-slot="status-count">{lspCount()}</i>
            </Show>
            {language.t("status.popover.tab.lsp")}
            <Show when={diagTotal() > 0}>
              <i data-slot="status-count" data-tone="critical">
                {diagTotal()}
              </i>
            </Show>
          </Tabs.Trigger>
          <Tabs.Trigger value="plugins" class="min-w-0 flex-1">
            <Show when={pluginCount() > 0}>
              <i data-slot="status-count">{pluginCount()}</i>
            </Show>
            {language.t("status.popover.tab.plugins")}
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="compute" data-slot="status-pane">
          {/* Auto routing has no engine yet (ADR-047): disabled like the
              settings page, so the side keeps the maquette's recommendation. */}
          <StatusRow
            icon={<ComputeIcon name="auto" />}
            title={language.t("settings.compute.auto.title")}
            detail={language.t("settings.compute.auto.description")}
            side={language.t("dialog.provider.tag.recommended")}
            hint={language.t("common.comingSoon")}
            disabled
            onClick={() => {}}
          />
          <div data-slot="status-sep" />
          <For each={sortedServers()}>
            {(s) => {
              const key = ServerConnection.key(s)
              const kind = computeKind(s)
              return (
                <StatusRow
                  icon={<ComputeIcon name={computeGlyph(s)} />}
                  title={kind === "local" ? language.t("settings.compute.thisDevice") : serverName(s)}
                  detail={language.t(`settings.compute.kind.${kind}`)}
                  side={serverSide(key)}
                  hint={serverName(s)}
                  active={server.key === key}
                  disabled={server.key !== key && health[key]?.healthy === false}
                  onClick={() => server.setActive(key)}
                />
              )
            }}
          </For>
          {actions()}
        </Tabs.Content>

        <Tabs.Content value="servers" data-slot="status-pane">
          <For each={sortedServers()}>
            {(s) => {
              const key = ServerConnection.key(s)
              const detail = () => {
                const version = health[key]?.version
                const parts = [version ? `v${version}` : s.displayName ? serverName(s, true) : ""]
                if (key === defaultServer.key()) parts.push(language.t("common.default"))
                return parts.filter(Boolean).join(" · ")
              }
              return (
                <StatusRow
                  icon={<ComputeIcon name={computeGlyph(s)} />}
                  title={serverName(s)}
                  detail={detail()}
                  side={serverSide(key)}
                  hint={serverName(s)}
                  active={server.key === key}
                  disabled={server.key !== key && health[key]?.healthy === false}
                  onClick={() => {
                    navigate("/")
                    queueMicrotask(() => server.setActive(key))
                  }}
                />
              )
            }}
          </For>
          {actions()}
        </Tabs.Content>

        <Tabs.Content value="mcp" data-slot="status-pane">
          <Show when={mcpNames().length > 0} fallback={<div data-slot="status-empty">{language.t("dialog.mcp.empty")}</div>}>
            <For each={mcpNames()}>
              {(name) => {
                const status = () => mcpStatus(name)
                const busy = () => toggleMcp.isPending && toggleMcp.variables === name
                return (
                  <StatusRow
                    icon={<ComputeIcon name="plug" />}
                    title={name}
                    detail={
                      <Show when={label(status())}>
                        <span data-tone={status() === "failed" ? "critical" : status() === "needs_auth" ? "warning" : undefined}>
                          {label(status())}
                        </span>
                      </Show>
                    }
                    active={status() === "connected"}
                    side={
                      <Switch
                        checked={status() === "connected"}
                        disabled={busy()}
                        onChange={() => {
                          if (toggleMcp.isPending) return
                          toggleMcp.mutate(name)
                        }}
                      />
                    }
                  />
                )
              }}
            </For>
          </Show>
        </Tabs.Content>

        <Tabs.Content value="lsp" data-slot="status-pane">
          <Show
            when={lspItems().length > 0 || diagFiles().length > 0}
            fallback={<div data-slot="status-empty">{language.t("dialog.lsp.empty")}</div>}
          >
            <For each={lspItems()}>
              {(item) => (
                <StatusRow
                  icon={<ComputeIcon name="code" />}
                  title={item.name || item.id}
                  detail={item.name && item.id ? item.id : undefined}
                  active={item.status === "connected"}
                  side={<span data-slot="status-dot" data-tone={item.status === "connected" ? "success" : item.status === "error" ? "critical" : undefined} />}
                />
              )}
            </For>
            <Show when={diagFiles().length > 0}>
              <div data-slot="status-sep" />
              <div data-slot="status-label">{language.t("status.popover.lsp.diagnostics")}</div>
              <For each={diagFiles()}>
                {(file) => {
                  const list = diagnostics.for(file)
                  const err = list.filter((d) => d.severity === 1).length
                  const warn = list.filter((d) => d.severity === 2).length
                  return (
                    <div
                      data-slot="status-file"
                      title={list.map((d) => `${d.severity === 1 ? "E" : "W"} L${d.range.start.line + 1}: ${d.message}`).join("\n")}
                    >
                      <span>{file}</span>
                      <Show when={err > 0}>
                        <i data-tone="critical">{err}</i>
                      </Show>
                      <Show when={warn > 0}>
                        <i data-tone="warning">{warn}</i>
                      </Show>
                    </div>
                  )
                }}
              </For>
            </Show>
          </Show>
        </Tabs.Content>

        <Tabs.Content value="plugins" data-slot="status-pane">
          <Show when={plugins().length > 0} fallback={<div data-slot="status-empty">{pluginEmpty()}</div>}>
            <For each={plugins()}>
              {(plugin) => (
                <StatusRow
                  icon={<ComputeIcon name="plugin" />}
                  title={plugin}
                  side={<span data-slot="status-dot" data-tone="success" />}
                />
              )}
            </For>
          </Show>
        </Tabs.Content>
      </Tabs>
    </div>
  )
}

/** One line of the popover: the reference's `.runtime-choice-v32`. */
function StatusRow(props: {
  icon: JSXElement
  title: JSXElement
  detail?: JSXElement
  side?: JSXElement
  hint?: string
  active?: boolean
  disabled?: boolean
  onClick?: () => void
}) {
  const content = () => (
    <>
      <span data-slot="status-row-icon">{props.icon}</span>
      <span data-slot="status-row-copy">
        <b>{props.title}</b>
        <Show when={props.detail}>
          <small>{props.detail}</small>
        </Show>
      </span>
      <Show when={props.side}>
        <span data-slot="status-row-side">{props.side}</span>
      </Show>
    </>
  )
  return (
    <Show
      when={props.onClick}
      fallback={
        <div data-slot="status-row" data-active={props.active || undefined} title={props.hint}>
          {content()}
        </div>
      }
    >
      <button
        type="button"
        data-slot="status-row"
        data-active={props.active || undefined}
        title={props.hint}
        disabled={props.disabled}
        onClick={() => props.onClick?.()}
      >
        {content()}
      </button>
    </Show>
  )
}
