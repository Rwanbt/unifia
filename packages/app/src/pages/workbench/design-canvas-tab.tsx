/* SPDX-License-Identifier: MIT */

import { createMemo, createSignal, onCleanup, onMount, Show, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { useViewport } from "@/shell/v110-store"
import type { DesignCommand } from "./design/model/commands"
import { createDesignDocument } from "./design/model/document"
import { DesignDocumentError } from "./design/model/errors"
import {
  emptyDesignHistory,
  recordDesignHistory,
  redoDesignHistory,
  undoDesignHistory,
  type DesignHistoryState,
} from "./design/model/history"
import { applyCommand } from "./design/model/reducer"
import { mergeDesignDocuments } from "./design/model/merge"
import type { DesignDocumentV1, DesignNodeId } from "./design/model/schema"
import { importLegacySketch } from "./design/persistence/legacy-import"
import { createLocalStorageDesignDocumentRepository } from "./design/persistence/local-storage-repository"
import type { DesignCommentTarget } from "./design/runtime/comments"
import { DesignCommentsPanel } from "./design/runtime/comments-panel"
import { DesignCanvas } from "./design/runtime/design-canvas"
import { selectionMoves } from "./design/runtime/selection"
import {
  DESIGN_TOOL_KEYS,
  DesignStudioChangeBar,
  DesignStudioDock,
  DesignStudioZoom,
  type DesignSaveState,
} from "./design/runtime/studio-dock"
import { DesignStudioPanel, type DesignStudioCatalog, type DesignStudioView } from "./design/runtime/studio-panel"
import { StudioIcon } from "./design/runtime/studio-icons"
import { draftToNode, type DesignDraft, type DesignTool } from "./design/runtime/tools"
import { zoomAt, type DesignViewport } from "./design/runtime/viewport"

const saveDelayMs = 400
const legacySketchKey = "unifia-design-sketch:v1:sketch"
/** Zoom step of the studio pill, one wheel notch of the reference. */
const ZOOM_STEP = 1.2
/** Left panel width: the reference's 240 px, resizable within these bounds. */
const PANEL_WIDTH = { initial: 240, min: 200, max: 420 } as const
const initialViewport: DesignViewport = { panX: 0, panY: 0, zoom: 1 }

/**
 * Native design document tab (ADR-039): canonical document in, typed
 * commands out, one history entry per committed command, persisted through
 * the repository contract. Rendered as the reference's canvas studio
 * (ADR-085): tool panel, floating dock, change bar, zoom and comments.
 */
export function DesignCanvasTab(props: {
  id: string
  catalogs?: readonly DesignStudioCatalog[]
  workshop?: JSX.Element
}): JSX.Element {
  const language = useLanguage()
  const t = language.t
  const family = useViewport()
  const narrow = createMemo(() => {
    const value = family()
    return value === "phone-portrait" || value === "tablet-portrait" || value === "compact-landscape"
  })
  const repository = createLocalStorageDesignDocumentRepository()
  const [document, setDocument] = createSignal<DesignDocumentV1>(createDesignDocument(props.id, "Canvas"))
  const [checkpoint, setCheckpoint] = createSignal<DesignDocumentV1>(document())
  const [selection, setSelection] = createSignal<readonly DesignNodeId[]>([])
  const [tool, setTool] = createSignal<DesignTool>("select")
  const [commentsOpen, setCommentsOpen] = createSignal(false)
  const [commentTarget, setCommentTarget] = createSignal<DesignCommentTarget>()
  const [highlightedComment, setHighlightedComment] = createSignal<string>()
  const [history, setHistory] = createSignal<DesignHistoryState>(emptyDesignHistory)
  const [error, setError] = createSignal<string>()
  const [importInfo, setImportInfo] = createSignal<string>()
  const [loaded, setLoaded] = createSignal(false)
  const [viewport, setViewport] = createSignal<DesignViewport>(initialViewport)
  const [view, setView] = createSignal<DesignStudioView>("preview")
  const [saveState, setSaveState] = createSignal<DesignSaveState>("saved")
  const [panelOpen, setPanelOpen] = createSignal(true)
  const [drawerOpen, setDrawerOpen] = createSignal(false)
  const [panelWidth, setPanelWidth] = createSignal<number>(PANEL_WIDTH.initial)
  const [hasLegacySketch, setHasLegacySketch] = createSignal(false)
  let stage: HTMLDivElement | undefined
  let studio: HTMLDivElement | undefined
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let dirty = false

  const flush = () => {
    if (saveTimer !== undefined) {
      clearTimeout(saveTimer)
      saveTimer = undefined
    }
    if (!dirty) return
    dirty = false
    void repository.save(document()).then(() => {
      if (!dirty) setSaveState("saved")
    })
  }

  const schedule = () => {
    dirty = true
    setSaveState("saving")
    if (saveTimer !== undefined) clearTimeout(saveTimer)
    saveTimer = setTimeout(flush, saveDelayMs)
  }

  const load = () =>
    repository.load(props.id).then((stored) => {
      if (!stored) return
      setDocument(stored)
      setCheckpoint(stored)
    })

  onMount(() => {
    setHasLegacySketch(localStorage.getItem(legacySketchKey) !== null)
    void load().finally(() => setLoaded(true))
  })
  onCleanup(flush)

  const replaceDocument = (next: DesignDocumentV1) => {
    setHistory((state) => recordDesignHistory(state, document()))
    setDocument(next)
    schedule()
  }

  const dispatch = (command: DesignCommand) => {
    try {
      replaceDocument(applyCommand(document(), command))
      setError(undefined)
    } catch (thrown) {
      setError(thrown instanceof DesignDocumentError ? thrown.code : "command-failed")
    }
  }

  const undo = () => {
    const result = undoDesignHistory(history(), document())
    if (!result) return
    setHistory(result.state)
    setDocument(result.document)
    schedule()
  }

  const redo = () => {
    const result = redoDesignHistory(history(), document())
    if (!result) return
    setHistory(result.state)
    setDocument(result.document)
    schedule()
  }

  const chooseTool = (entry: DesignTool) => {
    setTool(entry)
    // v51: picking the comment tool opens its panel; leaving it drops the
    // pending target so a stale chip never survives a tool switch.
    if (entry === "comment") setCommentsOpen(true)
    else setCommentTarget(undefined)
  }

  const createFromDraft = (draft: DesignDraft) => {
    const node = draftToNode(draft, `node-${Math.random().toString(36).slice(2, 10)}`)
    if (!node) return
    dispatch({ kind: "insertNode", node, parentId: null })
    setSelection([node.id])
  }

  const importSketch = () => {
    const raw = localStorage.getItem(legacySketchKey)
    if (raw === null) {
      setError("no-legacy-sketch")
      return
    }
    try {
      const result = importLegacySketch(JSON.parse(raw), { id: props.id, name: "Canvas" })
      const merged = mergeDesignDocuments(document(), result.document)
      if (!merged) {
        setError("import-conflict")
        return
      }
      replaceDocument(merged)
      setError(undefined)
      setImportInfo(
        `Imported ${Object.keys(result.document.nodes).length}` +
          (result.skipped.length > 0 ? `, skipped ${result.skipped.length}` : "") +
          (result.approximated.length > 0 ? `, ${result.approximated.length} approximated` : ""),
      )
    } catch (thrown) {
      setError(thrown instanceof DesignDocumentError ? thrown.code : "import-failed")
    }
  }

  const refresh = () => {
    flush()
    void load()
  }

  const exportDocument = () => {
    const blob = new Blob([JSON.stringify(document(), null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const anchor = window.document.createElement("a")
    anchor.href = url
    anchor.download = `${document().name || "canvas"}.design.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const takeCheckpoint = () => {
    setCheckpoint(document())
    flush()
  }

  const revert = () => {
    if (document() === checkpoint()) return
    replaceDocument(checkpoint())
  }

  const zoomBy = (factor: number) => {
    const width = stage?.clientWidth ?? 0
    const height = stage?.clientHeight ?? 0
    setViewport((current) => zoomAt(current, factor, { x: width / 2, y: height / 2 }))
  }

  const present = () => {
    void studio?.requestFullscreen?.().catch(() => undefined)
  }

  const startResize = (event: PointerEvent) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = panelWidth()
    const move = (moveEvent: PointerEvent) => {
      const next = startWidth + moveEvent.clientX - startX
      setPanelWidth(Math.min(PANEL_WIDTH.max, Math.max(PANEL_WIDTH.min, next)))
    }
    const stop = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", stop)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", stop)
  }

  const typing = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null
    return !!target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  }

  const handleKey = (event: KeyboardEvent) => {
    if (typing(event)) return
    const mod = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()
    if (mod && key === "z") {
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
      return
    }
    if (mod && key === "y") {
      event.preventDefault()
      redo()
      return
    }
    const shortcut = !mod && !event.altKey ? DESIGN_TOOL_KEYS[key] : undefined
    if (shortcut) {
      chooseTool(shortcut)
      return
    }
    const ids = selection()
    if (ids.length === 0) return
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault()
      dispatch({ kind: "deleteNodes", ids })
      setSelection([])
      return
    }
    if (event.key === "Escape") {
      setSelection([])
      return
    }
    const step = event.shiftKey ? 10 : 1
    const deltas: Record<string, readonly [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const delta = deltas[event.key]
    if (!delta) return
    event.preventDefault()
    const moves = selectionMoves(document(), ids, { x: delta[0], y: delta[1] })
    if (moves.length > 0) dispatch({ kind: "translateNodes", moves })
  }

  const openComments = () => (document().comments ?? []).filter((comment) => comment.status === "open").length
  const panelShown = () => (narrow() ? drawerOpen() : panelOpen())

  const changeBar = (compact: boolean) => (
    <DesignStudioChangeBar
      saveState={saveState()}
      canUndo={history().past.length > 0}
      canRedo={history().future.length > 0}
      canRevert={document() !== checkpoint()}
      onUndo={undo}
      onRedo={redo}
      onRevert={revert}
      onCheckpoint={takeCheckpoint}
      compact={compact}
    />
  )
  const zoom = () => (
    <DesignStudioZoom
      zoom={viewport().zoom}
      onZoomOut={() => zoomBy(1 / ZOOM_STEP)}
      onZoomIn={() => zoomBy(ZOOM_STEP)}
      onReset={() => setViewport(initialViewport)}
    />
  )

  return (
    <div
      ref={studio}
      data-v110="design-studio"
      data-design-canvas-tab
      data-design-canvas-selection={selection().join(",")}
      data-design-studio-layout={narrow() ? "single" : "studio"}
      data-design-studio-panel-state={panelShown() ? "open" : "closed"}
      style={{ "--design-panel-width": `${panelWidth()}px` }}
      tabindex={0}
      onKeyDown={handleKey}
    >
      <Show when={loaded()}>
        <aside data-design-studio-panel data-drawer-open={narrow() && drawerOpen() ? "" : undefined}>
          <DesignStudioPanel
            document={document()}
            selection={selection()}
            onSelect={(id) => setSelection([id])}
            onCommand={dispatch}
            tool={tool()}
            onTool={chooseTool}
            view={view()}
            onView={setView}
            commentsOpen={commentsOpen()}
            commentCount={openComments()}
            onToggleComments={() => setCommentsOpen((value) => !value)}
            onRefresh={refresh}
            onExport={exportDocument}
            onCollapse={() => (narrow() ? setDrawerOpen(false) : setPanelOpen(false))}
            catalogs={props.catalogs ?? []}
            workshop={props.workshop}
          />
        </aside>
        <div data-design-studio-resizer aria-hidden="true" onPointerDown={startResize} />
        <div data-design-studio-canvas>
          <Show when={!narrow() && !panelOpen()}>
            <button
              type="button"
              data-design-studio-reopen
              title={t("design.studio.panel.reopen")}
              aria-label={t("design.studio.panel.reopen")}
              onClick={() => setPanelOpen(true)}
            >
              <StudioIcon name="expand" />
            </button>
          </Show>
          <DesignStudioDock
            tool={tool()}
            onTool={chooseTool}
            narrow={narrow()}
            importSlot={
              <Show when={hasLegacySketch()}>
                <button type="button" data-design-canvas-import-sketch onClick={importSketch}>
                  {t("design.studio.importSketch")}
                </button>
              </Show>
            }
          />
          <Show when={error() ?? importInfo()}>
            {(value) => (
              <span data-design-studio-notice data-design-canvas-error={error() ? "" : undefined} data-design-canvas-import-info={error() ? undefined : ""}>
                {value()}
              </span>
            )}
          </Show>
          <div ref={stage} data-design-studio-stage hidden={view() === "source"}>
            <DesignCanvas
              document={document()}
              selection={selection()}
              tool={tool()}
              viewport={viewport()}
              onViewport={setViewport}
              onSelect={(ids) => setSelection(ids)}
              onCommand={dispatch}
              onCreate={createFromDraft}
              onCommentTarget={setCommentTarget}
              onCommentFocus={(id) => {
                setCommentsOpen(true)
                setHighlightedComment(id)
              }}
            />
          </div>
          <Show when={view() === "source"}>
            <pre data-design-studio-source>{JSON.stringify(document(), null, 2)}</pre>
          </Show>
          <Show
            when={narrow()}
            fallback={
              <>
                <button type="button" data-design-studio-present title={t("design.studio.presentTitle")} onClick={present}>
                  ▣ <span>{t("design.studio.present")}</span>
                </button>
                {changeBar(false)}
                {zoom()}
              </>
            }
          >
            <div data-design-studio-bottombar role="toolbar" aria-label={t("design.studio.bottomBar")}>
              {zoom()}
              {changeBar(true)}
              <button type="button" data-design-studio-layers-toggle aria-expanded={drawerOpen()} onClick={() => setDrawerOpen((value) => !value)}>
                <span>☰</span>
                <span>{t("design.studio.layersButton")}</span>
              </button>
            </div>
          </Show>
        </div>
        <Show when={commentsOpen()}>
          <DesignCommentsPanel
            document={document()}
            target={commentTarget()}
            highlighted={highlightedComment()}
            onCommand={dispatch}
            onSelect={(ids) => setSelection(ids)}
            onClearTarget={() => setCommentTarget(undefined)}
            onClose={() => {
              setCommentsOpen(false)
              setCommentTarget(undefined)
              setHighlightedComment(undefined)
              if (tool() === "comment") setTool("select")
            }}
          />
        </Show>
        <Show when={narrow() && drawerOpen()}>
          <div data-design-studio-scrim aria-hidden="true" onClick={() => setDrawerOpen(false)} />
        </Show>
      </Show>
    </div>
  )
}
