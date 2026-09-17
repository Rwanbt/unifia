/* SPDX-License-Identifier: MIT */

import { describe, expect, mock, test } from "bun:test"
import type { Accessor } from "solid-js"
import type { Session } from "../../types/sdk-shim"
import { createWorkspaceSidebarContext, type WorkspaceSidebarDeps } from "./layout-contexts"

// Regression: 886b5a0d6b (Vague 5 extraction) replaced the workspace
// Reset/Delete dialog triggers with `dialog.show(() => null)` stubs and
// silently dropped the real deps passed by layout.tsx. The menu items
// then opened an empty dialog stack (overlay only, no content). See #91.
function deps(input: Partial<WorkspaceSidebarDeps> = {}): WorkspaceSidebarDeps {
  const sessions = [] as Session[]
  return {
    currentDir: (() => "") as Accessor<string>,
    currentSessions: (() => sessions) as Accessor<Session[]>,
    sidebarExpanded: (() => true) as Accessor<boolean>,
    sidebarHovering: (() => false) as Accessor<boolean>,
    nav: (() => undefined) as WorkspaceSidebarDeps["nav"],
    hoverSession: (() => undefined) as Accessor<string | undefined>,
    setHoverSession: () => {},
    clearHoverProjectSoon: () => {},
    prefetchSession: () => {},
    archiveSession: () => Promise.resolve(),
    workspaceName: () => undefined,
    renameWorkspace: () => {},
    editorOpen: () => false,
    openEditor: () => {},
    closeEditor: () => {},
    setEditor: () => {},
    InlineEditor: (() => null) as unknown as WorkspaceSidebarDeps["InlineEditor"],
    isBusy: () => false,
    showResetWorkspaceDialog: () => {},
    showDeleteWorkspaceDialog: () => {},
    setScrollContainerRef: () => {},
    store: { workspaceExpanded: {} },
    setStore: () => {},
    ...input,
  }
}

describe("createWorkspaceSidebarContext", () => {
  test("forwards the real reset/delete dialog triggers", () => {
    const reset = mock(() => {})
    const remove = mock(() => {})
    const ctx = createWorkspaceSidebarContext(
      deps({ showResetWorkspaceDialog: reset, showDeleteWorkspaceDialog: remove }),
    )

    ctx.showResetWorkspaceDialog("/root", "/root/worktree")
    ctx.showDeleteWorkspaceDialog("/root", "/root/worktree")

    expect(reset).toHaveBeenCalledTimes(1)
    expect(reset).toHaveBeenCalledWith("/root", "/root/worktree")
    expect(remove).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith("/root", "/root/worktree")
  })

  test("resolves expanded state from the store with the local fallback", () => {
    const stored = { "/root/worktree": false }
    const ctx = createWorkspaceSidebarContext(deps({ store: { workspaceExpanded: stored } }))

    expect(ctx.workspaceExpanded("/root/worktree", true)).toBe(false)
    expect(ctx.workspaceExpanded("/root/other", true)).toBe(true)
    expect(ctx.workspaceExpanded("/root/other", false)).toBe(false)
  })
})
