/* SPDX-License-Identifier: MIT */

/**
 * ModeSections — the mode-specific disclosures below "Projects" in the
 * context panel (sidebar-panel.tsx).
 *
 * Maquette's `.v68-context-root[data-mode]` appends different sections per
 * shell mode (extracted live via `window.UnifiaDemo.enter(mode)` + a DOM
 * dump): Code -> "Code Scope"; Work -> "Work" + "Agents"; Design -> "Pages"
 * + "Design System"; Automate -> "Workflows" + "Runs"; Memory -> "Memory";
 * Browser -> "Project Links" + "Library"; Settings -> none. Code and Work
 * are backed by real data; the others mirror the maquette's rows.
 */
import { createResource, createSignal, For, Match, Show, Switch, type JSX } from "solid-js"
import { Collapsible } from "@unifia/ui/collapsible"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useMode } from "@/context/mode"
import type { WorkspaceDestination } from "@/context/mode-directory"
import { useModeNavigation } from "@/context/mode-navigation"
import { useSDK } from "@/context/sdk"
import { WORK_VIEW_GLYPH, WORK_VIEW_LABEL_KEY, WORK_VIEWS } from "@/context/work-view"

/** The `.v68-section-head` content: chevron, uppercase title, count. */
export const SectionHead = (props: { title: string; count: number }) => (
  <>
    <span class="v68-chevron" aria-hidden="true">
      ›
    </span>
    <span class="v68-section-title">{props.title}</span>
    <span class="v68-count">{props.count}</span>
  </>
)

/** One `.v68-section` disclosure, open by default like the reference. */
const Section = (props: { id: string; title: string; count: number; children: JSX.Element }) => {
  const [open, setOpen] = createSignal(true)
  return (
    <Collapsible
      open={open()}
      onOpenChange={setOpen}
      class="v68-section"
      classList={{ open: open() }}
      data-mode-section={props.id}
    >
      <Collapsible.Trigger class="v68-section-head">
        <SectionHead title={props.title} count={props.count} />
      </Collapsible.Trigger>
      <Collapsible.Content class="v68-disclosure-body">{props.children}</Collapsible.Content>
    </Collapsible>
  )
}

/** A `.v68-nav` row: glyph, label, then an optional meta text or count badge. */
const NavRow = (props: {
  glyph: string
  label: string
  active?: boolean
  meta?: string
  badge?: string
  onClick?: () => void
  attrs?: Record<string, string>
}) => {
  const body = () => (
    <>
      <span class="v68-nav-icon" aria-hidden="true">
        {props.glyph}
      </span>
      <span class="v68-nav-copy">{props.label}</span>
      <Show when={props.meta}>
        <span class="v68-nav-meta">{props.meta}</span>
      </Show>
      <Show when={props.badge !== undefined}>
        <span class="badge">{props.badge}</span>
      </Show>
    </>
  )
  // A row that does nothing is text, not a button: no focus stop, no dead click.
  return (
    <Show
      when={props.onClick}
      fallback={
        <div class="v68-nav" classList={{ active: props.active === true }} data-v110="nav-item" aria-current={props.active === true ? "true" : undefined} {...props.attrs}>
          {body()}
        </div>
      }
    >
      {(onClick) => (
        <button
          type="button"
          class="v68-nav"
          classList={{ active: props.active === true }}
          data-v110="nav-item"
          aria-current={props.active === true ? "true" : undefined}
          onClick={() => onClick()()}
          {...props.attrs}
        >
          {body()}
        </button>
      )}
    </Show>
  )
}

