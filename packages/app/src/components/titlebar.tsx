import { createEffect, createMemo, Show, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocation, useNavigate } from "@solidjs/router"
import { IconButton } from "@unifia/ui/icon-button"
import { Icon } from "@unifia/ui/icon"
import { Button } from "@unifia/ui/button"
import { Tooltip, TooltipKeybind } from "@unifia/ui/tooltip"
import { Logo } from "@unifia/ui/logo"
import { useTheme } from "@unifia/ui/theme/context"

import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { applyPath, backPath, forwardPath } from "./titlebar-history"
import { useTitlebarSlots } from "@/context/titlebar-slots"

type TauriDesktopWindow = {
  startDragging?: () => Promise<void>
  minimize?: () => Promise<void>
  toggleMaximize?: () => Promise<void>
  close?: () => Promise<void>
}

type TauriThemeWindow = {
  setTheme?: (theme?: "light" | "dark" | null) => Promise<void>
}

type TauriApi = {
  window?: {
    getCurrentWindow?: () => TauriDesktopWindow
  }
  webviewWindow?: {
    getCurrentWebviewWindow?: () => TauriThemeWindow
  }
}

const tauriApi = () => (window as unknown as { __TAURI__?: TauriApi }).__TAURI__
const currentThemeWindow = () => tauriApi()?.webviewWindow?.getCurrentWebviewWindow?.()

