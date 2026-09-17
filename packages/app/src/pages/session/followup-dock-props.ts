/* SPDX-License-Identifier: MIT */

import type { Accessor } from "solid-js"
import type { FollowupDraft } from "@/components/prompt-input/submit"

/**
 * Vague 4 P1-5 (ADR-037) — small helper to build the SessionComposerRegion
 * `followup` dock props from the closure-driven accessors in session.tsx.
 *
 * Returns undefined when `params.id` is missing (the dock is only valid
 * inside an active session). Mirrors the inline ternary in session.tsx.
 */
export interface FollowupDockProps {
  queue: () => boolean
  items: { id: string; text: string }[]
  sending?: string
  edit?: { id: string; prompt: FollowupDraft["prompt"]; context: FollowupDraft["context"] }
  onQueue: (draft: FollowupDraft) => void
  onAbort: () => void
  onSend: (id: string) => void
  onEdit: (id: string) => void
  onEditLoaded: () => void
}

export function buildFollowupDockProps(deps: {
  paramsId: Accessor<string | undefined>
  queueEnabled: Accessor<boolean>
  followupDock: Accessor<FollowupDockProps["items"]>
  sendingFollowup: Accessor<string | undefined>
  editingFollowup: Accessor<FollowupDockProps["edit"]>
  queueFollowup: (draft: FollowupDraft) => void
  setFollowup: (state: "paused", id: string, value: boolean) => void
  sendFollowup: (sessionId: string, id: string, opts: { manual: boolean }) => void | Promise<void>
  editFollowup: (id: string) => void
  clearFollowupEdit: () => void
}): FollowupDockProps | undefined {
  const id = deps.paramsId()
  if (!id) return undefined
  return {
    queue: () => deps.queueEnabled(),
    items: deps.followupDock(),
    sending: deps.sendingFollowup(),
    edit: deps.editingFollowup(),
    onQueue: deps.queueFollowup,
    onAbort: () => {
      const sid = deps.paramsId()
      if (!sid) return
      deps.setFollowup("paused", sid, true)
    },
    onSend: (fid) => {
      void deps.sendFollowup(id, fid, { manual: true })
    },
    onEdit: deps.editFollowup,
    onEditLoaded: deps.clearFollowupEdit,
  }
}
