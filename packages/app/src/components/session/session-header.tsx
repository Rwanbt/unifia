import { AppIcon } from "@unifia/ui/app-icon"
import { Button } from "@unifia/ui/button"
import { DropdownMenu } from "@unifia/ui/dropdown-menu"
import { Icon } from "@unifia/ui/icon"
import { IconButton } from "@unifia/ui/icon-button"
import { Keybind } from "@unifia/ui/keybind"
import { Spinner } from "@unifia/ui/spinner"
import { showToast } from "@unifia/ui/toast"
import { Tooltip, TooltipKeybind } from "@unifia/ui/tooltip"
import { createEffect, createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Portal } from "solid-js/web"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useMode } from "@/context/mode"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useSync } from "@/context/sync"
import { useTerminal } from "@/context/terminal"
import { useTitlebarSlots } from "@/context/titlebar-slots"
import { focusTerminalById } from "@/pages/session/helpers"
import { useSessionLayout } from "@/pages/session/session-layout"
import { messageAgentColor } from "@/utils/agent"
import { decode64 } from "@/utils/base64"
import { Persist, persisted } from "@/utils/persist"
import { StatusPopover } from "../status-popover"

const OPEN_APPS = [
  "vscode",
  "cursor",
  "zed",
  "textmate",
  "antigravity",
  "finder",
  "terminal",
  "iterm2",
  "ghostty",
  "warp",
  "xcode",
  "android-studio",
  "powershell",
  "sublime-text",
] as const

type OpenApp = (typeof OPEN_APPS)[number]
type OS = "macos" | "windows" | "linux" | "android" | "ios" | "unknown"

const MAC_APPS = [
  {
    id: "vscode",
    label: "session.header.open.app.vscode",
    icon: "vscode",
    openWith: "Visual Studio Code",
  },
  { id: "cursor", label: "session.header.open.app.cursor", icon: "cursor", openWith: "Cursor" },
  { id: "zed", label: "session.header.open.app.zed", icon: "zed", openWith: "Zed" },
  { id: "textmate", label: "session.header.open.app.textmate", icon: "textmate", openWith: "TextMate" },
  {
    id: "antigravity",
    label: "session.header.open.app.antigravity",
    icon: "antigravity",
    openWith: "Antigravity",
  },
  { id: "terminal", label: "session.header.open.app.terminal", icon: "terminal", openWith: "Terminal" },
  { id: "iterm2", label: "session.header.open.app.iterm2", icon: "iterm2", openWith: "iTerm" },
  { id: "ghostty", label: "session.header.open.app.ghostty", icon: "ghostty", openWith: "Ghostty" },
  { id: "warp", label: "session.header.open.app.warp", icon: "warp", openWith: "Warp" },
  { id: "xcode", label: "session.header.open.app.xcode", icon: "xcode", openWith: "Xcode" },
  {
    id: "android-studio",
    label: "session.header.open.app.androidStudio",
    icon: "android-studio",
    openWith: "Android Studio",
  },
  {
    id: "sublime-text",
    label: "session.header.open.app.sublimeText",
    icon: "sublime-text",
    openWith: "Sublime Text",
  },
] as const

const WINDOWS_APPS = [
  { id: "vscode", label: "session.header.open.app.vscode", icon: "vscode", openWith: "code" },
  { id: "cursor", label: "session.header.open.app.cursor", icon: "cursor", openWith: "cursor" },
  { id: "zed", label: "session.header.open.app.zed", icon: "zed", openWith: "zed" },
  {
    id: "powershell",
    label: "session.header.open.app.powershell",
    icon: "powershell",
    openWith: "powershell",
  },
  {
    id: "sublime-text",
    label: "session.header.open.app.sublimeText",
    icon: "sublime-text",
    openWith: "Sublime Text",
  },
] as const