export function Titlebar() {
  const layout = useLayout()
  const platform = usePlatform()
  const command = useCommand()
  const language = useLanguage()
  const theme = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const slots = useTitlebarSlots()

  const toggleScheme = () => theme.setColorScheme(theme.mode() === "light" ? "dark" : "light")

  const mac = createMemo(() => platform.platform === "desktop" && platform.os === "macos")
  const windows = createMemo(() => platform.platform === "desktop" && platform.os === "windows")
  const zoom = () => platform.webviewZoom?.() ?? 1
  const minHeight = () => (mac() ? `${40 / zoom()}px` : undefined)

  const [history, setHistory] = createStore({
    stack: [] as string[],
    index: 0,
    action: undefined as "back" | "forward" | undefined,
  })

  const path = () => `${location.pathname}${location.search}${location.hash}`

  createEffect(() => {
    const current = path()

    untrack(() => {
      const next = applyPath(history, current)
      if (next === history) return
      setHistory(next)
    })
  })

  const back = () => {
    const next = backPath(history)
    if (!next) return
    setHistory(next.state)
    navigate(next.to)
  }

  const forward = () => {
    const next = forwardPath(history)
    if (!next) return
    setHistory(next.state)
    navigate(next.to)
  }

  command.register(() => [
    {
      id: "common.goBack",
      title: language.t("common.goBack"),
      category: language.t("command.category.view"),
      keybind: "mod+[",
      onSelect: back,
    },
    {
      id: "common.goForward",
      title: language.t("common.goForward"),
      category: language.t("command.category.view"),
      keybind: "mod+]",
      onSelect: forward,
    },
  ])

  const getWin = () => platform.platform === "desktop" ? platform.windowControls : undefined

  createEffect(() => {
    if (platform.platform !== "desktop") return

    const scheme = theme.colorScheme()
    const value = scheme === "system" ? null : scheme

    const win = currentThemeWindow()
    if (!win?.setTheme) return

    void win.setTheme(value).catch(() => undefined)
  })

  const interactive = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return false

    const selector =
      "button, a, input, textarea, select, option, [role='button'], [role='menuitem'], [contenteditable='true'], [contenteditable='']"

    return !!target.closest(selector)
  }

  const drag = (e: MouseEvent) => {
    if (platform.platform !== "desktop") return
    if (e.buttons !== 1) return
    if (interactive(e.target)) return

    const win = getWin()
    if (!win?.startDragging) return

    e.preventDefault()
    void win.startDragging().catch(() => undefined)
  }

  const maximize = (e: MouseEvent) => {
    if (platform.platform !== "desktop") return
    if (interactive(e.target)) return
    if (e.target instanceof Element && e.target.closest("[data-window-controls]")) return

    const win = getWin()
    if (!win?.toggleMaximize) return

    e.preventDefault()
    void win.toggleMaximize().catch(() => undefined)
  }

  return (
    <header
      data-component="v110-topbar"
      data-v110="topbar"
      data-parity="shell.topbar"
      class="shrink-0 bg-background-base relative grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center"
      style={{ height: "var(--v110-topbar, 48px)", "min-height": minHeight() }}
      data-tauri-drag-region
      onMouseDown={drag}
      onDblClick={maximize}
    >
      <div
        classList={{
          "flex items-center min-w-0": true,
          // .topbar{padding:0 12px} (Unifia-UI-UX-v110-PORT-READY-R1.html:102)
          "pl-3": !mac(),
        }}
      >
        <Show when={mac()}>
          <div class="h-full shrink-0" style={{ width: `${72 / zoom()}px` }} />
          <div class="shell:hidden w-10 shrink-0 flex items-center justify-center">
            <IconButton
              icon="menu"
              variant="ghost"
              class="titlebar-icon rounded-md"
              onClick={layout.mobileSidebar.toggle}
              aria-label={language.t("sidebar.menu.toggle")}
              aria-expanded={layout.mobileSidebar.opened()}
            />
          </div>
        </Show>
        <Show when={!mac()}>
          <div class="shell:hidden w-[48px] shrink-0 flex items-center justify-center">
            <IconButton
              icon="menu"
              variant="ghost"
              class="titlebar-icon rounded-md"
              onClick={layout.mobileSidebar.toggle}
              aria-label={language.t("sidebar.menu.toggle")}
              aria-expanded={layout.mobileSidebar.opened()}
            />
          </div>
        </Show>
        <div class="flex items-center gap-1 shrink-0">
          {/* #toggleRailBtn (Unifia-UI-UX-v110-PORT-READY-R1.html:15227,
              "shell.classList.toggle('hide-rail')") -- toggles the mode-icon
              rail (sidebar-shell.tsx, data-v110="rail"), distinct from the
              context panel below (layout.sidebar / showContextBtn). Had no
              app equivalent at all before this -- layout.rail is new state.
              The maquette renders this as a literal "▸" text glyph (no SVG,
              no state-dependent icon swap), matched literally rather than
              guessing an icon, consistent with this file's own window-control
              buttons a few lines down which also use raw unicode glyphs. */}
          <Tooltip placement="bottom" value={language.t("command.rail.toggle")} class="hidden shell:flex shrink-0">
            <Button
              variant="ghost"
              class="titlebar-icon w-8 h-[31px] p-0 box-border grid place-items-center"
              onPointerEnter={layout.hover.rail.enterTrigger}
              onPointerLeave={layout.hover.rail.leaveTrigger}
              onMouseEnter={layout.hover.rail.enterTrigger}
              onMouseLeave={layout.hover.rail.leaveTrigger}
              onClick={() => {
                layout.hover.rail.cancel()
                layout.rail.toggle()
              }}
              aria-label={language.t("command.rail.toggle")}
              aria-expanded={layout.rail.opened()}
            >
              <span aria-hidden="true" class="text-icon-weak text-[12px] leading-none">
                ▸
              </span>
            </Button>
          </Tooltip>
          <TooltipKeybind
            class="hidden shell:flex shrink-0"
            placement="bottom"
            title={language.t("command.sidebar.toggle")}
            keybind={command.keybind("sidebar.toggle")}
          >
            <Button
              variant="ghost"
              class="group/sidebar-toggle titlebar-icon w-8 h-[31px] p-0 box-border"
              onPointerEnter={layout.hover.sidebar.enterTrigger}
              onPointerLeave={layout.hover.sidebar.leaveTrigger}
              onMouseEnter={layout.hover.sidebar.enterTrigger}
              onMouseLeave={layout.hover.sidebar.leaveTrigger}
              onClick={() => {
                layout.hover.sidebar.cancel()
                layout.sidebar.toggle()
              }}
              aria-label={language.t("command.sidebar.toggle")}
              aria-expanded={layout.sidebar.opened()}
            >
              <Icon size="small" name={layout.sidebar.opened() ? "sidebar-active" : "sidebar"} />
            </Button>
          </TooltipKeybind>
          <Logo class="h-6 w-auto ml-1 shrink-0" />
          {/* The maquette's frozen topbar (Unifia-UI-UX-v110-PORT-READY-R1.html:
              15226-15232) has no quick "new session" button, and no back/
              forward navigation buttons, here at all -- rail-toggle ->
              showContextBtn -> brand -> crumbs directly. Both button groups
              previously here had no maquette slot; removed on explicit user
              decision (2026-09-21, "rien de plus rien de moins"). Neither
              capability is lost: session.new is a real, independently-
              registered command (use-session-commands.tsx) with its own
              keybind (mod+shift+s), command-palette entry, and /new slash
              command; back/forward are registered right below
              (common.goBack/common.goForward) with mod+[ / mod+] and a
              command-palette entry, entirely independent of these buttons. */}
        </div>
        <div ref={slots.registerLeft} class="flex items-center gap-3 min-w-0 px-2" />
      </div>

      <div class="min-w-0 flex items-center justify-center pointer-events-none">
        <div ref={slots.registerCenter} class="pointer-events-auto min-w-0 flex justify-center w-fit max-w-full" />
      </div>

      <div
        classList={{
          "flex items-center min-w-0 justify-end": true,
          // .topbar{padding:0 12px} (Unifia-UI-UX-v110-PORT-READY-R1.html:102)
          "pr-3": !windows(),
        }}
        data-tauri-drag-region
        onMouseDown={drag}
      >
        <div ref={slots.registerRight} class="flex items-center gap-1 shrink-0 justify-end" />
        {/* The icon set has no sun/moon glyph, so the theme toggle draws its
            own. #themeBtn (Unifia-UI-UX-v110-PORT-READY-R1.html, lines
            4871-4880) is never in the .app.show-home hide-list (lines
            4013-4027), so the maquette keeps it visible on every route, not
            just home -- this used to be gated behind `home()`, which hid it
            the moment a project was opened. */}
        {/* Raw <button>, not the shared Button/IconButton component (no
            sun/moon glyph in the shared icon set), so it does not inherit
            [data-variant="ghost"]'s own `color: var(--text-strong)` default
            (button.css:44) the way its sibling icon buttons do. Was
            text-text-weak, rendering visibly dimmer (measured
            rgb(112,112,112)) than every neighboring icon button (measured
            rgb(237,237,237)) and the maquette's uniformly bright
            themeBtn (rgb(242,242,243)) -- matched explicitly instead of
            relying on a raw element's own default. */}
        <button
          type="button"
          class="titlebar-icon rounded-md shrink-0 text-text-strong grid place-items-center w-8 h-[31px]"
          onClick={toggleScheme}
          aria-label={theme.mode() === "light" ? "Switch to dark theme" : "Switch to light theme"}
          title={theme.mode() === "light" ? "Switch to dark theme" : "Switch to light theme"}
        >
          <Show
            when={theme.mode() === "light"}
            fallback={
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <circle cx="10" cy="10" r="3.4" stroke="currentColor" stroke-width="1.4" />
                <path
                  d="M10 2.2v2M10 15.8v2M2.2 10h2M15.8 10h2M4.5 4.5l1.4 1.4M14.1 14.1l1.4 1.4M15.5 4.5l-1.4 1.4M5.9 14.1l-1.4 1.4"
                  stroke="currentColor"
                  stroke-width="1.4"
                  stroke-linecap="round"
                />
              </svg>
            }
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="M16.2 12.4A7 7 0 0 1 7.6 3.8a7 7 0 1 0 8.6 8.6Z"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linejoin="round"
              />
            </svg>
          </Show>
        </button>
        {/* #topInspectorBtn (Unifia-UI-UX-v110-PORT-READY-R1.html:15269) --
            a generic "show/hide the whole inspector panel" toggle, standalone
            and always visible, distinct from fileTree.toggle/review.toggle
            (session-header.tsx) which each also FORCE a specific tab. Live-
            verified present and visible (display:grid) in the maquette's
            "code" mode, right after themeBtn -- the app had no equivalent at
            all before this. Reuses showContextBtn's own sidebar/sidebar-active
            icon mirrored (-scale-x-100), not the layout-right/-full family --
            those are solid-fill rectangles, a different visual language from
            sidebar-active's stroke outline + 10%-opacity tint (no solid
            fill), and the maquette's own two icons are literally the same
            rect+single-divider shape reflected around the center. */}
        <Tooltip placement="bottom" value={language.t("command.inspector.toggle")}>
          <Button
            variant="ghost"
            class="titlebar-icon rounded-md shrink-0 w-8 h-[31px] p-0 box-border"
            onPointerEnter={layout.hover.inspector.enterTrigger}
            onPointerLeave={layout.hover.inspector.leaveTrigger}
            onMouseEnter={layout.hover.inspector.enterTrigger}
            onMouseLeave={layout.hover.inspector.leaveTrigger}
            onClick={() => {
              layout.hover.inspector.cancel()
              layout.inspector.opened() ? layout.inspector.close() : layout.inspector.open()
            }}
            aria-label={language.t("command.inspector.toggle")}
            aria-expanded={layout.inspector.opened()}
          >
            <Icon
              size="small"
              class="-scale-x-100"
              name={layout.inspector.opened() ? "sidebar-active" : "sidebar"}
            />
          </Button>
        </Tooltip>
        <Show when={platform.windowControls}>
          <div data-window-controls class="flex flex-row shrink-0">
            <button
              data-window-control="minimize"
              class="h-8 w-[58px] shrink-0 border-0 bg-transparent p-0 text-12-regular text-text-weak hover:bg-surface-raised-base-active"
              type="button"
              title="Minimize"
              aria-label="Minimize"
              onClick={() => void getWin()?.minimize?.().catch(() => undefined)}
            >
              <span aria-hidden="true">−</span>
            </button>
            <button
              data-window-control="maximize"
              class="h-8 w-[58px] shrink-0 border-0 bg-transparent p-0 text-12-regular text-text-weak hover:bg-surface-raised-base-active"
              type="button"
              title="Maximize"
              aria-label="Maximize"
              onClick={() => void getWin()?.toggleMaximize?.().catch(() => undefined)}
            >
              <span aria-hidden="true">□</span>
            </button>
            <button
              data-window-control="close"
              class="h-8 w-[58px] shrink-0 border-0 bg-transparent p-0 text-12-regular text-text-weak hover:bg-red-600 hover:text-white"
              type="button"
              title="Close"
              aria-label="Close"
              onClick={() => void getWin()?.close?.().catch(() => undefined)}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        </Show>
      </div>
    </header>
  )
}
