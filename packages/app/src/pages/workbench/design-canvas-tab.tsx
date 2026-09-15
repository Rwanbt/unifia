/* SPDX-License-Identifier: MIT */

import { createSignal, onCleanup, onMount, Show, type JSX } from "solid-js"
import type { DesignCommand } from "./design/model/commands"
import { createDesignDocument } from "./design/model/document"
import { DesignDocumentError } from "./design/model/errors"
import { applyCommand } from "./design/model/reducer"
import type { DesignDocumentV1, DesignNodeId } from "./design/model/schema"
import { createLocalStorageDesignDocumentRepository } from "./design/persistence/local-storage-repository"
import { DesignCanvas } from "./design/runtime/design-canvas"

const saveDelayMs = 400

/**
 * Native design document tab (ADR-039): canonical document in, typed
 * commands out, persisted through the repository contract. The legacy
 * sketch tab stays available until the migration slice retires it.
 */
export function DesignCanvasTab(props: { id: string }): JSX.Element {
  const repository = createLocalStorageDesignDocumentRepository()
  const [document, setDocument] = createSignal<DesignDocumentV1>(createDesignDocument(props.id, "Canvas"))
  const [selection, setSelection] = createSignal<readonly DesignNodeId[]>([])
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
      setDocument((current) => applyCommand(current, command))
      setError(undefined)
      schedule()
    } catch (thrown) {
      setError(thrown instanceof DesignDocumentError ? thrown.code : "command-failed")
    }
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

  return (
    <div class="flex size-full min-h-0 flex-col" data-design-canvas-tab>
      <div class="flex items-center gap-2 border-b border-border-base px-2 py-1">
        <button
          type="button"
          class="rounded border border-border-base px-2 py-1 text-12-regular"
          data-design-canvas-add-rectangle
          onClick={addRectangle}
        >
          Rectangle
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
