/* SPDX-License-Identifier: MIT */

/**
 * ProjectDisclosure — one project's row + collapsible body inside the
 * "Projects" section of the context panel (sidebar-panel.tsx).
 *
 * Extracted so sidebar-panel.tsx can render N of these (one per
 * `layout.projects.list()` entry, matching the maquette's `.v68-project`
 * multi-project tree) instead of a single hardcoded project. The body is
 * unchanged from the pre-multi-project version: project name/path editor,
 * the "..." menu, and either the flat session list or the per-workspace
 * (branch) session lists, depending on `workspacesEnabled`.
 */
import { createMemo, For, Show, type Accessor } from "solid-js"
import { base64Encode } from "@unifia/util/encode"
import { getFilename } from "@unifia/util/path"
import { Button } from "@unifia/ui/button"
import { Collapsible } from "@unifia/ui/collapsible"
import { DropdownMenu } from "@unifia/ui/dropdown-menu"
import { IconButton } from "@unifia/ui/icon-button"
import { closestCenter, DragDropProvider, DragDropSensors, DragOverlay, SortableProvider } from "@thisbeyond/solid-dnd"
import type { LocalProject } from "@/context/layout"
import { useLayout } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { useNotification } from "@/context/notification"
import { ConstrainDragXAxis } from "@/utils/solid-dnd"
import { LocalWorkspace, SortableWorkspace, WorkspaceDragOverlay } from "./sidebar-workspace"
import type { SidebarPanelContext } from "./sidebar-panel"