const LINUX_APPS = [
  { id: "vscode", label: "session.header.open.app.vscode", icon: "vscode", openWith: "code" },
  { id: "cursor", label: "session.header.open.app.cursor", icon: "cursor", openWith: "cursor" },
  { id: "zed", label: "session.header.open.app.zed", icon: "zed", openWith: "zed" },
  {
    id: "sublime-text",
    label: "session.header.open.app.sublimeText",
    icon: "sublime-text",
    openWith: "Sublime Text",
  },
] as const

const detectOS = (platform: ReturnType<typeof usePlatform>): OS => {
  if (platform.platform === "desktop" && platform.os) return platform.os
  if (typeof navigator !== "object") return "unknown"
  const value = navigator.platform || navigator.userAgent
  if (/Mac/i.test(value)) return "macos"
  if (/Win/i.test(value)) return "windows"
  if (/Linux/i.test(value)) return "linux"
  return "unknown"
}

const showRequestError = (language: ReturnType<typeof useLanguage>, err: unknown) => {
  showToast({
    variant: "error",
    title: language.t("common.requestFailed"),
    description: err instanceof Error ? err.message : String(err),
  })
}

export function SessionHeader() {
  const layout = useLayout()
  const mode = useMode()
  const command = useCommand()
  const server = useServer()
  const platform = usePlatform()
  const language = useLanguage()
  const sync = useSync()
  const terminal = useTerminal()
  const titlebarSlots = useTitlebarSlots()
  const { params, view } = useSessionLayout()

  const projectDirectory = createMemo(() => decode64(params.dir) ?? "")
  // Ports #searchBtn (Unifia-UI-UX-v110-PORT-READY-R1.html:15233, "Rechercher,
  // agir ou ouvrir... Ctrl K") -- a general search/act/open trigger, not a
  // files-only one. Wired to command.palette (the app's own general command
  // search), not file.open (Quick Open) -- the maquette's own wording ("agir
  // ou ouvrir", not "des fichiers") describes the palette, not a file picker.
  // The palette's real default keybind is mod+shift+p, not mod+k -- shown as
  // the actual keybind rather than a "Ctrl K" label that would not work.
  const hotkey = createMemo(() => command.keybind("command.palette"))
  const os = createMemo(() => detectOS(platform))

  const [exists, setExists] = createStore<Partial<Record<OpenApp, boolean>>>({
    finder: true,
  })

  const apps = createMemo(() => {
    if (os() === "macos") return MAC_APPS
    if (os() === "windows") return WINDOWS_APPS
    return LINUX_APPS
  })

  const fileManager = createMemo(() => {
    if (os() === "macos") return { label: "session.header.open.finder", icon: "finder" as const }
    if (os() === "windows") return { label: "session.header.open.fileExplorer", icon: "file-explorer" as const }
    return { label: "session.header.open.fileManager", icon: "finder" as const }
  })

  createEffect(() => {
    if (platform.platform !== "desktop") return
    if (!platform.checkAppExists) return

    const list = apps()

    setExists(Object.fromEntries(list.map((app) => [app.id, undefined])) as Partial<Record<OpenApp, boolean>>)

    void Promise.all(
      list.map((app) =>
        Promise.resolve(platform.checkAppExists?.(app.openWith))
          .then((value) => Boolean(value))
          .catch(() => false)
          .then((ok) => [app.id, ok] as const),
      ),
    ).then((entries) => {
      setExists(Object.fromEntries(entries) as Partial<Record<OpenApp, boolean>>)
    })
  })

  const options = createMemo(() => {
    return [
      { id: "finder", label: language.t(fileManager().label), icon: fileManager().icon },
      ...apps()
        .filter((app) => exists[app.id])
        .map((app) => ({ ...app, label: language.t(app.label) })),
    ] as const
  })

  const toggleTerminal = () => {
    const next = !view().terminal.opened()
    view().terminal.toggle()
    if (!next) return
    if (platform.platform === "mobile") return

    const id = terminal.active()
    if (!id) return
    focusTerminalById(id)
  }

  const [prefs, setPrefs] = persisted(Persist.global("open.app"), createStore({ app: "finder" as OpenApp }))
  const [menu, setMenu] = createStore({ open: false })
  const [openRequest, setOpenRequest] = createStore({
    app: undefined as OpenApp | undefined,
  })

  const canOpen = createMemo(() => platform.platform === "desktop" && !!platform.openPath && server.isLocal())
  const current = createMemo(
    () =>
      options().find((o) => o.id === prefs.app) ??
      options()[0] ??
      ({ id: "finder", label: fileManager().label, icon: fileManager().icon } as const),
  )
  const opening = createMemo(() => openRequest.app !== undefined)
  const tint = createMemo(() =>
    messageAgentColor(params.id ? sync.data.message[params.id] : undefined, sync.data.agent),
  )

  const selectApp = (app: OpenApp) => {
    if (!options().some((item) => item.id === app)) return
    setPrefs("app", app)
  }

  const openDir = (app: OpenApp) => {
    if (opening() || !canOpen() || !platform.openPath) return
    const directory = projectDirectory()
    if (!directory) return

    const item = options().find((o) => o.id === app)
    const openWith = item && "openWith" in item ? item.openWith : undefined
    setOpenRequest("app", app)
    platform
      .openPath(directory, openWith)
      .catch((err: unknown) => showRequestError(language, err))
      .finally(() => {
        setOpenRequest("app", undefined)
      })
  }

  const createTaskFromContext = () => mode.selectDestination("work")

  return (
    <>
      <Show when={titlebarSlots.left()}>
        {(mount) => (
          <Portal mount={mount()}>
            <Button
              type="button"
              variant="ghost"
              size="small"
              // Compact port override: keep the project/mode breadcrumb readable
              // while preserving the reference height and radius contract.
              // The frozen reference uses width:min(380px,32vw); this port narrows
              // the control to 320px for the current visual target.
              // Sits inline right after the breadcrumb in the maquette's left
              // group (x=301 of 1440, live-measured), not centered across the
              // whole topbar -- portaling into titlebarSlots.center() put it in
              // the grid's mathematically-centered "auto" track instead, which
              // left a large gap after the crumbs that the maquette doesn't have.
              // variant="ghost" forces background/border-color to transparent
              // (button.css:41-44), so utility classes lose that cascade fight;
              // background and border colour are owned by v110.css instead.
              data-v110="session-search"
              class="h-[31px] max-w-full min-w-0 items-center gap-2 justify-between rounded-[11px] border shadow-none cursor-pointer ml-2"
              onClick={() => command.show()}
              aria-label={language.t("session.header.commandSearch.placeholder")}
            >
              <div class="flex min-w-0 flex-1 items-center gap-2 overflow-visible">
                <Icon name="magnifying-glass" size="small" class="text-text-weaker shrink-0" />
                <span class="flex-1 min-w-0 text-12-regular text-text-weak truncate text-left">
                  {language.t("session.header.commandSearch.placeholder")}
                </span>
              </div>

              <Show when={hotkey()}>
                {(keybind) => (
                  <Keybind class="shrink-0 !border-0 !bg-transparent !shadow-none px-0 text-text-weaker">
                    {keybind()}
                  </Keybind>
                )}
              </Show>
            </Button>
          </Portal>
        )}
      </Show>
      {/* Ports #layoutSwitch (Unifia-UI-UX-v110-PORT-READY-R1.html:15238-15239).
          Earlier read this as flowing inline after workspace-head's
          title/meta, mounting it in titlebarSlots.right() -- but that pair
          is dead (see the removed-block note below) and the maquette's own
          .workspace-head gets `justify-content:center!important` in the
          relevant layout context (line ~13006), which centers whatever's
          left visible inside it once title/meta/spacer collapse away --
          i.e. the view-switch itself. Moved to titlebarSlots.center(),
          the grid's own centered track, to match. */}
      <Show when={titlebarSlots.center()}>
        {(mount) => (
          <Portal mount={mount()}>
            <Show when={platform.platform !== "mobile"}>
              {(() => {
                const workspaceView = createMemo(() => view().workspace.current())
                const setView = (next: "chat" | "split" | "main") => {
                  view().workspace.set(next)
                }
                const options = [
                  { id: "chat" as const, label: language.t("session.header.viewSwitch.chat") },
                  { id: "split" as const, label: language.t("session.header.viewSwitch.split") },
                  { id: "main" as const, label: language.t("session.header.viewSwitch.editor") },
                ]
                return (
                  <div
                    role="radiogroup"
                    aria-label={language.t("session.header.viewSwitch.label")}
                    data-v110="layout-switch"
                    class="flex items-center gap-0.5 rounded-lg border border-border-weak-base bg-[var(--v110-rail-bg)] p-0.5 shrink-0"
                  >
                    <For each={options}>
                      {(option) => (
                        <button
                          type="button"
                          role="radio"
                          aria-checked={workspaceView() === option.id}
                          // Maquette #layoutSwitch button measures h=22px,
                          // font-size=9px, padding="5px 9px" live
                          // (Unifia-UI-UX-v110-PORT-READY-R1.html:15239) --
                          // text-12-medium is actually 13px (--font-size-
                          // small), noticeably larger, which was widening
                          // every button here.
                          class="rounded-md px-[9px] h-[22px] text-[9px] font-medium transition-colors"
                          classList={{
                            "text-text-strong": workspaceView() === option.id,
                            "text-text-weak hover:text-text-strong": workspaceView() !== option.id,
                          }}
                          onClick={() => setView(option.id)}
                        >
                          {option.label}
                        </button>
                      )}
                    </For>
                  </div>
                )
              })()}
            </Show>
          </Portal>
        )}
      </Show>
      <Show when={titlebarSlots.right()}>
        {(mount) => (
          <Portal mount={mount()}>
            <div class="flex items-center gap-2">
              <div class="flex items-center gap-1">
                {/* Reordered to match the maquette's real .top-actions order in
                    "code" mode, live-verified (Unifia-UI-UX-v110-PORT-READY-R1.html):
                    review, terminal, server-status, open-in -- #topExplorerBtn
                    (file-tree) is removed by the maquette's own runtime JS in
                    code mode and has no slot here; kept anyway since it is real,
                    necessary navigation the app doesn't reorganize per-mode the
                    way the maquette's script does. The earlier version of this
                    comment cited raw markup order (which does list
                    #topExplorerBtn/#topReviewBtn/#topTerminalBtn/#serverBtn in
                    sequence) without checking runtime removal or the open-in
                    button's real position -- #openInBtn actually sits AFTER
                    #serverBtn, not in a separate slot before this whole group.
                    Was `hidden md:flex`, which dropped the review and file-tree
                    toggles below 768px. The review panel defaults to open
                    (context/layout.tsx: `store.review?.panelOpened ?? true`),
                    so on a phone it appeared at launch with no control able to
                    close it — the conversation stayed unreachable. The terminal
                    toggle is already visible at this width and opens the same
                    kind of overlay, so showing these two is consistent. */}
                <div class="flex items-center gap-1 shrink-0">
                  {/* v110 InspectorFrame is one shared pane (session-side-panel.tsx):
                      each button below closes it if already open, otherwise opens
                      it on its own tab — never just switches tab while open, so a
                      second press of either always reads as "off" (verified by
                      e2e/commands/panels.spec.ts and e2e/files/file-tree.spec.ts). */}
                  <Tooltip value={language.t("session.header.createTaskFromContext")}>
                    <Button
                      variant="ghost"
                      class="titlebar-icon w-8 h-[31px] p-0 box-border"
                      onClick={createTaskFromContext}
                      aria-label={language.t("session.header.createTaskFromContext")}
                    >
                      <div class="relative flex items-center justify-center size-4">
                        <Icon size="small" name="task-add" />
                      </div>
                    </Button>
                  </Tooltip>

                  <TooltipKeybind
                    title={language.t("command.review.toggle")}
                    keybind={command.keybind("review.toggle")}
                  >
                    <Button
                      variant="ghost"
                      class="group/review-toggle titlebar-icon w-8 h-[31px] p-0 box-border"
                      onClick={() => {
                        if (layout.inspector.opened()) {
                          layout.inspector.close()
                          return
                        }
                        layout.inspector.setTab("inspector")
                        layout.inspector.open()
                      }}
                      aria-label={language.t("command.review.toggle")}
                      aria-expanded={layout.inspector.opened() && layout.inspector.tab() === "inspector"}
                      aria-controls="v110-inspector-panel"
                    >
                      <Icon
                        size="small"
                        name={
                          layout.inspector.opened() && layout.inspector.tab() === "inspector"
                            ? "review-active"
                            : "review"
                        }
                      />
                    </Button>
                  </TooltipKeybind>
                </div>

                {/* #topTerminalBtn: the terminal lives in the Code editor card,
                    so the maquette hides this button in every other mode.
                    The terminal.toggle keybind keeps working everywhere. */}
                <Show when={mode.destination() === "code"}>
                  <Tooltip
                    placement="bottom"
                    gutter={8}
                    contentClass="v110-topbar-tooltip"
                    value={language.t(view().terminal.opened() ? "terminal.toggle.hide" : "terminal.toggle.show")}
                  >
                    <Button
                      variant="ghost"
                      data-v110="top-terminal"
                      class="group/terminal-toggle titlebar-icon w-8 h-[31px] p-0 box-border shrink-0"
                      onClick={toggleTerminal}
                      aria-label={language.t(view().terminal.opened() ? "terminal.toggle.hide" : "terminal.toggle.show")}
                      aria-expanded={view().terminal.opened()}
                      aria-controls="terminal-panel"
                    >
                      <Icon size="small" name={view().terminal.opened() ? "terminal-active" : "terminal"} />
                    </Button>
                  </Tooltip>
                </Show>
                <Tooltip placement="bottom" value={language.t("status.popover.trigger")}>
                  <StatusPopover />
                </Tooltip>

                <Show when={projectDirectory()}>
                  <div class="hidden xl:flex items-center">
                    <Show
                      when={canOpen()}
                      fallback={
                        // #openInBtn (Unifia-UI-UX-v110-PORT-READY-R1.html:15263)
                        // is a plain icon-only .top-quick button, same as its
                        // review/terminal/status siblings -- the icon+text pill
                        // here didn't match that when canOpen() is false (this
                        // web-preview environment; a real desktop app has
                        // canOpen() true and renders the open-in-app icon
                        // below instead).
                        <Tooltip placement="bottom" value={language.t("session.header.openIn")}>
                          <Button
                            variant="ghost"
                            class="titlebar-icon w-8 h-[31px] p-0 box-border"
                            onClick={() => setMenu("open", true)}
                            aria-label={language.t("session.header.openIn")}
                          >
                            <Icon name="open-in" size="small" class="text-icon-base" />
                          </Button>
                        </Tooltip>
                      }
                    >
                      <div class="flex items-center">
                        <div class="flex h-[24px] box-border items-center rounded-md border border-border-weak-base bg-[var(--surface-panel)] overflow-hidden">
                          <Button
                            variant="ghost"
                            class="rounded-none h-full px-0.5 border-none shadow-none disabled:!cursor-default"
                            classList={{
                              "bg-surface-raised-base-active": opening(),
                            }}
                            onClick={() => openDir(current().id)}
                            disabled={opening()}
                            aria-label={language.t("session.header.open.ariaLabel", { app: current().label })}
                          >
                            <div class="flex size-5 shrink-0 items-center justify-center [&_[data-component=app-icon]]:size-5">
                              <Show when={opening()} fallback={<AppIcon id={current().icon} />}>
                                <Spinner class="size-3.5" style={{ color: tint() ?? "var(--icon-base)" }} />
                              </Show>
                            </div>
                          </Button>
                          <DropdownMenu
                            gutter={4}
                            placement="bottom-end"
                            open={menu.open}
                            onOpenChange={(open) => setMenu("open", open)}
                          >
                            <DropdownMenu.Trigger
                              as={IconButton}
                              icon="chevron-down"
                              variant="ghost"
                              disabled={opening()}
                              class="rounded-none h-full w-[20px] p-0 border-none shadow-none data-[expanded]:bg-surface-raised-base-active disabled:!cursor-default"
                              classList={{
                                "bg-surface-raised-base-active": opening(),
                              }}
                              aria-label={language.t("session.header.open.menu")}
                            />
                            <DropdownMenu.Portal>
                              <DropdownMenu.Content class="[&_[data-slot=dropdown-menu-item]]:pl-1 [&_[data-slot=dropdown-menu-radio-item]]:pl-1 [&_[data-slot=dropdown-menu-radio-item]+[data-slot=dropdown-menu-radio-item]]:mt-1">
                                <DropdownMenu.Group>
                                  <DropdownMenu.GroupLabel class="!px-1 !py-1">
                                    {language.t("session.header.openIn")}
                                  </DropdownMenu.GroupLabel>
                                  <DropdownMenu.RadioGroup
                                    class="mt-1"
                                    value={current().id}
                                    onChange={(value) => {
                                      if (!OPEN_APPS.includes(value as OpenApp)) return
                                      selectApp(value as OpenApp)
                                    }}
                                  >
                                    <For each={options()}>
                                      {(o) => (
                                        <DropdownMenu.RadioItem
                                          value={o.id}
                                          disabled={opening()}
                                          onSelect={() => {
                                            setMenu("open", false)
                                            openDir(o.id)
                                          }}
                                        >
                                          <div class="flex size-5 shrink-0 items-center justify-center [&_[data-component=app-icon]]:size-5">
                                            <AppIcon id={o.icon} />
                                          </div>
                                          <DropdownMenu.ItemLabel>{o.label}</DropdownMenu.ItemLabel>
                                          <DropdownMenu.ItemIndicator>
                                            <Icon name="check-small" size="small" class="text-icon-weak" />
                                          </DropdownMenu.ItemIndicator>
                                        </DropdownMenu.RadioItem>
                                      )}
                                    </For>
                                  </DropdownMenu.RadioGroup>
                                </DropdownMenu.Group>
                              </DropdownMenu.Content>
                            </DropdownMenu.Portal>
                          </DropdownMenu>
                        </div>
                      </div>
                    </Show>
                  </div>
                </Show>

                {/* Mobile-only: more actions menu */}
                <Show when={platform.platform === "mobile"}>
                  <DropdownMenu gutter={4} placement="bottom-end">
                    <DropdownMenu.Trigger
                      as={Button}
                      variant="ghost"
                      class="titlebar-icon w-8 h-6 p-0 box-border shrink-0"
                      aria-label={language.t("session.header.moreActions")}
                    >
                      <Icon size="small" name="dot-grid" />
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content>
                        <DropdownMenu.Item onSelect={() => command.trigger("session.fork")}>
                          <Icon name="fork" size="small" />
                          <DropdownMenu.ItemLabel>{language.t("command.session.fork")}</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                        <DropdownMenu.Item onSelect={() => command.trigger("file.open")}>
                          <Icon name="magnifying-glass" size="small" />
                          <DropdownMenu.ItemLabel>{language.t("session.header.searchFiles")}</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                        <DropdownMenu.Item onSelect={() => command.trigger("settings.open")}>
                          <Icon name="settings-gear" size="small" />
                          <DropdownMenu.ItemLabel>{language.t("command.settings.open")}</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu>
                </Show>
              </div>
            </div>
          </Portal>
        )}
      </Show>
    </>
  )
}