// Maquette's "Code Scope" lists fixed demo areas of one fictional plugin
// project (UI/DSP/Plugin runtime/Tests). Those don't exist generically, so
// this scopes to the real, available equivalent: "Entire workspace" plus
// the project's actual top-level directories, each a real jump into the
// Explorer tab. Fetched directly via the SDK client (sdk.client.file.list,
// the same call context/file.tsx's tree store wraps) rather than useFile(),
// because FileProvider is session-scoped (app.tsx's SessionProviders) and
// this panel renders outside any session route (e.g. the home screen).
const CodeScopeSection = () => {
  const language = useLanguage()
  const layout = useLayout()
  const sdk = useSDK()

  const [folders] = createResource(
    () => sdk.directory,
    () => sdk.client.file.list({ path: "" }).then((x) => (x.data ?? []).filter((node) => node.type === "directory")),
  )

  // A specific folder isn't revealed/expanded in the Explorer tree from
  // here (that needs useFile(), unavailable at this session-independent
  // scope -- see the comment above); opening the tab is still a real,
  // working action, just without the extra reveal step.
  const openExplorer = () => {
    layout.inspector.setTab("explorer")
    layout.inspector.open()
  }

  return (
    <Section id="code.scope" title={language.t("sidebar.codeScope.title")} count={(folders()?.length ?? 0) + 1}>
      {/* The code scope is always the whole workspace today, so this row is
          the current one (maquette .v68-nav.active). */}
      <NavRow glyph="◎" label={language.t("sidebar.codeScope.entireWorkspace")} active onClick={openExplorer} />
      <For each={folders() ?? []}>{(node) => <NavRow glyph="▦" label={node.name} onClick={openExplorer} />}</For>
    </Section>
  )
}

// Maquette "Work" + "Agents" sections. The six views are the Work card's
// real views and drive layout.work (ADR-040). The Team backend exposes no
// agent roster, so Agents shows an honest empty state instead of names.
const WorkSections = () => {
  const layout = useLayout()
  const language = useLanguage()

  return (
    <>
      <Section id="work.views" title={language.t("sidebar.work.views")} count={WORK_VIEWS.length}>
        <For each={WORK_VIEWS}>
          {(view) => (
            <NavRow
              glyph={WORK_VIEW_GLYPH[view]}
              label={language.t(WORK_VIEW_LABEL_KEY[view])}
              active={layout.work.view() === view}
              attrs={{ "data-work-view": view }}
              onClick={() => layout.work.setView(view)}
            />
          )}
        </For>
      </Section>
      <Section id="work.agents" title={language.t("sidebar.work.agents")} count={0}>
        <p class="v68-empty">{language.t("sidebar.work.noAgents")}</p>
      </Section>
    </>
  )
}

// Design, Automate, Memory and Browser have no navigation of their own here:
// their surfaces publish the sections (context/mode-navigation), so every row
// is a real thing the surface holds. Nothing published means nothing shown.
const PublishedSections = (props: { mode: WorkspaceDestination }) => {
  const language = useLanguage()
  const navigation = useModeNavigation()
  return (
    <For each={navigation.read(props.mode)}>
      {(section) => (
        <Section id={section.id} title={language.t(section.titleKey)} count={section.rows.length}>
          <Show when={section.rows.length > 0} fallback={<p class="v68-empty">{section.emptyKey ? language.t(section.emptyKey) : ""}</p>}>
            <For each={section.rows}>
              {(row) => (
                <NavRow glyph={row.glyph} label={row.label} active={row.active} badge={row.badge} onClick={row.onSelect} />
              )}
            </For>
          </Show>
        </Section>
      )}
    </For>
  )
}

const PUBLISHED_MODES: ReadonlySet<WorkspaceDestination> = new Set(["design", "automate", "browser", "memory"])

export function ModeSections() {
  const mode = useMode()
  return (
    <Switch>
      <Match when={mode.destination() === "code"}>
        <CodeScopeSection />
      </Match>
      <Match when={mode.destination() === "work"}>
        <WorkSections />
      </Match>
      <Match when={PUBLISHED_MODES.has(mode.destination())}>
        <PublishedSections mode={mode.destination()} />
      </Match>
    </Switch>
  )
}
