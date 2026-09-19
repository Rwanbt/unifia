import { AppIcon } from "@unifia/ui/app-icon"
import { Button } from "@unifia/ui/button"
import { DropdownMenu } from "@unifia/ui/dropdown-menu"
import { Icon } from "@unifia/ui/icon"
import { IconButton } from "@unifia/ui/icon-button"
import { Keybind } from "@unifia/ui/keybind"
import { Spinner } from "@unifia/ui/spinner"
import { showToast } from "@unifia/ui/toast"
import { Tooltip, TooltipKeybind } from "@unifia/ui/tooltip"
import { getFilename } from "@unifia/util/path"
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
  const command = useCommand()
  const server = useServer()
  const platform = usePlatform()
  const language = useLanguage()
  const sync = useSync()
  const terminal = useTerminal()
  const titlebarSlots = useTitlebarSlots()
  const mode = useMode()
  const { params, view } = useSessionLayout()

  const projectDirectory = createMemo(() => decode64(params.dir) ?? "")
  const project = createMemo(() => {
    const directory = projectDirectory()
    if (!directory) return
    return layout.projects.list().find((p) => p.worktree === directory || p.sandboxes?.includes(directory))
  })
  const name = createMemo(() => {
    const current = project()
    if (current) return current.name || getFilename(current.worktree)
    return getFilename(projectDirectory())
  })
  const hotkey = createMemo(() => command.keybind("file.open"))
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

  const copyPath = () => {
    const directory = projectDirectory()
    if (!directory) return
    navigator.clipboard
      .writeText(directory)
      .then(() => {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("session.share.copy.copied"),
          description: directory,
        })
      })
      .catch((err: unknown) => showRequestError(language, err))
  }

  return (
    <>
      <Show when={titlebarSlots.center()}>
        {(mount) => (
          <Portal mount={mount()}>
            <Button
              type="button"
              variant="ghost"
              size="small"
              // .search { width:min(380px,32vw); height:31px; border-radius:11px;
              // background:var(--surface) } -- Unifia-UI-UX-v110-PORT-READY-R1.html:126.
              // variant="ghost" forces background/border-color to transparent
              // (button.css:41-44), so bg-surface-panel/border-border-weak-base
              // alone were silently losing that cascade fight -- confirmed via
              // getComputedStyle (backgroundColor read back as transparent
              // despite the class being present) rather than assumed.
              class="hidden md:flex h-[31px] w-[min(380px,32vw)] max-w-full min-w-0 items-center gap-2 justify-between rounded-[11px] !border !border-border-weak-base !bg-[var(--surface-panel)] shadow-none cursor-pointer"
              onClick={() => command.trigger("file.open")}
              aria-label={language.t("session.header.searchFiles")}
            >
              <div class="flex min-w-0 flex-1 items-center gap-2 overflow-visible">
                <Icon name="magnifying-glass" size="small" class="text-text-weaker shrink-0" />
                <span class="flex-1 min-w-0 text-12-regular text-text-weak truncate text-left">
                  {language.t("session.header.search.placeholder", {
                    project: name(),
                  })}
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
      <Show when={titlebarSlots.right()}>
        {(mount) => (
          <Portal mount={mount()}>
            <div class="flex items-center gap-2">
              {/* Ports .workspace-head's title+meta pair
                  (Unifia-UI-UX-v110-PORT-READY-R1.html:15234-15236; CSS at
                  lines 219-225: one flex row, bold 11px title + muted 9px
                  meta, gap 8px -- not stacked). Reuses the same
                  workbench.modes.name.* key the breadcrumb already uses for
                  the title; the meta tagline is new (workbench.modes.meta.*). */}
              <div class="hidden 2xl:flex items-center gap-2 max-w-[220px] overflow-hidden shrink-0">
                <b class="text-11-medium text-text-strong shrink-0">
                  {language.t(`workbench.modes.name.${mode.active()}`)}
                </b>
                <span class="text-11-regular text-text-weak whitespace-nowrap overflow-hidden text-ellipsis">
                  {language.t(`workbench.modes.meta.${mode.active()}`)}
                </span>
              </div>

              {/* Ports #layoutSwitch (Unifia-UI-UX-v110-PORT-READY-R1.html:15238-15239),
                  positioned exactly where the maquette's own DOM order puts it:
                  read via live getBoundingClientRect() on the maquette at
                  1440x900 -- every element there is order:0 (no CSS order
                  anywhere), so visual order is DOM order, and layoutSwitch
                  (x=745) sits directly after workspace-head's title/meta and
                  BEFORE .top-actions (explorer/review/terminal/theme, which
                  starts at x=1175) -- not after it, which is where an earlier
                  attempt in this file had it. The maquette's own script
                  (module 070) reduces this to exactly these 3 states for
                  every non-memory mode -- "Graph" is force-hidden outside
                  memory (line 27926-27929, "the historical Graph button
                  never belongs to the global layout selector"). Backed by
                  the same two signals the old single icon-toggle button used
                  (layout.inspector/layout.editorFocus): "Editor" here is
                  exactly that button's enabled state. No visible effect on
                  mobile (sessionPanelWidth only reacts on isDesktop()). */}
              <Show when={platform.platform !== "mobile"}>
                {(() => {
                  const view = createMemo<"chat" | "split" | "main">(() => {
                    if (!layout.inspector.opened()) return "chat"
                    return layout.editorFocus.enabled() ? "main" : "split"
                  })
                  const setView = (next: "chat" | "split" | "main") => {
                    if (next === "chat") {
                      layout.editorFocus.disable()
                      layout.inspector.close()
                      return
                    }
                    if (!layout.inspector.opened()) layout.inspector.open()
                    if (next === "main") layout.editorFocus.enable()
                    else layout.editorFocus.disable()
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
                      class="flex items-center gap-0.5 rounded-lg border border-border-weak-base bg-[var(--surface-panel)] p-0.5 shrink-0"
                    >
                      <For each={options}>
                        {(option) => (
                          <button
                            type="button"
                            role="radio"
                            aria-checked={view() === option.id}
                            class="rounded-md px-2 h-5 text-11-medium transition-colors"
                            classList={{
                              "bg-surface-raised-base text-text-strong": view() === option.id,
                              "text-text-weak hover:text-text-strong": view() !== option.id,
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

              <Show when={projectDirectory()}>
                <div class="hidden xl:flex items-center">
                  <Show
                    when={canOpen()}
                    fallback={
                      <div class="flex h-[24px] box-border items-center rounded-md border border-border-weak-base bg-[var(--surface-panel)] overflow-hidden">
                        <Button
                          variant="ghost"
                          class="rounded-none h-full py-0 pr-3 pl-0.5 gap-1.5 border-none shadow-none"
                          onClick={copyPath}
                          aria-label={language.t("session.header.open.copyPath")}
                        >
                          <Icon name="copy" size="small" class="text-icon-base" />
                          <span class="text-12-regular text-text-strong">
                            {language.t("session.header.open.copyPath")}
                          </span>
                        </Button>
                      </div>
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
                              <DropdownMenu.Separator />
                              <DropdownMenu.Item
                                onSelect={() => {
                                  setMenu("open", false)
                                  copyPath()
                                }}
                              >
                                <div class="flex size-5 shrink-0 items-center justify-center">
                                  <Icon name="copy" size="small" class="text-icon-weak" />
                                </div>
                                <DropdownMenu.ItemLabel>
                                  {language.t("session.header.open.copyPath")}
                                </DropdownMenu.ItemLabel>
                              </DropdownMenu.Item>
                            </DropdownMenu.Content>
                          </DropdownMenu.Portal>
                        </DropdownMenu>
                      </div>
                    </div>
                  </Show>
                </div>
              </Show>
              <div class="flex items-center gap-1">
                {/* Reordered to match .top-actions (Unifia-UI-UX-v110-PORT-READY-R1.html:
                    15248-15251): #topExplorerBtn, #topReviewBtn, #topTerminalBtn,
                    #serverBtn -- file-tree, review, terminal, status, in that
                    order. Was Status/Terminal/Review/FileTree (reversed).
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
                  <TooltipKeybind
                    title={language.t("command.fileTree.toggle")}
                    keybind={command.keybind("fileTree.toggle")}
                  >
                    <Button
                      variant="ghost"
                      class="titlebar-icon w-8 h-6 p-0 box-border"
                      onClick={() => {
                        if (layout.inspector.opened()) {
                          layout.inspector.close()
                          return
                        }
                        layout.inspector.setTab("explorer")
                        layout.inspector.open()
                      }}
                      aria-label={language.t("command.fileTree.toggle")}
                      aria-expanded={layout.inspector.opened() && layout.inspector.tab() === "explorer"}
                      aria-controls="v110-inspector-panel"
                    >
                      <div class="relative flex items-center justify-center size-4">
                        <Icon
                          size="small"
                          name={
                            layout.inspector.opened() && layout.inspector.tab() === "explorer"
                              ? "file-tree-active"
                              : "file-tree"
                          }
                          classList={{
                            "text-icon-strong": layout.inspector.opened() && layout.inspector.tab() === "explorer",
                            "text-icon-weak": !(layout.inspector.opened() && layout.inspector.tab() === "explorer"),
                          }}
                        />
                      </div>
                    </Button>
                  </TooltipKeybind>

                  <TooltipKeybind
                    title={language.t("command.review.toggle")}
                    keybind={command.keybind("review.toggle")}
                  >
                    <Button
                      variant="ghost"
                      class="group/review-toggle titlebar-icon w-8 h-6 p-0 box-border"
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

                <TooltipKeybind
                  title={language.t("command.terminal.toggle")}
                  keybind={command.keybind("terminal.toggle")}
                >
                  <Button
                    variant="ghost"
                    class="group/terminal-toggle titlebar-icon w-8 h-6 p-0 box-border shrink-0"
                    onClick={toggleTerminal}
                    aria-label={language.t("command.terminal.toggle")}
                    aria-expanded={view().terminal.opened()}
                    aria-controls="terminal-panel"
                  >
                    <Icon size="small" name={view().terminal.opened() ? "terminal-active" : "terminal"} />
                  </Button>
                </TooltipKeybind>
                <Tooltip placement="bottom" value={language.t("status.popover.trigger")}>
                  <StatusPopover />
                </Tooltip>

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
