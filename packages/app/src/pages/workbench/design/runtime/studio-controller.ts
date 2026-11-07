/* SPDX-License-Identifier: MIT */

import { createSignal, type Accessor } from "solid-js"
import type { Locale } from "@/context/language"
import { tStudioTools } from "@/i18n/design-studio-tools"
import type { DesignCommand } from "../model/commands"
import type { DesignDocumentV1, DesignNodeId } from "../model/schema"
import type { DesignPoint } from "./geometry"
import {
  deletableIds,
  designPages,
  duplicateIds,
  FORMAT_PRESETS,
  freehandPathNode,
  newPageFrame,
  shapeToPath,
  type FormatPresetId,
} from "./studio-actions"
import type { DesignToolPanelMode } from "./studio-tool-panel"
import type { DesignViewport } from "./viewport"

export type DesignStudioAction =
  | "format"
  | "capture"
  | "inspect"
  | "annotate"
  | "modify"
  | "vector"
  | "history"
  | "share"
  | "audit"

/**
 * The studio's action layer (ADR-085 amendment), built with explicit
 * dependencies (ADR-0001) so the canvas tab only wires signals. Every change
 * goes through `dispatch`: one gesture, one command, one history entry.
 */
export function createDesignStudioController(deps: {
  document: Accessor<DesignDocumentV1>
  selection: Accessor<readonly DesignNodeId[]>
  setSelection: (ids: readonly DesignNodeId[]) => void
  dispatch: (command: DesignCommand) => void
  locale: Accessor<Locale>
  newId: () => string
  /** Set once the renderer is ready; returns a PNG data URL. */
  capture: Accessor<(() => string) | undefined>
  setViewport: (viewport: DesignViewport) => void
  stageSize: () => { width: number; height: number }
  download: (href: string, filename: string) => void
}) {
  const [panel, setPanel] = createSignal<DesignToolPanelMode>()
  const [notice, setNotice] = createSignal<string>()
  let noticeTimer: ReturnType<typeof setTimeout> | undefined
  const say = (text: string) => {
    setNotice(text)
    if (noticeTimer) clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => setNotice(undefined), 3000)
  }
  const tr = (key: Parameters<typeof tStudioTools>[1], params?: Record<string, string | number>) => tStudioTools(deps.locale(), key, params)
  const togglePanel = (mode: DesignToolPanelMode) => setPanel((current) => (current === mode ? undefined : mode))

  /** Frames the page (or the whole drawing) so it fills the stage. */
  const focus = (rect: { x: number; y: number; width: number; height: number }) => {
    const { width, height } = deps.stageSize()
    if (width <= 0 || height <= 0 || rect.width <= 0 || rect.height <= 0) return
    const margin = 48
    const zoom = Math.min(4, Math.max(0.05, Math.min((width - margin * 2) / rect.width, (height - margin * 2) / rect.height)))
    deps.setViewport({ zoom, panX: (width - rect.width * zoom) / 2 - rect.x * zoom, panY: (height - rect.height * zoom) / 2 - rect.y * zoom })
  }

  const selectedPage = () => {
    const pages = designPages(deps.document())
    return pages.find((page) => deps.selection().includes(page.id))
  }

  const addPage = (preset: FormatPresetId = "desktop") => {
    const frame = newPageFrame(deps.document(), deps.newId(), preset)
    deps.dispatch({ kind: "insertNode", node: frame, parentId: null })
    deps.setSelection([frame.id])
    focus(frame.transform)
    say(tr("format.created", { name: frame.name }))
  }

  const applyFormat = (preset: FormatPresetId) => {
    const page = selectedPage()
    const size = FORMAT_PRESETS.find((entry) => entry.id === preset)
    if (!size) return
    if (!page) return addPage(preset)
    deps.dispatch({ kind: "updateTransform", id: page.id, transform: { ...page.transform, width: size.width, height: size.height } })
    focus({ ...page.transform, width: size.width, height: size.height })
    say(tr("format.applied", { name: tr(`format.${preset}`) }))
  }

  const capture = () => {
    const take = deps.capture()
    if (!take) return
    deps.download(take(), `${deps.document().name || "canvas"}.png`)
    say(tr("capture.done"))
  }

  const vector = () => {
    const ids = deps.selection()
    const node = ids.length === 1 ? deps.document().nodes[ids[0]!] : undefined
    const path = node ? shapeToPath(node) : undefined
    if (!path) return say(tr("vector.unsupported"))
    deps.dispatch({ kind: "replaceNode", node: path })
    say(tr("vector.done"))
  }

  const share = async () => {
    const document = deps.document()
    const json = JSON.stringify(document, null, 2)
    const filename = `${document.name || "canvas"}.design.json`
    try {
      const file = typeof File === "function" ? new File([json], filename, { type: "application/json" }) : undefined
      if (file && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: document.name })
        return say(tr("share.shared"))
      }
      await navigator.clipboard.writeText(json)
      say(tr("share.copied"))
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return
      say(tr("share.failed", { message: error instanceof Error ? error.message : String(error) }))
    }
  }

  const freehand = (points: readonly DesignPoint[], kind: "pencil" | "annotate") => {
    const node = freehandPathNode(points, deps.newId(), kind)
    if (!node) return
    deps.dispatch({ kind: "insertNode", node, parentId: null })
    if (kind === "pencil") deps.setSelection([node.id])
  }

  const renamePage = (id: DesignNodeId, name: string) => {
    if (name.trim()) deps.dispatch({ kind: "updateNode", id, name: name.trim() })
  }
  const duplicatePage = (id: DesignNodeId) => {
    const ids = duplicateIds(deps.document(), id, deps.newId)
    deps.dispatch({ kind: "duplicateNode", id, ids })
    const copy = ids[id]
    if (copy) deps.setSelection([copy])
  }
  const deletePage = (id: DesignNodeId) => {
    deps.dispatch({ kind: "deleteNode", id })
    deps.setSelection([])
  }
  /** Deletes the deletable part of the selection as one command; locked nodes stay selected. */
  const deleteSelection = () => {
    const ids = deletableIds(deps.document(), deps.selection())
    if (ids.length === 0) {
      if (deps.selection().length > 0) say(tr("delete.locked"))
      return
    }
    deps.dispatch({ kind: "deleteNodes", ids })
    deps.setSelection(deps.selection().filter((id) => deps.document().nodes[id] !== undefined))
  }
  const canDelete = () => deletableIds(deps.document(), deps.selection()).length > 0

  const showPage = (id: DesignNodeId | undefined) => {
    const document = deps.document()
    if (id) {
      const page = document.nodes[id]
      if (!page) return
      deps.setSelection([id])
      return focus(page.transform)
    }
    const nodes = document.rootIds.map((root) => document.nodes[root]).filter((node) => node !== undefined)
    if (nodes.length === 0) return deps.setViewport({ panX: 0, panY: 0, zoom: 1 })
    const left = Math.min(...nodes.map((node) => node.transform.x))
    const top = Math.min(...nodes.map((node) => node.transform.y))
    const right = Math.max(...nodes.map((node) => node.transform.x + node.transform.width))
    const bottom = Math.max(...nodes.map((node) => node.transform.y + node.transform.height))
    focus({ x: left, y: top, width: right - left, height: bottom - top })
  }

  const run = (action: DesignStudioAction) => {
    if (action === "capture") return capture()
    if (action === "vector") return vector()
    if (action === "share") return void share()
    if (action === "inspect" || action === "modify" || action === "history" || action === "audit") return togglePanel(action)
  }

  return {
    panel,
    closePanel: () => setPanel(undefined),
    notice,
    run,
    applyFormat,
    addPage,
    freehand,
    renamePage,
    duplicatePage,
    deletePage,
    deleteSelection,
    canDelete,
    showPage,
  }
}

export type DesignStudioController = ReturnType<typeof createDesignStudioController>
