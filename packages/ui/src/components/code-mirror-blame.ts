/* SPDX-License-Identifier: MIT */

// Git blame annotations for the editor (#96 slice 2, matrix row "Git blame
// annotations"). The owner supplies a per-line lookup — the SDK's git.blame
// route runs `git blame --porcelain` server-side; this module only renders:
// an inline annotation on the cursor's line and a hover tooltip with the
// commit details.

import { RangeSetBuilder } from "@codemirror/state"
import type { Extension } from "@codemirror/state"
import { Decoration, ViewPlugin, WidgetType, hoverTooltip } from "@codemirror/view"
import type { DecorationSet, EditorView, ViewUpdate } from "@codemirror/view"

/** One blame entry as returned by the server (1-indexed lines). */
export type BlameLine = { hash: string; author: string; timestamp: number; content: string }

/** Per-line lookup, 1-indexed to match the server contract. */
export type BlameLookup = (line: number) => BlameLine | undefined

export function shortBlameHash(hash: string): string {
  return hash.slice(0, 7)
}

/** Inline annotation text: author and short hash (dates live in the tooltip). */
export function formatBlameAnnotation(entry: BlameLine): string {
  return `${entry.author} · ${shortBlameHash(entry.hash)}`
}

/** Inline widget carrying the v110 blame contract. */
export class BlameWidget extends WidgetType {
  constructor(readonly text: string) {
    super()
  }

  eq(other: BlameWidget): boolean {
    return other.text === this.text
  }

  toDOM(): HTMLElement {
    const dom = document.createElement("span")
    dom.className = "cm-blame-inline"
    dom.setAttribute("data-component", "blame-annotation")
    dom.textContent = this.text
    return dom
  }

  ignoreEvent(): boolean {
    return true
  }
}

function cursorLineDecorations(view: EditorView, lookup: () => BlameLookup | undefined): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const selection = view.state.selection.main
  // Only annotate a single cursor: a selection has no single "current" line.
  if (!selection.empty) return builder.finish()
  const line = view.state.doc.lineAt(selection.head)
  const entry = lookup()?.(line.number)
  if (!entry) return builder.finish()
  builder.add(line.to, line.to, Decoration.widget({ widget: new BlameWidget(formatBlameAnnotation(entry)), side: 1 }))
  return builder.finish()
}

/**
 * Blame extensions: an inline annotation on the cursor's line plus a hover
 * tooltip over any annotated line (author, absolute date, short hash, and
 * the committed line content).
 */
export function buildBlameExtensions(lookup: () => BlameLookup | undefined): Extension[] {
  const inline = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = cursorLineDecorations(view, lookup)
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = cursorLineDecorations(update.view, lookup)
        }
      }
    },
    { decorations: (value) => value.decorations },
  )

  const tooltip = hoverTooltip(
    (view, pos) => {
      const line = view.state.doc.lineAt(pos)
      const entry = lookup()?.(line.number)
      if (!entry) return null
      return {
        pos: line.from,
        end: line.to,
        above: true,
        create: () => {
          const dom = document.createElement("div")
          dom.className = "cm-blame-tooltip"
          dom.setAttribute("data-component", "blame-tooltip")
          const head = document.createElement("div")
          head.className = "cm-blame-tooltip-head"
          head.textContent = `${entry.author} · ${shortBlameHash(entry.hash)} · ${new Date(entry.timestamp * 1000).toLocaleString()}`
          const body = document.createElement("pre")
          body.textContent = entry.content
          dom.append(head, body)
          return { dom }
        },
      }
    },
    { hideOnChange: true, hoverTime: 300 },
  )

  return [inline, tooltip]
}