// Maquette's `.v68-project-icon` shows a two-letter initial badge (e.g. "PE"
// for Prism EQ, "UF" for Unifia) rather than a rendered project icon.
const initials = (name: string) => {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return "?"
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

export function ProjectDisclosure(props: {
  project: LocalProject
  mobile?: boolean
  popover: Accessor<boolean>
  active: Accessor<boolean>
  ctx: SidebarPanelContext
}) {
  const layout = useLayout()
  const language = useLanguage()
  const notification = useNotification()
  const ctx = props.ctx

  const project = createMemo(() => props.project)
  const projectName = createMemo(() => project().name || getFilename(project().worktree))
  const projectId = createMemo(() => project().id ?? "")
  const worktree = createMemo(() => project().worktree)
  const slug = createMemo(() => base64Encode(worktree()))
  // Persisted per-project disclosure (`layout.projects.expand/collapse`,
  // pre-existing API) plus a floor: the active project stays visually open
  // regardless of its stored flag, so switching context never hides what
  // you're looking at.
  const open = createMemo(() => project().expanded || props.active())
  const setOpen = (value: boolean) => {
    if (value) layout.projects.expand(worktree())
    else layout.projects.collapse(worktree())
  }
  const workspaces = createMemo(() => ctx.workspaceIds(project()))
  const unseenCount = createMemo(() =>
    workspaces().reduce((total, directory) => total + notification.project.unseenCount(directory), 0),
  )
  const clearNotifications = () =>
    workspaces()
      .filter((directory) => notification.project.unseenCount(directory) > 0)
      .forEach((directory) => notification.project.markViewed(directory))
  const workspacesEnabled = createMemo(() => {
    const item = project()
    if (item.vcs !== "git") return false
    return layout.sidebar.workspaces(item.worktree)()
  })
  const canToggle = createMemo(() => project().vcs === "git" || layout.sidebar.workspaces(worktree())())
  const { InlineEditor } = ctx.workspaceSidebarCtx

  return (
    <div
      class="v68-project"
      classList={{ active: props.active(), open: open() }}
      data-v68-project={slug()}
      data-active={props.active() ? "" : undefined}
    >
      <Collapsible open={open()} onOpenChange={setOpen}>
        <div data-slot="project-row" class="v68-project-row group/project">
          <button
            type="button"
            class="v68-project-select"
            aria-current={props.active() ? "true" : undefined}
            onClick={() => setOpen(!open())}
          >
            <span class="v68-project-icon">{initials(projectName())}</span>
            <span class="v68-project-copy">
              <b>
                <InlineEditor
                  id={`project:${projectId()}`}
                  value={projectName}
                  onSave={(next) => ctx.renameProject(project(), next)}
                  class="truncate"
                  displayClass="truncate"
                  stopPropagation
                />
              </b>
              <small title={worktree()} class="select-text">
                {worktree()}
              </small>
            </span>
            <Show when={props.active()}>
              <span class="v68-active-pill">{language.t("sidebar.project.active")}</span>
            </Show>
          </button>

          <div class="v68-project-menu">
          <DropdownMenu modal={!ctx.sidebarHovering()}>
            <DropdownMenu.Trigger
              as={IconButton}
              icon="dot-grid"
              variant="ghost"
              data-action="project-menu"
              data-project={slug()}
              class="shrink-0 size-6 rounded-md"
              aria-label={language.t("common.moreOptions")}
            />
            <DropdownMenu.Portal>
              <DropdownMenu.Content class="mt-1">
                <DropdownMenu.Item onSelect={() => ctx.showEditProjectDialog(project())}>
                  <DropdownMenu.ItemLabel>{language.t("common.edit")}</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  data-action="project-workspaces-toggle"
                  data-project={slug()}
                  disabled={!canToggle()}
                  onSelect={() => ctx.toggleProjectWorkspaces(project())}
                >
                  <DropdownMenu.ItemLabel>
                    {workspacesEnabled() ? language.t("sidebar.workspaces.disable") : language.t("sidebar.workspaces.enable")}
                  </DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  data-action="project-clear-notifications"
                  data-project={slug()}
                  disabled={unseenCount() === 0}
                  onSelect={clearNotifications}
                >
                  <DropdownMenu.ItemLabel>{language.t("sidebar.project.clearNotifications")}</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
                <DropdownMenu.Separator />
                <DropdownMenu.Item data-action="project-close-menu" data-project={slug()} onSelect={() => ctx.closeProject(worktree())}>
                  <DropdownMenu.ItemLabel>{language.t("common.close")}</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu>
          </div>

          <Collapsible.Trigger class="v68-project-toggle" aria-label={projectName()}>
            <span class="v68-chevron" aria-hidden="true">
              ›
            </span>
          </Collapsible.Trigger>
        </div>

        <Collapsible.Content class="v68-disclosure-body">
          <div class="v68-project-body">
          <Show
            when={workspacesEnabled()}
            fallback={
              <LocalWorkspace ctx={ctx.workspaceSidebarCtx} project={project()} sortNow={ctx.sortNow} mobile={props.mobile} popover={props.popover()} />
            }
          >
            <div class="shrink-0 py-2">
              <Button size="normal" icon="plus-small" class="w-full" onClick={() => ctx.createWorkspace(project())}>
                {language.t("workspace.new")}
              </Button>
            </div>
            <div class="relative min-h-0">
              <DragDropProvider onDragStart={ctx.onWorkspaceDragStart} onDragEnd={ctx.onWorkspaceDragEnd} onDragOver={ctx.onWorkspaceDragOver} collisionDetector={closestCenter}>
                <DragDropSensors />
                <ConstrainDragXAxis />
                <div
                  ref={(el) => ctx.workspaceSidebarCtx.setScrollContainerRef(el, props.mobile)}
                  class="flex flex-col gap-4 py-2 [overflow-anchor:none]"
                >
                  <SortableProvider ids={workspaces()}>
                    <For each={workspaces()}>
                      {(directory) => (
                        <SortableWorkspace
                          ctx={ctx.workspaceSidebarCtx}
                          directory={directory}
                          project={project()}
                          sortNow={ctx.sortNow}
                          mobile={props.mobile}
                          popover={props.popover()}
                        />
                      )}
                    </For>
                  </SortableProvider>
                </div>
                <DragOverlay>
                  <WorkspaceDragOverlay sidebarProject={ctx.sidebarProject} activeWorkspace={ctx.activeWorkspace} workspaceLabel={ctx.workspaceLabel} />
                </DragOverlay>
              </DragDropProvider>
            </div>
          </Show>
          </div>
        </Collapsible.Content>
      </Collapsible>
    </div>
  )
}
