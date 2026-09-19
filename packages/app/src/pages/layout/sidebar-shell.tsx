import { createEffect, createMemo, For, Show, type Accessor, type JSX } from "solid-js"
import {
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  SortableProvider,
  closestCenter,
  type DragEvent,
} from "@thisbeyond/solid-dnd"
import { ConstrainDragXAxis } from "@/utils/solid-dnd"
import { IconButton } from "@unifia/ui/icon-button"
import { Tooltip, TooltipKeybind } from "@unifia/ui/tooltip"
import type { LocalProject } from "@/context/layout"
import type { ShellMode } from "@unifia/workbench-shell/modes"
import { ensureModeLoaded } from "@/pages/workbench-mode-loader"

export const SidebarContent = (props: {
  mobile?: boolean
  opened: Accessor<boolean>
  aimMove: (event: MouseEvent) => void
  projects: Accessor<LocalProject[]>
  renderProject: (project: LocalProject) => JSX.Element
  handleDragStart: (event: unknown) => void
  handleDragEnd: () => void
  handleDragOver: (event: DragEvent) => void
  openProjectLabel: JSX.Element
  openProjectKeybind: Accessor<string | undefined>
  onOpenProject: () => void
  renderProjectOverlay: () => JSX.Element
  settingsLabel: Accessor<string>
  settingsKeybind: Accessor<string | undefined>
  onOpenSettings: () => void
  accountLabel: Accessor<string>
  helpLabel: Accessor<string>
  onOpenHelp: () => void
  renderPanel: () => JSX.Element
  modes: Accessor<readonly ShellMode[]>
  activeMode: Accessor<ShellMode>
  onMode: (mode: ShellMode) => void
  modesLabel: string
  modeLabel: (mode: ShellMode) => string
}): JSX.Element => {
  const expanded = createMemo(() => !!props.mobile || props.opened())
  const placement = () => (props.mobile ? "bottom" : "right")
  let panel: HTMLDivElement | undefined

  createEffect(() => {
    const el = panel
    if (!el) return
    if (expanded()) {
      el.removeAttribute("inert")
      return
    }
    el.setAttribute("inert", "")
  })

  return (
    <div class="flex h-full w-full min-w-0 overflow-hidden">
      <div
        data-component="sidebar-rail"
        data-v110="rail"
        data-parity={props.mobile ? undefined : "shell.rail"}
        class="shrink-0 bg-background-base flex flex-col items-center overflow-hidden"
        style={{ width: "var(--v110-rail, 78px)" }}
        onMouseMove={props.aimMove}
      >
        <div class="flex-1 min-h-0 w-full">
          <DragDropProvider
            onDragStart={props.handleDragStart}
            onDragEnd={props.handleDragEnd}
            onDragOver={props.handleDragOver}
            collisionDetector={closestCenter}
          >
            <DragDropSensors />
            <ConstrainDragXAxis />
            <div class="h-full w-full flex flex-col items-center gap-3 px-3 py-3 overflow-y-auto no-scrollbar">
              {/* .rail-btn + .rail-btn gap measured live at 8px
                  (y=127 - y=77 - 42px height =
                  Unifia-UI-UX-v110-PORT-READY-R1.html:15327-15346); was
                  gap-3 (12px). */}
              <nav aria-label={props.modesLabel} class="flex flex-col items-center gap-2">
                <For each={props.modes()}>
                  {(mode) => (
                    <Tooltip placement={placement()} value={props.modeLabel(mode)}>
                      <IconButton
                        icon={mode === "code" ? "code" : mode === "work" ? "folder" : mode === "design" ? "edit" : "checklist"}
                        variant="ghost"
                        size="large"
                        // .rail-btn is 42x42 with a 12px radius
                        // (Unifia-UI-UX-v110-PORT-READY-R1.html:15326-15346,
                        // measured live: w=42 h=42 border-radius=12px). The
                        // shared IconButton size="large" token is 32px --
                        // fixed there for every OTHER "large" icon button in
                        // the app (settings, dialogs), so overridden here
                        // only, not in icon-button.css, to keep this rail-only.
                        //
                        // variant="primary" (the previous choice for the
                        // active mode) is icon-button.css's inverted/CTA
                        // treatment -- measured live at bg=rgb(237,232,228),
                        // a bright warm off-white, jarring against a dark
                        // rail and nothing like the maquette's active state
                        // (bg #2c2c2f-ish, still dark, just a subtle raise --
                        // Unifia-UI-UX-v110-PORT-READY-R1.html:15327,
                        // .rail-btn.active). Always "ghost" now; the active
                        // look is the classList below instead, matching the
                        // maquette's actual measured contrast: active text
                        // rgb(242,242,243) vs inactive rgb(155,155,161) --
                        // the app previously rendered every mode icon at
                        // pure white regardless of state, so inactive icons
                        // never dimmed the way the maquette's do.
                        //
                        // The icon's own color comes from icon-button.css's
                        // [data-slot="icon-svg"] { color: var(--icon-base) }
                        // (line 83), not from the button's own `color` --
                        // a plain text-* class on the button has no visible
                        // effect on the glyph, only the descendant-targeted
                        // [&_[data-slot=icon-svg]]:text-* variant does.
                        class="!w-[42px] !h-[42px] !rounded-[12px]"
                        classList={{
                          "!bg-surface-raised-base [&_[data-slot=icon-svg]]:!text-text-strong":
                            props.activeMode() === mode,
                          "[&_[data-slot=icon-svg]]:!text-text-weak": props.activeMode() !== mode,
                        }}
                        // Contrat technique de sélection pour les tests, stable
                        // quelle que soit la locale. L'`aria-label` ci-dessous
                        // vient de `modeLabel`, donc il est traduit : la suite
                        // e2e tourne en anglais et rend "work mode" là où
                        // l'application en français rend "Mode Travail".
                        // Accessibilité et contrat de test sont deux
                        // responsabilités distinctes, on garde les deux.
                        data-mode={mode}
                        onClick={() => props.onMode(mode)}
                        onMouseEnter={() => { if (mode !== "code") void ensureModeLoaded(mode) }}
                        onFocus={() => { if (mode !== "code") void ensureModeLoaded(mode) }}
                        aria-label={props.modeLabel(mode)}
                        aria-pressed={props.activeMode() === mode}
                      />
                    </Tooltip>
                  )}
                </For>
              </nav>
              <SortableProvider ids={props.projects().map((p) => p.worktree)}>
                <For each={props.projects()}>{(project) => props.renderProject(project)}</For>
              </SortableProvider>
              <Tooltip
                placement={placement()}
                value={
                  <div class="flex items-center gap-2">
                    <span>{props.openProjectLabel}</span>
                    <Show when={!props.mobile && !!props.openProjectKeybind()}>
                      <span class="text-icon-base text-12-medium">{props.openProjectKeybind()}</span>
                    </Show>
                  </div>
                }
              >
                <IconButton
                  icon="plus"
                  variant="ghost"
                  size="large"
                  class="!w-[42px] !h-[42px] !rounded-[12px]"
                  onClick={props.onOpenProject}
                  aria-label={typeof props.openProjectLabel === "string" ? props.openProjectLabel : undefined}
                />
              </Tooltip>
            </div>
            <DragOverlay>{props.renderProjectOverlay()}</DragOverlay>
          </DragDropProvider>
        </div>
        <div class="shrink-0 w-full pt-3 pb-6 flex flex-col items-center gap-2">
          {/* Ports .rail-avatar-wrap > #userBtn (Unifia-UI-UX-v110-PORT-READY-R1.html:15349).
              The static .avatar CSS rule (lines 136-139) reads 28px, but a
              live getBoundingClientRect() on the rendered #userBtn measured
              32x32 -- trusted the live measurement over the static rule,
              since #userBtn evidently carries more specific sizing this
              class-only read missed the first time.
              The maquette's avatar shows a demo initial and opens an account/
              session manager -- neither exists anywhere in this app (no user
              identity, no accounts, grepped the whole tree). Rather than
              fabricate one, this draws a generic person glyph (the shared
              icon set has none, same reason titlebar.tsx hand-draws its own
              sun/moon icons) and opens Settings, the nearest real destination
              -- honest about being an entry point, not a pretend account
              switcher. */}
          <Tooltip placement={placement()} value={props.accountLabel()}>
            <button
              type="button"
              class="size-8 shrink-0 rounded-full border border-border-strong-base bg-surface-raised-base grid place-items-center text-icon-weak hover:text-icon-strong hover:bg-surface-raised-base-active transition-colors"
              onClick={props.onOpenSettings}
              aria-label={props.accountLabel()}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="1.8" />
                <path
                  d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                />
              </svg>
            </button>
          </Tooltip>
          <TooltipKeybind placement={placement()} title={props.settingsLabel()} keybind={props.settingsKeybind() ?? ""}>
            <IconButton
              icon="settings-gear"
              variant="ghost"
              size="large"
              class="!w-[42px] !h-[42px] !rounded-[12px]"
              onClick={props.onOpenSettings}
              aria-label={props.settingsLabel()}
            />
          </TooltipKeybind>
          {/* Desktop-only removal: the maquette's rail (lines 15326-15350) has
              no help/support icon at all -- Nouveau, avatar, Réglages, done.
              Kept on mobile, which has no maquette reference in this pass and
              where removing a support entry point has no visual-parity
              upside. */}
          <Show when={props.mobile}>
            <Tooltip placement={placement()} value={props.helpLabel()}>
              <IconButton
                icon="help"
                variant="ghost"
                size="large"
                onClick={props.onOpenHelp}
                aria-label={props.helpLabel()}
              />
            </Tooltip>
          </Show>
        </div>
      </div>

      <div
        ref={(el) => {
          panel = el
        }}
        classList={{ "flex-1 flex h-full min-h-0 min-w-0 overflow-hidden": true, "pointer-events-none": !expanded() }}
        aria-hidden={!expanded()}
      >
        {props.renderPanel()}
      </div>
    </div>
  )
}
