import { describe, expect, test } from "bun:test"

describe("session workspace layout", () => {
  test("TerminalPanel is below the horizontal desktop workspace, never its third column", async () => {
    const source = await Bun.file(new URL("../session.tsx", import.meta.url)).text()
    const structure =
      /data-component="session-workspace"[\s\S]*data-component="session-workspace-main"[\s\S]*<SessionSidePanel[\s\S]*?\/>\s*<\/div>\s*[\s\S]*?<TerminalPanel \/>/

    expect(source).toMatch(structure)
  })

  test("the workspace remains the positioning context for mobile overlays", async () => {
    const source = await Bun.file(new URL("../session.tsx", import.meta.url)).text()
    expect(source).toContain('data-component="session-workspace" class="relative flex-1 min-h-0 flex flex-col"')
    expect(source).toContain('data-component="session-workspace-main"')
    expect(source).toContain('data-inspector-open={desktopInspectorOpen()}')
    expect(source).toContain('class="flex-1 min-h-0 flex flex-col shell:flex-row"')
  })

  test("overlay panels are styled by the web bundle, not Android-only CSS", async () => {
    const css = await Bun.file(new URL("../../styles/v110.css", import.meta.url)).text()
    const overlayBlock = css.slice(css.indexOf(".mobile-side-panel"))
    expect(overlayBlock).toContain("position: absolute !important")
    expect(overlayBlock).toContain("inset: 0 !important")
    expect(overlayBlock).toContain("z-index: 30 !important")
    expect(overlayBlock).toContain("height: auto !important")
    expect(overlayBlock).not.toContain("100dvh")
    expect(overlayBlock).not.toContain("--vvh")
  })

  test("inspector overlay follows the v110 viewport contract", async () => {
    const source = await Bun.file(new URL("./session-side-panel.tsx", import.meta.url)).text()
    expect(source).toContain('const isOverlay = createMemo(() => shell.kind() === "overlay")')
    expect(source).not.toContain('createMediaQuery("(min-width: 768px)")')
    expect(source).not.toContain("isMobile()")
    expect(source).not.toContain('calc(100% - ${layout.session.width()}px')
    expect(source).toContain('return `${layout.inspector.width()}px`')
  })

  test("desktop inspector uses the same floating-card chrome as the side panels", async () => {
    const css = await Bun.file(new URL("../../styles/v110-inspector.css", import.meta.url)).text()
    const cardBlock = css.slice(css.indexOf('[data-v110="inspector-content"] {'))
    // Maquette #inspectorPanel: 20px under the topbar and from the right
    // edge, 10px above the bottom -- the same card box as the context panel.
    expect(cardBlock).toContain(
      "margin: var(--v110-gutter-outer) var(--v110-gutter-outer) var(--v110-gutter-inner) var(--v110-gutter-inner)",
    )
    expect(cardBlock).toContain("height: calc(100% - var(--v110-gutter-outer) - var(--v110-gutter-inner))")
    expect(cardBlock).toContain("border-radius: var(--v110-radius-xl)")
    expect(cardBlock).toContain("box-shadow: 0 12px 30px rgba(0, 0, 0, 0.18)")
    expect(css).toContain('[data-v110="inspector-content"][aria-hidden="true"]')
    expect(css).toContain("border: 0")
    expect(cardBlock).toContain("border-left: 0")
    expect(cardBlock).toContain('[data-v110="inspector-content"].mobile-side-panel')
  })

  test("desktop chat and editor surfaces keep the same vertical shell gutters", async () => {
    const chatCss = await Bun.file(new URL("../../styles/v110-chat.css", import.meta.url)).text()
    const editorCss = await Bun.file(new URL("../../styles/v110-editor.css", import.meta.url)).text()
    const shellCss = await Bun.file(new URL("../../styles/v110.css", import.meta.url)).text()
    const source = await Bun.file(new URL("../session.tsx", import.meta.url)).text()
    expect(chatCss).toContain('[data-v110="session-chat-surface"]')
    expect(chatCss).toContain("height: calc(100% - 2 * var(--v110-gutter-outer))")
    expect(chatCss).toContain("margin-block: var(--v110-gutter-outer)")
    expect(editorCss).toContain('[data-component="session-editor-main"]')
    expect(editorCss).toContain('[data-component="workbench-mode-main"]')
    expect(editorCss).toContain("height: calc(100% - 2 * var(--v110-gutter-outer))")
    expect(editorCss).toContain("margin-block: var(--v110-gutter-outer)")
    expect(editorCss).toContain('[data-inspector-open="false"] [data-component="session-editor-main"]')
    expect(editorCss).toContain("margin-right: var(--v110-gutter-outer)")
    expect(source).toContain('data-inspector-open={desktopInspectorOpen()}')
    expect(shellCss).toContain('data-v110="rail"] {\n  margin-left: var(--v110-gutter-outer)')
    expect(shellCss).toContain("--v110-gutter-outer: 20px")
    expect(shellCss).toContain("--v110-gutter-inner: 10px")
    expect(shellCss).toContain('[data-v110="rail"][data-visible="false"]')
    expect(shellCss).toContain("  margin: 0;\n  border: 0;")
    const sidebarShell = await Bun.file(new URL("../layout/sidebar-shell.tsx", import.meta.url)).text()
    expect(sidebarShell).toContain("data-visible={railVisible()}")
  })

  test("session coordinator uses the same viewport contract as the inspector", async () => {
    const source = await Bun.file(new URL("../session.tsx", import.meta.url)).text()
    expect(source).toContain('const isDesktop = createMemo(() => shell.kind() !== "overlay")')
    expect(source).toContain("shell:flex-none")
    expect(source).not.toContain('createMediaQuery("(min-width: 768px)")')
    expect(source).toContain("const desktopInspectorWide = createMemo(() => desktopInspectorOpen())")
    expect(source).not.toContain("layout.inspector.tab() === \"inspector\"")
    expect(source).toContain('if (isDesktop() && current === "split")')
    expect(source).toContain("return splitChatWidth({")
    expect(source.indexOf('current === "split"')).toBeLessThan(source.indexOf('if (!desktopInspectorOpen())'))
    expect(source).toContain('current === "main"')
    expect(source).not.toContain("layout.editorFocus.enabled() && desktopInspectorOpen()")
  })

  test("the Chat/Split/Editor switch owns workspace view, not Inspector visibility", async () => {
    const header = await Bun.file(new URL("../../components/session/session-header.tsx", import.meta.url)).text()
    const switchBlock = header.slice(header.indexOf("Ports #layoutSwitch"), header.indexOf("<Show when={titlebarSlots.right()}>"))
    expect(switchBlock).toContain("view().workspace.current()")
    expect(switchBlock).toContain("view().workspace.set(next)")
    expect(switchBlock).not.toContain("layout.inspector.open()")
    expect(switchBlock).not.toContain("layout.inspector.close()")
  })

  test("the topbar exposes Open in and context task actions", async () => {
    const header = await Bun.file(new URL("../../components/session/session-header.tsx", import.meta.url)).text()
    expect(header).toContain('language.t("session.header.openIn")')
    expect(header).toContain('language.t("session.header.createTaskFromContext")')
    expect(header).not.toContain('language.t("session.header.open.copyPath")')
    expect(header).not.toContain('language.t("command.fileTree.toggle")')
    expect(header).toContain('name="open-in"')
    expect(header).toContain('name="task-add"')
  })

  test("topbar chrome uses the canonical neutral maquette palette", async () => {
    const styles = await Bun.file(new URL("../../styles/v110.css", import.meta.url)).text()
    expect(styles).toContain("--v110-topbar-bg: color-mix(in srgb, #121214 94%, transparent)")
    expect(styles).toContain("--v110-topbar-hover: #2a2a2f")
    expect(styles).toContain("--v110-topbar-active: #1b1b1e")
    expect(styles).toContain("border-bottom: 1px solid rgba(255, 255, 255, 0.07)")
  })

  test("Split and Editor mount a real editor surface outside the Inspector", async () => {
    const source = await Bun.file(new URL("../session.tsx", import.meta.url)).text()
    const editor = await Bun.file(new URL("./session-editor-surface.tsx", import.meta.url)).text()
    // SessionEditorSurface is Code mode's branch of a mode-aware Switch (2026-09-22:
    // Work/Design/Automate mount their own surface here instead -- one shared chat
    // pane, per-mode main content) rather than the sole content behind a bare Show.
    expect(source).toContain('<Match when={workspaceView() !== "chat"}>')
    expect(source).toContain("<SessionEditorSurface />")
    expect(editor).toContain('data-v110="mode-main"')
    expect(editor).toContain('data-v110="surface-card"')
    expect(editor).toContain("<FileTabContent tab={tab()} override />")
  })

  test("Work/Design/Automate mount their own surface in the same main slot as the editor", async () => {
    const source = await Bun.file(new URL("../session.tsx", import.meta.url)).text()
    const workSurface = await Bun.file(new URL("../workbench/work-surface.tsx", import.meta.url)).text()
    expect(source).toContain('<Match when={mode.active() === "work" && workspaceView() !== "chat"}>')
    expect(source).toContain("<WorkSurface />")
    expect(workSurface).toContain('data-v110="mode-main"')
    expect(workSurface).toContain('data-v110="surface-card"')
    expect(workSurface).toContain('data-parity="work.surface"')
    expect(source).toContain('<Match when={mode.active() === "design" && workspaceView() !== "chat"}>')
    expect(source).toContain("<DesignSurface />")
    const designSurface = await Bun.file(new URL("../workbench/design-surface.tsx", import.meta.url)).text()
    expect(designSurface).toContain('data-v110="mode-main"')
    expect(designSurface).toContain('data-v110="surface-card"')
    expect(designSurface).toContain('data-parity="design.surface"')
    expect(designSurface).toContain("<DesignWorkspace")
    expect(source).toContain('<Match when={mode.active() === "automate" && workspaceView() !== "chat"}>')
    expect(source).toContain("<AutomateSurface />")
    const automateSurface = await Bun.file(new URL("../workbench/automate-surface.tsx", import.meta.url)).text()
    expect(automateSurface).toContain('data-v110="mode-main"')
    expect(automateSurface).toContain('data-v110="surface-card"')
    expect(automateSurface).toContain('data-parity="automate.surface"')
  })

  test("the Chat/Split/Editor switch controls Work geometry exactly like Code", async () => {
    const source = await Bun.file(new URL("../session.tsx", import.meta.url)).text()
    expect(source).toContain("const workspaceView = createMemo(() => shell.fit(view().workspace.current()))")
    expect(source).not.toContain('mode.active() === "code" ? view().workspace.current() : "split"')
    expect(source).toContain('if (current === "main" && !isMobileDevice()) return "0px"')
    expect(source).toContain('if (isDesktop() && current === "split")')
  })

  test("the Chat/Split/Editor switch controls Design geometry exactly like Code", async () => {
    const source = await Bun.file(new URL("../session.tsx", import.meta.url)).text()
    expect(source).toContain('<Match when={mode.active() === "design" && workspaceView() !== "chat"}>')
    expect(source).toContain("<DesignSurface />")
    expect(source).toContain("const workspaceView = createMemo(() => shell.fit(view().workspace.current()))")
    expect(source).not.toContain('mode.active() === "code" ? view().workspace.current() : "split"')
  })

  test("session settings reuse the editor slot instead of opening a separate dialog", async () => {
    const source = await Bun.file(new URL("../session.tsx", import.meta.url)).text()
    const surface = await Bun.file(new URL("../settings/settings-surface.tsx", import.meta.url)).text()
    expect(source).toContain('mode.destination() === "settings" && workspaceView() !== "chat"')
    expect(source).toContain("<SettingsSurface />")
    expect(surface).toContain('data-v110="mode-main"')
    expect(surface).toContain('data-v110="surface-card"')
    expect(surface).toContain('data-parity="settings.surface"')
    expect(surface).toContain("<SettingsPanel />")
  })

  test("the account destination reuses the editor slot as an independent workspace surface", async () => {
    const source = await Bun.file(new URL("../session.tsx", import.meta.url)).text()
    const surface = await Bun.file(new URL("../settings/user-surface.tsx", import.meta.url)).text()
    expect(source).toContain('mode.destination() === "user" && workspaceView() !== "chat"')
    // Like Settings, the account centre has no close button: the rail leaves it.
    expect(source).toContain("<UserSurface />")
    expect(surface).toContain('data-v110="mode-main"')
    expect(surface).toContain('data-v110="surface-card"')
    expect(surface).toContain('data-parity="user.surface"')
  })

  test("Browser and Memory destinations mount dedicated editor surfaces", async () => {
    const source = await Bun.file(new URL("../session.tsx", import.meta.url)).text()
    const browser = await Bun.file(new URL("../workbench/browser-surface.tsx", import.meta.url)).text()
    const memory = await Bun.file(new URL("../workbench/memory-surface.tsx", import.meta.url)).text()
    expect(source).toContain('mode.destination() === "browser" && workspaceView() !== "chat"')
    expect(source).toContain('mode.destination() === "memory" && workspaceView() !== "chat"')
    expect(browser).toContain('data-parity="browser.surface"')
    expect(browser).toContain("<DesignBrowserTab />")
    expect(memory).toContain('data-parity="memory.surface"')
    expect(memory).toContain("<MemoryPanel />")
  })

  test("the chat pane above is not gated behind mode -- one shared component and session for every mode", async () => {
    const source = await Bun.file(new URL("../session.tsx", import.meta.url)).text()
    const chatSurfaceIndex = source.indexOf('data-v110="session-chat-surface"')
    const switchIndex = source.indexOf('<Match when={mode.active() === "work" && workspaceView() !== "chat"}>')
    expect(chatSurfaceIndex).toBeGreaterThan(-1)
    expect(switchIndex).toBeGreaterThan(chatSurfaceIndex)
    // The chat surface's own render has no `mode.active()` branch anywhere
    // between its opening tag and the mode Switch -- it always renders.
    const chatBlock = source.slice(chatSurfaceIndex, switchIndex)
    expect(chatBlock).not.toContain("mode.active()")
  })

  test("chat keeps the prompt placeholder short and docks copy-context at the conversation edge", async () => {
    const source = await Bun.file(new URL("../session.tsx", import.meta.url)).text()
    const placeholder = await Bun.file(new URL("../../components/prompt-input/placeholder.ts", import.meta.url)).text()
    const chatCss = await Bun.file(new URL("../../styles/v110-chat.css", import.meta.url)).text()
    expect(placeholder).toContain('input.t("prompt.placeholder.simple")')
    expect(source).toContain('data-v110="chat-copy-context"')
    expect(chatCss).toContain('[data-v110="chat-copy-context"]')
    expect(chatCss).toContain("bottom: 112px")
  })

  test("every desktop inspector tab uses the same resize track", async () => {
    const source = await Bun.file(new URL("./session-side-panel.tsx", import.meta.url)).text()
    expect(source).toContain("<Show when={inspectorVisible() && !isOverlay()}>")
    expect(source).toContain("onPointerEnter={layout.hover.inspector.enterPanel}")
    expect(source).toContain("onPointerMove={layout.hover.inspector.enterPanel}")
    expect(source).toContain("!layout.inspector.opened()")
    expect(source).toContain('class="size-full box-border flex border-l border-border-weaker-base"')
    expect(source).not.toContain('layout.inspector.tab() !== "inspector"')
  })

  test("left panel hover reserves only the visible panel width when the rail is retracted", async () => {
    const layout = await Bun.file(new URL("../../context/layout.tsx", import.meta.url)).text()
    const shell = await Bun.file(new URL("../layout.tsx", import.meta.url)).text()
    const sidebarShell = await Bun.file(new URL("../layout/sidebar-shell.tsx", import.meta.url)).text()
    const titlebar = await Bun.file(new URL("../../components/titlebar.tsx", import.meta.url)).text()
    expect(layout).toContain('sidebar: createPeekController("sidebar", 210, 1400)')
    expect(layout).toContain('[data-v110="context-panel"]')
    expect(layout).toContain('makeEventListener(window, "pointermove", handlePointerMove)')
    expect(layout).toContain('event.clientY >= 0 && event.clientY <= rect.bottom')
    expect(shell).toContain("layout.hover.sidebar.active()")
    expect(shell).toContain("const sidebarVisible = layout.sidebar.opened() || layout.hover.sidebar.active()")
    expect(shell).toContain('const rail = railVisible ? "var(--v110-rail, 62px) + " : ""')
    expect(shell).toContain("return `calc(${rail}${panel()}px + ${gaps}px)`")
    expect(shell).not.toContain('if (sidebarVisible) return `calc(${side()}px + 30px)`')
    expect(sidebarShell).toContain("if (props.sidebarPeeked()) props.onSidebarPanelEnter()")
    expect(sidebarShell).not.toContain("onMouseEnter={props.onSidebarPanelEnter}")
    expect(sidebarShell).not.toContain("onMouseLeave={props.onSidebarPanelLeave}")
    expect(sidebarShell).toContain('"transition-[width,opacity] duration-200": props.opened() || props.railOpened()')
    expect(sidebarShell).toContain("onPointerMove={props.onSidebarPanelEnter}")
    expect(titlebar).not.toContain("onMouseEnter={layout.hover.sidebar.enterTrigger}")
    expect(titlebar).not.toContain("onMouseLeave={layout.hover.sidebar.leaveTrigger}")
  })

  test("terminal resize handle follows the platform, not a width breakpoint", async () => {
    const source = await Bun.file(new URL("./terminal-panel.tsx", import.meta.url)).text()
    expect(source).toContain("<Show when={!isMobile()}>")
    expect(source).not.toContain('class="hidden md:block" onPointerDown={() => size.start()}')
  })})
