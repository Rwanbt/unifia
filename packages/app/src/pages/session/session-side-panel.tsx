import { Match, Show, Switch, createEffect, createMemo, type JSX } from "solid-js"
import { IconButton } from "@unifia/ui/icon-button"
import { Separator } from "@/primitives/separator"
import { InspectorFrame } from "@/shell/v110-inspector-frame"
import type { FileDiff } from "../../types/sdk-shim"
import { useDialog } from "@unifia/ui/context/dialog"

import { DropdownMenu } from "@unifia/ui/dropdown-menu"
import { showToast } from "@unifia/ui/toast"
import type { FileNode } from "../../types/sdk-shim"
import FileTree from "@/components/file-tree"
import { requestAutoEdit } from "@/pages/session/file-tabs"
import { useFile, type SelectedLineRange } from "@/context/file"
import { createFileOpDeps } from "@/context/file/operations"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { SettingsObservabilityTimeline } from "@/components/settings-observability-timeline"
import { createOpenSessionFileTab, type Sizing } from "@/pages/session/helpers"
import { setSessionHandoff } from "@/pages/session/handoff"
import { useSessionLayout } from "@/pages/session/session-layout"
import { useShell, useViewport } from "@/shell/v110-store"

export function SessionSidePanel(props: {
  canReview: () => boolean
  diffs: () => FileDiff[]
  diffsReady: () => boolean
  empty: () => string
  hasReview: () => boolean
  reviewCount: () => number
  reviewPanel: () => JSX.Element
  activeDiff?: string
  focusReviewDiff: (path: string) => void
  reviewSnap: boolean
  size: Sizing
  sessionId?: string
}) {
  const layout = useLayout()
  const file = useFile()
  const language = useLanguage()
  const dialog = useDialog()
  const sdk = useSDK()
  const { sessionKey, tabs } = useSessionLayout()

  const shell = useShell(useViewport())
  const isOverlay = createMemo(() => shell.kind() === "overlay")
  const inspectorVisible = createMemo(() => layout.inspector.opened() || layout.hover.inspector.active())

  // The maquette keeps every inspector tab inside the fixed --inspector track.
  // Only the content inside that track scrolls; the review content does not
  // expand the shell column to the chat width.
  const panelWidth = createMemo(() => {
    if (!inspectorVisible()) return "0px"
    return `${layout.inspector.width()}px`
  })

  // RESPONSIVE-MATRIX.md desktop-compact invariant: opening the left panel
  // closes the Inspector and inversely (single-utility side, per the A1
  // viewport contract's exclusive()). One inspector pane now (v110
  // InspectorFrame), so this collapses to one pair of effects on the
  // shared opened() flag instead of two panes' worth.
  createEffect(() => {
    if (!shell.single()) return
    if (!layout.sidebar.opened()) return
    if (layout.inspector.opened()) layout.inspector.close()
  })
  createEffect(() => {
    if (!shell.single()) return
    if (!layout.inspector.opened()) return
    if (layout.sidebar.opened()) layout.sidebar.close()
  })

  const diffFiles = createMemo(() => props.diffs().map((d) => d.file))
  const kinds = createMemo(() => {
    const merge = (a: "add" | "del" | "mix" | undefined, b: "add" | "del" | "mix") => {
      if (!a) return b
      if (a === b) return a
      return "mix" as const
    }

    const normalize = (p: string) => p.replaceAll("\\\\", "/").replace(/\/+$/, "")

    const out = new Map<string, "add" | "del" | "mix">()
    for (const diff of props.diffs()) {
      const file = normalize(diff.file)
      const kind = diff.status === "added" ? "add" : diff.status === "deleted" ? "del" : "mix"

      out.set(file, kind)

      const parts = file.split("/")
      for (const [idx] of parts.slice(0, -1).entries()) {
        const dir = parts.slice(0, idx + 1).join("/")
        if (!dir) continue
        out.set(dir, merge(out.get(dir), kind))
      }
    }
    return out
  })

  const empty = (msg: string) => (
    <div class="h-full flex flex-col">
      <div class="h-6 shrink-0" aria-hidden />
      <div class="flex-1 pb-64 flex items-center justify-center text-center">
        <div class="text-12-regular text-text-weak">{msg}</div>
      </div>
    </div>
  )

  const nofiles = createMemo(() => {
    const state = file.tree.state("")
    if (!state?.loaded) return false
    return file.tree.children("").length === 0
  })

  const normalizeTab = (tab: string) => {
    if (!tab.startsWith("file://")) return tab
    return file.tab(tab)
  }

  const openReviewPanel = () => {
    layout.inspector.setTab("inspector")
    if (!layout.inspector.opened()) layout.inspector.open()
  }

  const openTab = createOpenSessionFileTab({
    normalizeTab,
    openTab: tabs().open,
    pathFromTab: file.pathFromTab,
    loadFile: file.load,
    openReviewPanel,
    setActive: tabs().setActive,
  })

  const handleNewFile = (parentDir: string) => {
    void import("@/components/dialog-file-create").then((x) => {
      dialog.show(() => (
        <x.DialogFileCreate
          mode="file"
          parentDir={parentDir}
          deps={createFileOpDeps(sdk, file)}
          onCreated={(path) => openTab(file.tab(path))}
        />
      ))
    })
  }

  const handleNewFolder = (parentDir: string) => {
    void import("@/components/dialog-file-create").then((x) => {
      dialog.show(() => <x.DialogFileCreate mode="folder" parentDir={parentDir} deps={createFileOpDeps(sdk, file)} />)
    })
  }

  const handleRename = (node: FileNode) => {
    void import("@/components/dialog-file-rename").then((x) => {
      dialog.show(() => (
        <x.DialogFileRename
          node={node}
          deps={createFileOpDeps(sdk, file)}
          onRenamed={(oldPath, newPath) => {
            tabs().close(file.tab(oldPath))
            openTab(file.tab(newPath))
          }}
        />
      ))
    })
  }

  const handleDelete = (node: FileNode) => {
    void import("@/components/dialog-file-delete").then((x) => {
      dialog.show(() => (
        <x.DialogFileDelete
          node={node}
          deps={createFileOpDeps(sdk, file)}
          onDeleted={(path) => tabs().close(file.tab(path))}
        />
      ))
    })
  }

  const handleMove = (node: FileNode) => {
    void import("@/components/dialog-file-move").then((x) => {
      dialog.show(() => (
        <x.DialogFileMove
          node={node}
          deps={createFileOpDeps(sdk, file)}
          onMoved={(oldPath, newPath) => {
            tabs().close(file.tab(oldPath))
            openTab(file.tab(newPath))
          }}
        />
      ))
    })
  }

  const handleCopyPath = (path: string) => {
    void navigator.clipboard.writeText(path).then(() => {
      showToast({ title: language.t("toast.file.pathCopied") })
    })
  }

  const handleFileDblClick = (node: FileNode) => {
    requestAutoEdit(node.path)
    openTab(file.tab(node.path))
  }

  createEffect(() => {
    if (!file.ready()) return

    setSessionHandoff(sessionKey(), {
      files: tabs()
        .all()
        .reduce<Record<string, SelectedLineRange | null>>((acc, tab) => {
          const path = file.pathFromTab(tab)
          if (!path) return acc

          const selected = file.selectedLines(path)
          acc[path] =
            selected && typeof selected === "object" && "start" in selected && "end" in selected
              ? (selected as SelectedLineRange)
              : null

          return acc
        }, {}),
    })
  })

  return (
    // v110 InspectorFrame (shell/v110-inspector-frame.tsx, A2): one shared
    // pane, one tab visible at a time — no second Explorer, no dual-pane.
    // The frame itself is fixed-width chrome (no open/closed collapse, no
    // resize of its own; "Sizes come from A1 vars"), so this wrapper drives
    // --v110-inspector and owns the resize handle and the open/closed width.
    <div
      data-v110="inspector-content"
      onPointerEnter={layout.hover.inspector.enterPanel}
      onPointerLeave={layout.hover.inspector.leavePanel}
      aria-hidden={!inspectorVisible()}
      inert={!inspectorVisible()}
      class="relative min-w-0 flex shrink-0 overflow-hidden bg-background-base"
      classList={{
        // Desktop: side panel with horizontal width transition
        "h-full": !isOverlay(),
        "transition-[width] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
          !isOverlay() && !props.size.active() && !props.reviewSnap,
        // Overlay viewports use a full-height inspector over session content.
        "mobile-side-panel w-full": isOverlay(),
        "pointer-events-none": !inspectorVisible(),
      }}
      style={
        isOverlay()
          ? {
              // Full height (not a half-sheet): browsing files/reviewing
              // changes is a primary mobile task, not a quick peek — the
              // panel is `position: absolute` over the session content (see
              // v110.css .mobile-side-panel), so covering the composer
              // underneath is the intended behavior while it's open.
              height: inspectorVisible() ? "100%" : "0px",
              transition: "height 240ms cubic-bezier(0.22,1,0.36,1)",
            }
          : {
              width: panelWidth(),
              // The frame's own `width: var(--v110-inspector, 300px)` resolves
              // against ITS containing block, which is already sized to
              // panelWidth() by this wrapper — feeding it the same calc()
              // string here would recompute it a second time against that
              // already-narrowed box (calc(100% - 600px) of 599px, not of the
              // viewport) and could go negative. 100% just fills whatever
              // width the wrapper already settled on.
              "--v110-inspector": "100%",
            }
      }
    >
      <div class="size-full flex border-l border-border-weaker-base">
        <InspectorFrame
          tab={layout.inspector.tab()}
          onTab={(tab) => layout.inspector.setTab(tab)}
          open={inspectorVisible()}
          onToggle={() => {
            layout.hover.inspector.cancel()
            layout.inspector.toggle()
          }}
          label={language.t("session.panel.reviewAndFiles")}
          title={(tab) =>
            tab === "explorer"
              ? language.t("inspector.tab.explorer")
              : tab === "execution"
                ? language.t("inspector.tab.execution")
                : language.t("inspector.tab.inspector")
          }
        >
          <Switch>
            {/* Explorer matches the reference: Workspace plus the live project tree. */}
            <Match when={layout.inspector.tab() === "explorer"}>
              <div class="h-full flex flex-col overflow-hidden group/filetree bg-background-stronger px-3 py-2">
                <div class="flex items-center justify-between px-1 pb-2">
                  <span class="text-11-medium text-text-weaker uppercase tracking-wide">Workspace</span>
                  <DropdownMenu gutter={4} placement="bottom-end">
                    <DropdownMenu.Trigger as={IconButton} icon="plus-small" variant="ghost" size="small" />
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content>
                        <DropdownMenu.Item onSelect={() => handleNewFile("")}>
                          <DropdownMenu.ItemLabel>{language.t("fileOps.newFile")}</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                        <DropdownMenu.Item onSelect={() => handleNewFolder("")}>
                          <DropdownMenu.ItemLabel>{language.t("fileOps.newFolder")}</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu>
                </div>
                <Switch>
                  <Match when={nofiles()}>{empty(language.t("session.files.empty"))}</Match>
                  <Match when={true}>
                    <FileTree
                      path=""
                      class="pt-1"
                      modified={diffFiles()}
                      kinds={kinds()}
                      onFileClick={(node) => openTab(file.tab(node.path))}
                      onFileDblClick={handleFileDblClick}
                      onNewFile={handleNewFile}
                      onNewFolder={handleNewFolder}
                      onRename={handleRename}
                      onDelete={handleDelete}
                      onMove={handleMove}
                      onCopyPath={handleCopyPath}
                      onCopyRelativePath={handleCopyPath}
                    />
                  </Match>
                </Switch>
              </div>
            </Match>

            {/* Inspector is a property surface, not the code editor. The
                editor owns file tabs and split panes in its own workspace;
                this panel stays on the maquette's card-based inspection view. */}
            <Match when={layout.inspector.tab() === "inspector"}>
              <div data-v110="inspector-body" class="h-full min-w-0 overflow-y-auto bg-background-base p-2.5">
                <div class="mb-2.5 rounded-[13px] border border-border-base bg-background-stronger p-2.5">
                  <h4 class="mb-2 text-10-medium text-text-base">Session</h4>
                  <div class="flex items-center justify-between border-b border-border-base py-1.5 text-10-regular">
                    <span class="text-text-weak">Mode</span>
                    <span class="text-text-base">Code</span>
                  </div>
                  <div class="flex items-center justify-between border-b border-border-base py-1.5 text-10-regular">
                    <span class="text-text-weak">Panneau actif</span>
                    <span class="text-text-base">Inspector</span>
                  </div>
                  <div class="flex items-center justify-between py-1.5 text-10-regular">
                    <span class="text-text-weak">Contexte</span>
                    <span class="text-text-base">Session</span>
                  </div>
                </div>
                <div class="rounded-[13px] border border-border-base bg-background-stronger p-2.5">
                  <h4 class="mb-2 text-10-medium text-text-base">Propriétés</h4>
                  <label class="mb-2.5 flex flex-col gap-1.5 text-9-regular text-text-weak">
                    Densité
                    <input type="range" value="56" aria-label={language.t("settings.fork.observability.level")} class="w-full accent-text-base" />
                  </label>
                  <label class="mb-2.5 flex flex-col gap-1.5 text-9-regular text-text-weak">
                    Rayon
                    <input type="range" value="68" aria-label="Rayon" class="w-full accent-text-base" />
                  </label>
                  <label class="flex flex-col gap-1.5 text-9-regular text-text-weak">
                    Contraste
                    <input type="range" value="74" aria-label="Contraste" class="w-full accent-text-base" />
                  </label>
                </div>
              </div>
            </Match>

            {/* Execution: v110 names this tab "Trajectory/Observability"
                (OWNERSHIP.md, RESPONSIVE-MATRIX.md — "onglet Execution de
                l'inspector natif" IS the trajectory/observability tab, not
                a task runner). The real backend already exists and is
                session-scoped (sdk.client.observability.events/trace),
                already wired into Settings > Observability's timeline —
                reused here as-is rather than rebuilt. */}
            <Match when={layout.inspector.tab() === "execution"}>
              <SettingsObservabilityTimeline
                sessions={[{ id: props.sessionId ?? "", title: props.sessionId ?? "" }]}
                sessionId={props.sessionId}
                scope="project"
                onSelectSession={() => {}}
              />
            </Match>
          </Switch>
        </InspectorFrame>
      </div>

      {/* All inspector tabs share this fixed-width track and resize handle. */}
      <Show when={inspectorVisible() && !isOverlay()}>
        <div onPointerDown={() => props.size.start()}>
          <Separator
            axis="x"
            edge="start"
            label={language.t("inspector.resize")}
            data-v110="resize-inspector"
            size={layout.inspector.width()}
            min={200}
            max={480}
            onResize={(width) => {
              props.size.touch()
              layout.inspector.resize(width)
            }}
          />
        </div>
      </Show>
    </div>
  )
}
