/* SPDX-License-Identifier: MIT */

import { createEffect, on, onCleanup, type Accessor } from "solid-js"

export interface BackHistory {
  push(): void
  pop(): void
}

/**
 * The history bookkeeping behind a modal's Back handling, free of Solid so it
 * can be tested for what it decides.
 *
 * Opening pushes one entry; a Back gesture pops it (popstate) and closes the
 * modal without a router step; closing from the modal's own controls pops the
 * entry we pushed. `pushed` tracks whether our entry is still on the stack, so
 * history never accumulates and a pop is never issued twice.
 */
export class ModalBackGuard {
  private pushed = false
  private pending = 0

  constructor(private readonly history: BackHistory) {}

  opened(): void {
    if (this.pushed) return
    this.history.push()
    this.pushed = true
  }

  closed(): void {
    if (!this.pushed) return
    this.pushed = false
    this.pending += 1
    this.history.pop()
  }

  /**
   * Consumes the popstate caused by our own history.back(). That event is
   * asynchronous: a close followed by a fast reopen receives it after the new
   * entry was pushed, and it must not be mistaken for a Back gesture on the
   * new dialog.
   */
  pendingPop(): boolean {
    if (this.pending === 0) return false
    this.pending -= 1
    return true
  }

  /** A Back gesture already removed our entry. Returns true when it was ours. */
  popped(): boolean {
    if (!this.pushed) return false
    this.pushed = false
    return true
  }
}

/**
 * Makes the system Back gesture close a modal instead of leaving the screen.
 * Without this, Android Back walks the router history and leaves Work for the
 * previous mode while the dialog is still on screen.
 */
export function closeModalOnBack(open: Accessor<boolean>, close: () => void): void {
  const guard = new ModalBackGuard({
    push: () => window.history.pushState({ ...(window.history.state ?? {}), unifiaModal: true }, ""),
    pop: () => window.history.back(),
  })

  const onPopState = () => {
    if (guard.pendingPop()) return
    if (!open() || !guard.popped()) return
    close()
  }

  window.addEventListener("popstate", onPopState)
  onCleanup(() => window.removeEventListener("popstate", onPopState))

  createEffect(
    on(
      open,
      (isOpen) => {
        if (isOpen) guard.opened()
        else guard.closed()
      },
      { defer: true },
    ),
  )
}
