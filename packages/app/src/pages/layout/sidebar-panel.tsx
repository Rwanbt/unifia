/**
 * SidebarPanel — the per-project content panel shown in the sidebar.
 *
 * Extracted from layout.tsx to keep that file under the 1500-LOC governance
 * budget. The panel calls its own hooks internally (useLayout, useLanguage,
 * useNotification, useProviders, useGlobalSync, useParams) and receives the
 * remaining Layout-local state/functions through a SidebarPanelContext prop.
 */
import { createMemo, createSignal, For, Show, type Accessor } from "solid-js"
import { useParams } from "@solidjs/router"
import { getFilename } from "@unifia/util/path"
import { Button } from "@unifia/ui/button"
import { Collapsible } from "@unifia/ui/collapsible"
import { Icon } from "@unifia/ui/icon"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import type { LocalProject } from "@/context/layout"
import { useLayout } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { useMode } from "@/context/mode"
import { useProviders } from "@/hooks/use-providers"
import { ProjectDisclosure } from "./sidebar-panel-project"
import type { WorkspaceSidebarContext } from "./sidebar-workspace"

export type SidebarPanelContext = {
  /** Whether the sidebar is in hover-expanded (non-persistent-open) mode. */
  sidebarHovering: Accessor<boolean>
  /** Returns the child directories (workspaces) of a project in display order. */
  workspaceIds: (project: LocalProject) => string[]
  /** Persisted custom name for a workspace directory. */
  workspaceName: (directory: string, projectId?: string, branch?: string) => string | undefined
  /** Display label for a workspace (custom name → branch → folder name). */
  workspaceLabel: (directory: string, branch?: string, projectId?: string) => string
  /** Persist a new project name via the server. */
  renameProject: (project: LocalProject, next: string) => void
  /** Open the directory picker to add a project. */
  chooseProject: () => void
  /** Navigate to `href` and collapse the hover sidebar. */
  navigateWithSidebarReset: (href: string) => void
  /** Open the edit-project dialog for the given project. */
  showEditProjectDialog: (project: LocalProject) => void
  /** Toggle workspace-branches view for the given project. */
  toggleProjectWorkspaces: (project: LocalProject) => void
  /** Create a new workspace (git worktree) for the given project. */
  createWorkspace: (project: LocalProject) => void
  /** Open the connect-provider dialog. */
  connectProvider: () => void
  /** Close the project and navigate away if needed. */
  closeProject: (directory: string) => void
  /** The shared workspace sidebar context used by LocalWorkspace/SortableWorkspace. */
  workspaceSidebarCtx: WorkspaceSidebarContext
  /** Stable clock signal used for session sort-order (ticks every minute). */
  sortNow: () => number
  /** The project shown in the current hovered / opened sidebar panel. */
  sidebarProject: Accessor<LocalProject | undefined>
  /** Whether the "getting started" card has been dismissed. */
  gettingStartedDismissed: Accessor<boolean>
  /** Dismiss the "getting started" card. */
  setGettingStartedDismissed: (v: boolean) => void
  /** The active workspace being dragged (from Layout's store). */
  activeWorkspace: Accessor<string | undefined>
  onWorkspaceDragStart: (event: unknown) => void
  onWorkspaceDragEnd: () => void
  onWorkspaceDragOver: (event: DragEvent) => void
}

interface SidebarPanelProps {
  project: Accessor<LocalProject | undefined>
  mobile?: boolean
  merged?: boolean
  ctx: SidebarPanelContext
}

