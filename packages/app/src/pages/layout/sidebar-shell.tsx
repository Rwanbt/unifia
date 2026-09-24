import { createEffect, createMemo, For, Show, type Accessor, type JSX } from "solid-js"
import { IconButton } from "@unifia/ui/icon-button"
import { Tooltip, TooltipKeybind } from "@unifia/ui/tooltip"
import type { ShellMode } from "@unifia/workbench-shell/modes"
import type { WorkspaceDestination } from "@/context/mode-directory"
import { ensureModeLoaded } from "@/pages/workbench-mode-loader"
import { useLanguage } from "@/context/language"
import { modeIcon, PILL_DESTINATIONS } from "@/shell/v110-destinations"

export const SidebarContent = (props: {
  mobile?: boolean
  opened: Accessor<boolean>
  railOpened: Accessor<boolean>
  railPeeked: Accessor<boolean>
  sidebarPeeked: Accessor<boolean>
  onRailPanelEnter: () => void
  onRailPanelLeave: () => void
  onSidebarPanelEnter: () => void
  onSidebarPanelLeave: () => void
  aimMove: (event: MouseEvent) => void
  openProjectLabel: JSX.Element
  openProjectKeybind: Accessor<string | undefined>
  onOpenProject: () => void
  settingsLabel: Accessor<string>
  settingsKeybind: Accessor<string | undefined>
  onOpenSettings: () => void
  onOpenAccount: () => void
  accountLabel: Accessor<string>
  helpLabel: Accessor<string>
  onOpenHelp: () => void
  renderPanel: () => JSX.Element
  modes: Accessor<readonly ShellMode[]>
  activeDestination: Accessor<WorkspaceDestination>
  onMode: (mode: WorkspaceDestination) => void
  modesLabel: string
  modeLabel: (mode: ShellMode) => string
}): JSX.Element => {
  const language = useLanguage()
  const expanded = createMemo(() => !!props.mobile || props.opened() || props.sidebarPeeked())
  const railVisible = createMemo(() => !!props.mobile || props.railOpened() || props.railPeeked())
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
    <div
      data-v110="sidebar-clip"
      class="flex h-full w-full min-w-0 overflow-x-clip overflow-y-visible"
      // The nav keeps the panel's full width while the panel is collapsed,
      // on top of the workspace: only the rail may take pointer events then,
      // or the empty strip swallows every click on the chat's left side.
      classList={{ "pointer-events-auto": expanded(), "pointer-events-none": !expanded() }}
      // The reference opens only from the titlebar trigger. Once the preview
      // exists, the shell hit-area bridges the gap to the floating panel;
      // entering this area while closed must remain a no-op.
      onPointerEnter={() => {
        if (props.sidebarPeeked()) props.onSidebarPanelEnter()
      }}
      onPointerLeave={props.onSidebarPanelLeave}
    >
      <div
        data-component="sidebar-rail"
        data-v110="rail"
        data-visible={railVisible()}
        data-parity={props.mobile ? undefined : "shell.rail"}
        classList={{
          "shrink-0 bg-background-base flex flex-col items-center overflow-hidden pointer-events-auto": true,
        }}
        style={{
          width: railVisible() ? "var(--v110-rail, 62px)" : "0px",
          "min-width": railVisible() ? undefined : "0px",
          opacity: railVisible() ? 1 : 0,
          "pointer-events": railVisible() ? "auto" : "none",
        }}
        onMouseMove={props.aimMove}
        onPointerEnter={props.onRailPanelEnter}
        onPointerMove={props.onRailPanelEnter}
        onPointerLeave={props.onRailPanelLeave}
      >
        <div class="flex-1 min-h-0 w-full">
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
                      icon={modeIcon(mode)}
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
                      // The icon's own color comes from icon-button.css's
                      // [data-slot="icon-svg"] { color: var(--icon-base) }
                      // (line 83), not from the button's own `color` --
                      // a plain text-* class on the button has no visible
                      // effect on the glyph, only the descendant-targeted
                      // [&_[data-slot=icon-svg]]:text-* variant does.
                      class="!w-[42px] !h-[42px] !rounded-[12px] relative"
                      // .rail-btn.active's real measured style
                      // (Unifia-UI-UX-v110-PORT-READY-R1.html:184-185,
                      // live getComputedStyle at this app's own theme):
                      // background rgb(~222,222,224), text/icon rgb(23,23,26)
                      // -- a PREVIOUS reading of this same live measurement
                      // (kept in this file's history) recorded a dark
                      // #2c2c2f fill instead; re-measured this session and
                      // found it doesn't match at all. --surface-raised-
                      // base-active (#e2e2e2) and --text-strong (#171717)
                      // are already-existing semantic tokens landing
                      // almost exactly on both live-measured values, used
                      // here instead of a new hardcoded literal. The
                      // maquette also draws a 3px-wide, 24px-tall pill
                      // sitting just outside the button's left edge
                      // (:before, left:-7px, same color as the active
                      // text) -- a tab-style active indicator, not part of
                      // the button's own fill.
                      classList={{
                        "[&_[data-slot=icon-svg]]:!text-text-strong before:content-[''] before:absolute before:-left-[7px] before:top-1/2 before:-translate-y-1/2 before:w-[3px] before:h-[24px] before:rounded-full":
                          props.activeDestination() === mode,
                        "[&_[data-slot=icon-svg]]:!text-text-weak": props.activeDestination() !== mode,
                      }}
                      // Contrat technique de sélection pour les tests, stable
                      // quelle que soit la locale. L'`aria-label` ci-dessous
                      // vient de `modeLabel`, donc il est traduit : la suite
                      // e2e tourne en anglais et rend "work mode" là où
                      // l'application en français rend "Mode Travail".
                      // Accessibilité et contrat de test sont deux
                      // responsabilités distinctes, on garde les deux.
                      data-mode={mode}
                      data-v110="rail-mode"
                      onClick={() => props.onMode(mode)}
                      onMouseEnter={() => { if (mode !== "code") void ensureModeLoaded(mode) }}
                      onFocus={() => { if (mode !== "code") void ensureModeLoaded(mode) }}
                      aria-label={props.modeLabel(mode)}
                      aria-pressed={props.activeDestination() === mode}
                    />
                  </Tooltip>
                )}
              </For>
              {/* Browser and Memory are real workspace destinations in the
                  reference rail, not aliases for Design/Code. */}
              <For each={PILL_DESTINATIONS}>
                {(pill) => (
                  <Tooltip placement={placement()} value={language.t(pill.labelKey)}>
                    <IconButton
                      icon={pill.icon}
                      variant="ghost"
                      size="large"
                      classList={{
                        "!w-[42px] !h-[42px] !rounded-[12px]": true,
                        "[&_[data-slot=icon-svg]]:!text-text-strong before:content-[''] before:absolute before:-left-[7px] before:top-1/2 before:-translate-y-1/2 before:w-[3px] before:h-[24px] before:rounded-full relative": props.activeDestination() === pill.target,
                        "[&_[data-slot=icon-svg]]:!text-text-weak": props.activeDestination() !== pill.target,
                      }}
                      data-v110="rail-mode"
                      onClick={() => props.onMode(pill.target)}
                      aria-label={language.t(pill.labelKey)}
                      aria-pressed={props.activeDestination() === pill.target}
                    />
                  </Tooltip>
                )}
              </For>
            </nav>
          </div>
        </div>
        {/* .rail{padding:8px 6px} applies uniformly on all four sides
            (Unifia-UI-UX-v110-PORT-READY-R1.html:438) -- live-measured gap
            from #settingsBtn's own bottom edge to the rail's bottom edge:
            9px, not the 24px pb-6 held. */}
        <div class="shrink-0 w-full pt-3 pb-2 flex flex-col items-center gap-2">
          {/* Ports .rail-btn "Nouveau" (Unifia-UI-UX-v110-PORT-READY-R1.html:
              15348), positioned directly above the avatar via
              .rail-spacer -- was rendered inline with the mode icons
              above, right after a per-project chip list the maquette has
              no equivalent for at all (its rail is mode-switching only;
              project switching lives on Home). Moved here, chips removed,
              on explicit user decision (2026-09-21): "il n'est pas censé
              y avoir de bouton de projet". */}
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
              onClick={props.onOpenAccount}
              aria-label={props.accountLabel()}
              aria-pressed={props.activeDestination() === "user"}
              classList={{
                "!bg-surface-raised-base-active text-text-strong": props.activeDestination() === "user",
              }}
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
              classList={{
                "!w-[42px] !h-[42px] !rounded-[12px]": true,
                "[&_[data-slot=icon-svg]]:!text-text-strong before:content-[''] before:absolute before:-left-[7px] before:top-1/2 before:-translate-y-1/2 before:w-[3px] before:h-[24px] before:rounded-full relative": props.activeDestination() === "settings",
                "[&_[data-slot=icon-svg]]:!text-text-weak": props.activeDestination() !== "settings",
              }}
              onClick={props.onOpenSettings}
              aria-label={props.settingsLabel()}
              data-v110="rail-mode"
              aria-pressed={props.activeDestination() === "settings"}
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
        // Stays laid out when closed so it can fade and slide out like the
        // reference's panel (v110.css [data-v110="context-track"]).
        data-v110="context-track"
        data-expanded={expanded() ? "true" : "false"}
        classList={{
          "flex-1 flex h-full min-h-0 min-w-0": true,
          "pointer-events-none": !expanded(),
        }}
        aria-hidden={!expanded()}
        onPointerEnter={props.onSidebarPanelEnter}
        onPointerMove={props.onSidebarPanelEnter}
        onPointerLeave={props.onSidebarPanelLeave}
      >
        {props.renderPanel()}
      </div>
    </div>
  )
}
