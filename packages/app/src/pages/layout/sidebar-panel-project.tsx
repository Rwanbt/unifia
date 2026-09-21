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
import { Icon } from "@unifia/ui/icon"
import { IconButton } from "@unifia/ui/icon-button"
import { Tooltip } from "@unifia/ui/tooltip"
import { closestCenter, DragDropProvider, DragDropSensors, DragOverlay, SortableProvider } from "@thisbeyond/solid-dnd"
import type { LocalProject } from "@/context/layout"
import { useLayout } from "@/context/layout"
import { useGlobalSync } from "@/context/global-sync"
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
  const globalSync = useGlobalSync()
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
  const homedir = createMemo(() => globalSync.data.path.home)
  const { InlineEditor } = ctx.workspaceSidebarCtx

  return (
    <div class="v68-project" data-v68-project={slug()}>
      <Collapsible open={open()} onOpenChange={setOpen} class="shrink-0">
        <div class="group/project flex items-center gap-2 py-1.5 pl-1 pr-0">
          <Collapsible.Trigger class="flex min-w-0 flex-1 items-center gap-2 rounded-md py-0.5 text-left hover:bg-surface-raised-base-hover">
            <Icon name={open() ? "chevron-down" : "chevron-right"} size="small" class="shrink-0 text-icon-base" />
            <div class="flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-raised-base text-10-medium text-text-weak">
              {initials(projectName())}
            </div>
            <div class="flex min-w-0 flex-1 flex-col">
              <InlineEditor
                id={`project:${projectId()}`}
                value={projectName}
                onSave={(next) => ctx.renameProject(project(), next)}
                class="text-13-medium text-text-strong truncate"
                displayClass="text-13-medium text-text-strong truncate"
                stopPropagation
              />
              <Tooltip
                placement="bottom"
                gutter={2}
                value={worktree()}
                class="shrink-0"
                contentStyle={{ "max-width": "640px", transform: "translate3d(52px, 0, 0)" }}
              >
                <span class="text-11-regular text-text-weak truncate select-text">
                  {worktree().replace(homedir(), "~")}
                </span>
              </Tooltip>
            </div>
          </Collapsible.Trigger>
          <Show when={props.active()}>
            <span class="shrink-0 rounded-full bg-surface-raised-base-active px-2 py-0.5 text-9-medium text-text-strong">
              {language.t("sidebar.project.active")}
            </span>
          </Show>

          <DropdownMenu modal={!ctx.sidebarHovering()}>
            <DropdownMenu.Trigger
              as={IconButton}
              icon="dot-grid"
              variant="ghost"
              data-action="project-menu"
              data-project={slug()}
              class="shrink-0 size-6 rounded-md opacity-0 transition-opacity group-hover/project:opacity-100 group-focus-within/project:opacity-100 data-[expanded]:opacity-100"
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

        <Collapsible.Content>
          <Show
            when={workspacesEnabled()}
            fallback={
              <>
                <div class="shrink-0 py-2 pl-7">
                  <Button
                    size="normal"
                    icon="new-session"
                    class="w-full"
                    onClick={() => ctx.navigateWithSidebarReset(`/${slug()}/session`)}
                  >
                    {language.t("command.session.new")}
                  </Button>
                </div>
                <div class="min-h-0 pl-7">
                  <LocalWorkspace ctx={ctx.workspaceSidebarCtx} project={project()} sortNow={ctx.sortNow} mobile={props.mobile} popover={props.popover()} />
                </div>
              </>
            }
          >
            <div class="shrink-0 py-2 pl-7">
              <Button size="normal" icon="plus-small" class="w-full" onClick={() => ctx.createWorkspace(project())}>
                {language.t("workspace.new")}
              </Button>
            </div>
            <div class="relative min-h-0 pl-7">
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
        </Collapsible.Content>
      </Collapsible>
    </div>
  )
}
