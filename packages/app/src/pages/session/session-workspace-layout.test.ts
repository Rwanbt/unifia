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
    expect(source).toContain('data-component="session-workspace-main" class="flex-1 min-h-0 flex flex-col shell:flex-row"')
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
    expect(cardBlock).toContain("margin: 12px")
    expect(cardBlock).toContain("height: calc(100% - 24px)")
    expect(cardBlock).toContain("border-radius: var(--v110-radius-xl)")
    expect(cardBlock).toContain("box-shadow: 0 12px 30px rgba(0, 0, 0, 0.18)")
    expect(cardBlock).toContain("border-left: 0")
    expect(cardBlock).toContain('[data-v110="inspector-content"].mobile-side-panel')
  })

  test("desktop chat and editor surfaces keep the same vertical shell gutters", async () => {
    const chatCss = await Bun.file(new URL("../../styles/v110-chat.css", import.meta.url)).text()
    const editorCss = await Bun.file(new URL("../../styles/v110-editor.css", import.meta.url)).text()
    expect(chatCss).toContain('[data-v110="session-chat-surface"]')
    expect(chatCss).toContain("height: calc(100% - 24px)")
    expect(chatCss).toContain("margin-block: 12px")
    expect(editorCss).toContain('[data-component="session-editor-main"]')
    expect(editorCss).toContain("height: calc(100% - 24px)")
    expect(editorCss).toContain("margin-block: 12px")
  })

  test("session coordinator uses the same viewport contract as the inspector", async () => {
    const source = await Bun.file(new URL("../session.tsx", import.meta.url)).text()
    expect(source).toContain('const isDesktop = createMemo(() => shell.kind() !== "overlay")')
    expect(source).toContain("shell:flex-none")
    expect(source).not.toContain('createMediaQuery("(min-width: 768px)")')
    expect(source).toContain("const desktopInspectorWide = createMemo(() => desktopInspectorOpen())")
    expect(source).not.toContain("layout.inspector.tab() === \"inspector\"")
    expect(source).toContain('if (isDesktop() && workspaceView === "split") return `${layout.session.width()}px`')
    expect(source.indexOf('workspaceView === "split"')).toBeLessThan(source.indexOf('if (!desktopInspectorOpen())'))
    expect(source).toContain('workspaceView === "main"')
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

  test("Split and Editor mount a real editor surface outside the Inspector", async () => {
    const source = await Bun.file(new URL("../session.tsx", import.meta.url)).text()
    const editor = await Bun.file(new URL("./session-editor-surface.tsx", import.meta.url)).text()
    expect(source).toContain('<Show when={view().workspace.current() !== "chat"}>')
    expect(source).toContain("<SessionEditorSurface />")
    expect(editor).toContain('data-v110="mode-main"')
    expect(editor).toContain('data-v110="surface-card"')
    expect(editor).toContain("<FileTabContent tab={tab()} override />")
  })

  test("every desktop inspector tab uses the same resize track", async () => {
    const source = await Bun.file(new URL("./session-side-panel.tsx", import.meta.url)).text()
    expect(source).toContain("<Show when={inspectorVisible() && !isOverlay()}>")
    expect(source).toContain("onPointerEnter={layout.hover.inspector.enterPanel}")
    expect(source).not.toContain('layout.inspector.tab() !== "inspector"')
  })

  test("left panel hover has an independent preview state and reserves shell space", async () => {
    const layout = await Bun.file(new URL("../../context/layout.tsx", import.meta.url)).text()
    const shell = await Bun.file(new URL("../layout.tsx", import.meta.url)).text()
    const sidebarShell = await Bun.file(new URL("../layout/sidebar-shell.tsx", import.meta.url)).text()
    expect(layout).toContain('sidebar: createPeekController("sidebar", 210, 700)')
    expect(shell).toContain("layout.hover.sidebar.active()")
    expect(shell).toContain("const sidebarVisible = layout.sidebar.opened() || layout.hover.sidebar.active()")
    expect(sidebarShell).toContain("if (props.sidebarPeeked()) props.onSidebarPanelEnter()")
  })

  test("terminal resize handle follows the platform, not a width breakpoint", async () => {
    const source = await Bun.file(new URL("./terminal-panel.tsx", import.meta.url)).text()
    expect(source).toContain("<Show when={!isMobile()}>")
    expect(source).not.toContain('class="hidden md:block" onPointerDown={() => size.start()}')
  })})
