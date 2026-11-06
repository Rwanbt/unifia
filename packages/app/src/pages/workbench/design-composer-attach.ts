/* SPDX-License-Identifier: MIT */

import { createSignal } from "solid-js"
import type { DesignComment } from "@unifia/workbench-shell"
import { usePrompt } from "@/context/prompt"
import { appendToPrompt, formatCommentForComposer } from "@/pages/workbench/design-composer-format"

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
