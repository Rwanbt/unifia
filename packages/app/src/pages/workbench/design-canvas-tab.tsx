/* SPDX-License-Identifier: MIT */

import { createSignal, onCleanup, onMount, Show, type JSX } from "solid-js"
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
import type { DesignDocumentV1, DesignNodeId } from "./design/model/schema"
import { createLocalStorageDesignDocumentRepository } from "./design/persistence/local-storage-repository"
import { DesignCanvas } from "./design/runtime/design-canvas"

const saveDelayMs = 400

/**
 * Native design document tab (ADR-039): canonical document in, typed
 * commands out, one history entry per committed command, persisted through
 * the repository contract. The legacy sketch tab stays available until the
 * migration slice retires it.
 */
export function DesignCanvasTab(props: { id: string }): JSX.Element {
  const repository = createLocalStorageDesignDocumentRepository()
  const [document, setDocument] = createSignal<DesignDocumentV1>(createDesignDocument(props.id, "Canvas"))
  const [selection, setSelection] = createSignal<readonly DesignNodeId[]>([])
  const [history, setHistory] = createSignal<DesignHistoryState>(emptyDesignHistory)
  const [error, setError] = createSignal<string>()
  const [loaded, setLoaded] = createSignal(false)
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let dirty = false

  const flush = () => {
    if (saveTimer !== undefined) {
      clearTimeout(saveTimer)
      saveTimer = undefined
    }
    if (!dirty) return
    dirty = false
    void repository.save(document())
  }

  const schedule = () => {
    dirty = true
    if (saveTimer !== undefined) clearTimeout(saveTimer)
    saveTimer = setTimeout(flush, saveDelayMs)
  }

  onMount(() => {
    void repository
      .load(props.id)
      .then((stored) => {
        if (stored) setDocument(stored)
      })
      .finally(() => setLoaded(true))
  })
  onCleanup(flush)

  const dispatch = (command: DesignCommand) => {
    try {
      const current = document()
      const next = applyCommand(current, command)
      setHistory((state) => recordDesignHistory(state, current))
      setDocument(next)
      setError(undefined)
      schedule()
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

  const select = (id: DesignNodeId | undefined) => setSelection(id === undefined ? [] : [id])

  const addRectangle = () =>
    dispatch({
      kind: "insertNode",
      parentId: null,
      node: {
        id: `node-${Math.random().toString(36).slice(2, 10)}`,
        name: "Rectangle",
        parentId: null,
        visible: true,
        locked: false,
        type: "rectangle",
        transform: { x: 40, y: 40, width: 160, height: 100, rotation: 0 },
      },
    })

  const handleKey = (event: KeyboardEvent) => {
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
    const id = selection()[0]
    if (!id) return
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault()
      dispatch({ kind: "deleteNode", id })
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
    const node = document().nodes[id]
    if (!node) return
    event.preventDefault()
    dispatch({
      kind: "updateTransform",
      id,
      transform: { ...node.transform, x: node.transform.x + delta[0], y: node.transform.y + delta[1] },
    })
  }

  return (
    <div class="flex size-full min-h-0 flex-col" tabindex={0} onKeyDown={handleKey} data-design-canvas-tab>
      <div class="flex items-center gap-2 border-b border-border-base px-2 py-1">
        <button
          type="button"
          class="rounded border border-border-base px-2 py-1 text-12-regular"
          data-design-canvas-add-rectangle
          onClick={addRectangle}
        >
          Rectangle
        </button>
        <button
          type="button"
          class="rounded border border-border-base px-2 py-1 text-12-regular disabled:opacity-40"
          data-design-canvas-undo
          disabled={history().past.length === 0}
          onClick={undo}
        >
          Undo
        </button>
        <button
          type="button"
          class="rounded border border-border-base px-2 py-1 text-12-regular disabled:opacity-40"
          data-design-canvas-redo
          disabled={history().future.length === 0}
          onClick={redo}
        >
          Redo
        </button>
        <Show when={error()}>
          {(value) => (
            <span class="text-12-regular text-text-weak" data-design-canvas-error>
              {value()}
            </span>
          )}
        </Show>
      </div>
      <div class="relative min-h-0 flex-1">
        <Show when={loaded()}>
          <DesignCanvas document={document()} selection={selection()} onSelect={select} onCommand={dispatch} />
        </Show>
      </div>
    </div>
  )
}