export function SidebarPanel(props: SidebarPanelProps) {
  const layout = useLayout()
  const language = useLanguage()
  const providers = useProviders()
  const params = useParams()
  const ctx = props.ctx

  const project = props.project
  const mode = useMode()
  const merged = createMemo(() => props.mobile || (props.merged ?? layout.sidebar.opened()))
  const hover = createMemo(() => !props.mobile && props.merged === false && !layout.sidebar.opened())
  const popover = createMemo(() => !!props.mobile || props.merged === false || layout.sidebar.opened())
  const projects = createMemo(() => layout.projects.list())
  const empty = createMemo(() => !params.dir && projects().length === 0)
  const panel = createMemo(() => Math.max(Math.max(layout.sidebar.width(), 244) - 64, 0))
  // Maquette's `.context-head`: a fixed "Navigation" title plus a
  // "{project} · {mode}" subtitle naming the current project and shell mode,
  // not just the project name the panel used to show alone.
  const currentProjectName = createMemo(() => {
    const item = project()
    if (!item) return ""
    return item.name || getFilename(item.worktree)
  })
  const modeLabel = createMemo(() => language.t(`workbench.modes.${mode.active()}`))
  const [projectsOpen, setProjectsOpen] = createSignal(true)

  return (
    <div
      data-v110="context-panel"
      data-mobile={props.mobile ? "true" : undefined}
      classList={{
        "flex flex-col min-h-0 min-w-0 box-border rounded-tl-[12px] px-3": true,
        "border border-b-0 border-border-weak-base": !merged(),
        "border-l border-t border-border-weaker-base": merged(),
        "bg-background-base": merged() || hover(),
        "bg-background-stronger": !merged() && !hover(),
        "flex-1 min-w-0": props.mobile,
        "max-w-full overflow-hidden": props.mobile,
      }}
      style={{
        width: props.mobile ? undefined : `${panel()}px`,
      }}
    >
      <div data-v110="context-head" class="shrink-0 px-2 pt-2 pb-1">
        <div class="text-12-medium text-text-strong">{language.t("sidebar.header.navigation")}</div>
        <Show when={currentProjectName()}>
          <div class="text-11-regular text-text-weak truncate">
            {language.t("sidebar.header.subtitle", { project: currentProjectName(), mode: modeLabel() })}
          </div>
        </Show>
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto no-scrollbar">
        <Show
          when={projects().length > 0}
          fallback={
            <Show when={empty()}>
              <div class="flex-1 min-h-0 -mt-4 flex items-center justify-center px-6 pb-64 text-center">
                <div class="mt-8 flex max-w-60 flex-col items-center gap-6 text-center">
                  <div class="flex flex-col gap-3">
                    <div class="text-14-medium text-text-strong">{language.t("sidebar.empty.title")}</div>
                    <div class="text-14-regular text-text-base" style={{ "line-height": "var(--line-height-normal)" }}>
                      {language.t("sidebar.empty.description")}
                    </div>
                  </div>
                  <Button size="large" icon="folder-add-left" onClick={ctx.chooseProject}>
                    {language.t("command.project.open")}
                  </Button>
                </div>
              </div>
            </Show>
          }
        >
          {/* Maquette's `.v68-section[data-v68-disclosure="global.projects"]`:
              one collapsible "Projects" section shared by every mode, listing
              every open project (layout.projects.list()) rather than just
              the one the current route happens to be in. */}
          <Collapsible open={projectsOpen()} onOpenChange={setProjectsOpen} class="shrink-0">
            <Collapsible.Trigger class="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left hover:bg-surface-raised-base-hover">
              <Icon name={projectsOpen() ? "chevron-down" : "chevron-right"} size="small" class="shrink-0 text-icon-base" />
              <span class="text-11-medium text-text-weaker uppercase tracking-wide">{language.t("sidebar.projects.title")}</span>
              <span class="ml-auto shrink-0 text-10-regular text-text-weaker">{projects().length}</span>
            </Collapsible.Trigger>
            <Collapsible.Content>
              <div class="flex flex-col pl-1 pt-1">
                <For each={projects()}>
                  {(item) => (
                    <ProjectDisclosure
                      project={item}
                      mobile={props.mobile}
                      popover={popover}
                      active={() => item.worktree === project()?.worktree}
                      ctx={ctx}
                    />
                  )}
                </For>
              </div>
            </Collapsible.Content>
          </Collapsible>
        </Show>
      </div>

      <div
        class="shrink-0 px-3 py-3"
        classList={{
          hidden: ctx.gettingStartedDismissed() || !(providers.all().length > 0 && providers.paid().length === 0),
        }}
      >
        <div class="rounded-xl bg-background-base shadow-xs-border-base" data-component="getting-started">
          <div class="p-3 flex flex-col gap-6">
            <div class="flex flex-col gap-2">
              <div class="text-14-medium text-text-strong">{language.t("sidebar.gettingStarted.title")}</div>
              <div class="text-14-regular text-text-base" style={{ "line-height": "var(--line-height-normal)" }}>
                {language.t("sidebar.gettingStarted.line1")}
              </div>
              <div class="text-14-regular text-text-base" style={{ "line-height": "var(--line-height-normal)" }}>
                {language.t("sidebar.gettingStarted.line2")}
              </div>
            </div>
            <div data-component="getting-started-actions">
              <Button size="large" icon="plus-small" onClick={ctx.connectProvider}>
                {language.t("command.provider.connect")}
              </Button>
              <Button size="large" variant="ghost" onClick={() => ctx.setGettingStartedDismissed(true)}>
                {language.t("toast.update.action.notYet")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
