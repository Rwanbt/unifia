/* SPDX-License-Identifier: MIT */

import { createSignal } from "solid-js"
import type { DesignComment } from "@unifia/workbench-shell"
import { usePrompt, type Prompt } from "@/context/prompt"

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

export function createDesignComposerAttach() {
  let prompt: ReturnType<typeof usePrompt> | undefined
  try {
    prompt = usePrompt()
  } catch {
    // Rendered outside a session (isolated tests): the action is hidden.
    prompt = undefined
  }
  const [attached, setAttached] = createSignal<ReadonlySet<string>>(new Set())
  const attach = (comment: DesignComment, entryFile: string) => {
    if (!prompt) return
    const next = appendToPrompt(prompt.current(), formatCommentForComposer(comment, entryFile))
    const tail = next[next.length - 1]
    prompt.set(next, tail && "end" in tail ? tail.end : undefined)
    setAttached((current) => new Set([...current, comment.id]))
  }
  return { available: !!prompt, attach, attached }
}
