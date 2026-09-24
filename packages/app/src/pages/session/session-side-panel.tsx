import {
  Match,
  Show,
  Suspense,
  Switch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  type JSX,
} from "solid-js"
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
import { useMode } from "@/context/mode"
import { useSDK } from "@/context/sdk"
import { ModeExecutionSurface, ModeInspectorSurface } from "@/pages/session/mode-inspector-content"
import { displayName } from "@/pages/layout/helpers"
import { destinationLabelKey } from "@/utils/destination-label"
import { getFilename } from "@unifia/util/path"
import { useSync } from "@/context/sync"
import { unwrap } from "@/utils/sdk-unwrap"
import { observableSessionId } from "@/components/settings-observability-session-id"
import { sessionTitle } from "@/utils/session-title"
import { executionRows, type ExecutionEvent } from "@/pages/session/execution-log"
import { createOpenSessionFileTab, createSessionTabs, type Sizing } from "@/pages/session/helpers"
import { CodeInspector, codeToolTitleKey, type CodeTool } from "@/pages/session/code-inspector/code-inspector"
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
  revert: (messageID: string) => void
  reverting: () => boolean
}) {
  const layout = useLayout()
  const file = useFile()
  const language = useLanguage()
  const dialog = useDialog()
  const sdk = useSDK()
  const mode = useMode()
  const sync = useSync()
  const { sessionKey, tabs } = useSessionLayout()

  const shell = useShell(useViewport())
  const isOverlay = createMemo(() => shell.kind() === "overlay")
  const inspectorVisible = createMemo(() => layout.inspector.opened() || layout.hover.inspector.active())
  const destination = createMemo(() => mode.destination())
  // Maquette #inspectTitle: "{project} · Explorer", "{mode} · Inspector",
  // and the bare tab name for Execution.
  const projectName = createMemo(() => {
    const directory = mode.directory() ?? sdk.directory
    const project = layout.projects.list().find((p) => p.worktree === directory || p.sandboxes?.includes(directory))
    return project ? displayName(project) : getFilename(directory)
  })
  // The Execution tab lists the session's native observability spans; they
  // are fetched each time the tab opens (execution-log.ts shapes them).
  const [executionEvents] = createResource(
    () =>
      layout.inspector.tab() === "execution" && inspectorVisible() ? observableSessionId(props.sessionId) : undefined,
    (sessionId) =>
      unwrap(sdk.client.observability.events.list({ sessionId, scope: "project", limit: 200 })) as Promise<
        ExecutionEvent[]
      >,
  )
  // Read in the frame header, outside the tabs' Suspense: touching the
  // resource before its first value would suspend the whole session, so it
  // counts only once events have arrived.
  const executionCount = createMemo(() => {
    const state = executionEvents.state
    const events = state === "ready" || state === "refreshing" ? (executionEvents.latest ?? []) : []
    return executionRows(events, "all", (status) => status).length
  })

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

  // Code inspector (ADR-049): the file the editor shows, and a jump to a file
  // line from its outline and search results.
  const tabState = createSessionTabs({ tabs, pathFromTab: file.pathFromTab, normalizeTab })
  const activeFile = createMemo(() => {
    const tab = tabState.activeFileTab()
    return tab ? file.pathFromTab(tab) : undefined
  })
  const openLocation = (path: string, line?: number) => {
    openTab(file.tab(path))
    if (line) file.setSelectedLines(path, { start: line, end: line })
  }

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
      onPointerMove={layout.hover.inspector.enterPanel}
      onPointerLeave={layout.hover.inspector.leavePanel}
      aria-hidden={!inspectorVisible()}
      inert={!inspectorVisible()}
      data-resizing={props.size.active() || props.reviewSnap ? "" : undefined}
      class="relative min-w-0 flex shrink-0 overflow-hidden bg-background-base"
      classList={{
        // Desktop: side panel with horizontal width transition
        "h-full": !isOverlay(),
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
      <div class="size-full box-border flex border-l border-border-weaker-base">
        <InspectorFrame
          tab={layout.inspector.tab()}
          onTab={(tab) => layout.inspector.setTab(tab)}
          open={inspectorVisible()}
          onToggle={() => {
            layout.hover.inspector.cancel()
            layout.inspector.toggle()
          }}
          label={language.t("session.panel.reviewAndFiles")}
          heading={heading()}
          headExtra={
            <Show when={layout.inspector.tab() === "execution"}>
              <span data-slot="execution-context">{executionContext()}</span>
              <span data-slot="execution-count">
                {language.t("inspector.execution.count", { count: executionCount() })}
              </span>
            </Show>
          }
          title={(tab) =>
            tab === "explorer"
              ? language.t("inspector.tab.explorer")
              : tab === "execution"
                ? language.t("inspector.tab.execution")
                : language.t("inspector.tab.inspector")
          }
        >
          {/* WHY: the tabs read resources (and lazy chunks). Without a local
              boundary the first open suspends the app-level Suspense and the
              whole session vanishes for a few frames. */}
          <Suspense>
            <Switch>
              {/* Explorer matches the reference in every mode: the Workspace
                label, the project row and the live project tree. */}
              <Match when={layout.inspector.tab() === "explorer"}>
                <div data-v110="inspector-explorer" class="group/filetree">
                  <div class="v43-inspector-section">
                    <span>{language.t("inspector.explorer.workspace")}</span>
                    <DropdownMenu gutter={4} placement="bottom-end">
                      <DropdownMenu.Trigger
                        as={IconButton}
                        icon="plus-small"
                        variant="ghost"
                        size="small"
                        data-slot="explorer-add"
                      />
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
                  <div class="v43-file-project">
                    <span aria-hidden="true">⌄</span>
                    <span class="truncate">{projectName()}</span>
                  </div>
                  <Switch>
                    <Match when={nofiles()}>{empty(language.t("session.files.empty"))}</Match>
                    <Match when={true}>
                      <FileTree
                        path=""
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
              <Match when={layout.inspector.tab() === "inspector" && destination() === "code"}>
                <CodeInspector
                  tool={codeTool()}
                  onTool={setCodeTool}
                  sessionId={props.sessionId}
                  changedFiles={props.diffs().length}
                  activeFile={activeFile()}
                  review={props.reviewPanel}
                  open={openLocation}
                  restore={(messageID) => {
                    if (props.sessionId) props.revert(messageID)
                  }}
                  reverting={props.reverting()}
                />
              </Match>
              <Match when={layout.inspector.tab() === "inspector"}>
                <ModeInspectorSurface mode={destination()} />
              </Match>

              {/* Execution: v110 names this tab "Trajectory/Observability"
                (OWNERSHIP.md, RESPONSIVE-MATRIX.md — "onglet Execution de
                l'inspector natif" IS the trajectory/observability tab, not
                a task runner). The real backend already exists and is
                session-scoped (sdk.client.observability.events/trace),
                already wired into Settings > Observability's timeline —
                reused here as-is rather than rebuilt. */}
              <Match when={layout.inspector.tab() === "execution"}>
                <ModeExecutionSurface mode={destination()} events={executionEvents()} />
              </Match>
            </Switch>
          </Suspense>
        </InspectorFrame>
      </div>

      {/* All inspector tabs share this fixed-width track and resize handle. */}
      <Show when={inspectorVisible() && !isOverlay()}>
        <div data-slot="inspector-resize" onPointerDown={() => props.size.start()}>
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
