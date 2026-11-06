/* SPDX-License-Identifier: MIT */

import type { DesignComment } from "@unifia/workbench-shell"
import type { Prompt } from "@/context/prompt"

/**
 * Design comments → shared chat composer.
 *
 * Design mounts under SessionRoute, so the one shared composer is the place
 * a user writes to the agent. A comment is attached as plain text appended to
 * the draft rather than as a file context item: an artifact's filename is not
 * a project path, and a file part pointing at a missing file would fail the
 * whole send.
 */
export function formatCommentForComposer(comment: Pick<DesignComment, "elementId" | "note">, entryFile: string): string {
  return `[Design · ${entryFile} · #${comment.elementId}] ${comment.note.trim()}`
}

export function appendToPrompt(prompt: Prompt, text: string): Prompt {
  const last = prompt[prompt.length - 1]
  if (last?.type === "text") {
    const separator = last.content.trim() ? "\n" : ""
    const content = `${last.content.trimEnd()}${separator}${text}`
    return [...prompt.slice(0, -1), { ...last, content, end: last.start + content.length }]
  }
  const start = last && "end" in last ? last.end : 0
  return [...prompt, { type: "text", content: text, start, end: start + text.length }]
}
