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
}) => (
  <button
    type="button"
    class="v68-nav"
    classList={{ active: props.active === true }}
    data-v110="nav-item"
    aria-current={props.active === true ? "true" : undefined}
    onClick={() => props.onClick?.()}
    {...props.attrs}
  >
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
  </button>
)

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

type Row = { glyph: string; key?: string; label?: string; active?: boolean; badge?: string }

// The maquette's own rows for the modes whose navigation has no backend yet;
// `count` is the section's own tally when it is not its row count (Runs).
const StaticSection = (props: { id: string; titleKey: string; rows: readonly Row[]; count?: number }) => {
  const language = useLanguage()
  return (
    <Section id={props.id} title={language.t(props.titleKey)} count={props.count ?? props.rows.length}>
      <For each={props.rows}>
        {(row) => (
          <NavRow
            glyph={row.glyph}
            label={row.key ? language.t(row.key) : (row.label ?? "")}
            active={row.active}
            badge={row.badge}
          />
        )}
      </For>
    </Section>
  )
}

const DesignSections = () => (
  <>
    <StaticSection
      id="design.pages"
      titleKey="sidebar.nav.pages"
      rows={[
        { glyph: "▧", label: "Landing", active: true },
        { glyph: "▧", label: "Settings" },
        { glyph: "▧", label: "Components" },
      ]}
    />
    <StaticSection
      id="design.system"
      titleKey="sidebar.nav.designSystem"
      rows={[
        { glyph: "●", key: "sidebar.nav.tokens" },
        { glyph: "◇", key: "sidebar.nav.components" },
        { glyph: "▣", key: "sidebar.nav.assets" },
      ]}
    />
  </>
)

const AutomateSections = () => (
  <>
    <StaticSection
      id="automate.workflows"
      titleKey="sidebar.nav.workflows"
      rows={[
        { glyph: "⛓", label: "Issue triage", active: true, badge: "open" },
        { glyph: "⛓", label: "Release notes" },
        { glyph: "⛓", label: "Nightly tests" },
      ]}
    />
    <StaticSection
      id="automate.runs"
      titleKey="sidebar.nav.runs"
      count={0}
      rows={[
        { glyph: "▶", key: "sidebar.nav.history", badge: "0" },
        { glyph: "⚠", key: "sidebar.nav.failures", badge: "0" },
      ]}
    />
  </>
)

const MemorySections = () => (
  <StaticSection
    id="memory.memory"
    titleKey="sidebar.nav.memory"
    rows={[
      { glyph: "◈", key: "sidebar.nav.notes", active: true },
      { glyph: "◎", key: "sidebar.nav.graph" },
      { glyph: "⌕", key: "sidebar.nav.search" },
      { glyph: "↗", key: "sidebar.nav.backlinks" },
    ]}
  />
)

const BrowserSections = () => (
  <>
    <StaticSection
      id="browser.links"
      titleKey="sidebar.nav.projectLinks"
      rows={[
        { glyph: "⌂", key: "sidebar.nav.localPreview" },
        { glyph: "⑂", key: "sidebar.nav.repository" },
        { glyph: "◇", key: "sidebar.nav.documentation" },
      ]}
    />
    <StaticSection
      id="browser.library"
      titleKey="sidebar.nav.library"
      rows={[
        { glyph: "◷", key: "sidebar.nav.history", badge: "0" },
        { glyph: "☆", key: "sidebar.nav.bookmarks", badge: "3" },
        { glyph: "⇩", key: "sidebar.nav.downloads", badge: "1" },
      ]}
    />
  </>
)

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
      <Match when={mode.destination() === "design"}>
        <DesignSections />
      </Match>
      <Match when={mode.destination() === "automate"}>
        <AutomateSections />
      </Match>
      <Match when={mode.destination() === "browser"}>
        <BrowserSections />
      </Match>
      <Match when={mode.destination() === "memory"}>
        <MemorySections />
      </Match>
    </Switch>
  )
}
