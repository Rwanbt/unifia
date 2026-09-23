/* SPDX-License-Identifier: MIT */

import { For, Show, createMemo, createSignal, type JSX } from "solid-js"
import type { WorkspaceDestination } from "@/context/mode-directory"
import { useLanguage } from "@/context/language"
import { EXECUTION_FILTERS, executionRows, type ExecutionEvent, type ExecutionFilter } from "./execution-log"

type InspectorRow = { label: string; value: string }
// Maquette .inspect-card variants: a titled card (h4, optional p, .kv rows,
// actions, a version row), a settings key/value card (.inspect-key /
// .inspect-value), and the Design empty head (.v51-inspector-head).
type InspectorCard =
  | {
      kind?: "card"
      title: string
      description?: string
      rows?: readonly InspectorRow[]
      actions?: readonly string[]
      version?: { title: string; author: string }
    }
  | { kind: "keyvalue"; label: string; value: string }
  | { kind: "head"; title: string; description: string }

const snapshotTime = () =>
  new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date())

// The reference's Code and Memory inspectors both show the memory note the
// session has attached (#inspectorPanel details pane, "Vision produit.md").
const NOTE_CARDS = (): readonly InspectorCard[] => [
  { title: "Vision produit.md", description: "10 — Projects/Unifia · Knowledge" },
  {
    title: "Properties",
    rows: [
      { label: "Type", value: "Knowledge" },
      { label: "Scope", value: "Project" },
      { label: "Status", value: "Verified" },
      { label: "Confidence", value: "98%" },
      { label: "Links", value: "5" },
      { label: "Backlinks", value: "5" },
    ],
    actions: ["Verified ✓", "Remove context"],
  },
  {
    title: "Provenance",
    rows: [
      { label: "Kind", value: "Project" },
      { label: "Source", value: "Vision produit Unifia" },
      { label: "Branch", value: "main" },
      { label: "Reference", value: "product/vision" },
      { label: "Verified by", value: "Erwan" },
    ],
  },
  {
    title: "AI Context",
    description: "Cette note est explicitement attachée au contexte de la session.",
    rows: [
      { label: "Recall reason", value: "Pinned by user" },
      { label: "Freshness", value: "Current" },
    ],
  },
  { title: "Versions · 1", version: { title: `Initial snapshot · ${snapshotTime()}`, author: "Erwan" } },
]

const INSPECTOR_CARDS: Record<WorkspaceDestination, () => readonly InspectorCard[]> = {
  code: NOTE_CARDS,
  work: () => [{ title: "Créer le nouveau design", rows: [{ label: "État", value: "En cours" }, { label: "Agent", value: "Designer" }, { label: "Progression", value: "64%" }] }],
  design: () => [{ kind: "head", title: "Aucune sélection", description: "Sélectionnez un élément sur le canvas ou dans Layers." }],
  automate: () => [{ title: "Aucune sélection", description: "Cliquez sur un node ou une connexion du Flow pour ouvrir ses propriétés ici." }],
  browser: () => [
    { title: "Browser control", rows: [{ label: "Controller", value: "Unifia AI" }, { label: "Network", value: "Online" }, { label: "Viewport", value: "Desktop" }, { label: "Actions", value: "Observable" }] },
    { title: "Permissions", rows: [{ label: "Navigate", value: "Allow" }, { label: "Click / type", value: "Allow" }, { label: "Downloads", value: "Ask" }, { label: "Sensitive actions", value: "Ask" }] },
  ],
  memory: NOTE_CARDS,
  settings: () => [
    { kind: "keyvalue", label: "Workspace", value: "Unifia Preferences" },
    { kind: "keyvalue", label: "Vue active", value: "Réglages intégrés" },
    { kind: "keyvalue", label: "Comportement", value: "Chat visible · Panneau principal interactif" },
  ],
  user: () => [
    { title: "Contexte utilisateur", rows: [{ label: "Espace", value: "Personnel" }, { label: "Type", value: "Privé" }, { label: "Sessions", value: "4" }] },
    { title: "Isolation", description: "Chat, Memory, providers, secrets et automatisations suivent l'espace actif." },
  ],
}

function InspectorCardView(props: { card: InspectorCard }): JSX.Element {
  const card = props.card
  if (card.kind === "keyvalue")
    return (
      <section data-inspector-card data-variant="keyvalue">
        <div data-inspector-key>{card.label}</div>
        <div data-inspector-value>{card.value}</div>
      </section>
    )
  if (card.kind === "head")
    return (
      <section data-inspector-head>
        <b>{card.title}</b>
        <small>{card.description}</small>
      </section>
    )
  return (
    <section data-inspector-card>
      <h4>{card.title}</h4>
      <Show when={card.description}>
        <p>{card.description}</p>
      </Show>
      <For each={card.rows ?? []}>
        {(row) => (
          <div data-inspector-row>
            <span>{row.label}</span>
            <span>{row.value}</span>
          </div>
        )}
      </For>
      <Show when={card.actions}>
        <div data-inspector-actions>
          <For each={card.actions}>{(label) => <button type="button">{label}</button>}</For>
        </div>
      </Show>
      <Show when={card.version}>
        {(version) => (
          <div data-inspector-version>
            <b>{version().title}</b>
            <span>{version().author}</span>
          </div>
        )}
      </Show>
    </section>
  )
}

export function ModeInspectorSurface(props: { mode: WorkspaceDestination }): JSX.Element {
  return (
    <div data-mode-inspector={props.mode} data-inspector-state="default">
      <For each={INSPECTOR_CARDS[props.mode]()}>{(card) => <InspectorCardView card={card} />}</For>
    </div>
  )
}

// Maquette .v96-execution-shell: the filter grid over the session's event
// rows (execution-log.ts maps the native observability spans onto them).
export function ModeExecutionSurface(props: { mode: WorkspaceDestination; events: readonly ExecutionEvent[] | undefined }): JSX.Element {
  const language = useLanguage()
  const [filter, setFilter] = createSignal<ExecutionFilter>("all")
  const statusLabel = (status: string) =>
    status === "failed" || status === "aborted" ? language.t(`inspector.execution.status.${status}`) : language.t("inspector.execution.status.finished")
  const rows = createMemo(() => executionRows(props.events ?? [], filter(), statusLabel))
  return (
    <div data-mode-execution={props.mode}>
      <div data-execution-filters>
        <For each={EXECUTION_FILTERS}>
          {(item) => (
            <button type="button" data-execution-filter={item} aria-pressed={filter() === item} onClick={() => setFilter(item)}>
              {language.t(`inspector.execution.filter.${item}`)}
            </button>
          )}
        </For>
      </div>
      <div data-execution-list>
        <Show when={rows().length > 0} fallback={<div data-execution-empty>{language.t("inspector.execution.empty")}</div>}>
          <For each={rows()}>
            {(row) => (
              <div data-execution-row data-status={row.status}>
                <time>{row.time}</time>
                <span data-execution-icon>{row.glyph}</span>
                <div data-execution-copy>
                  <b>{row.title}</b>
                  <span>{row.summary}</span>
                  <small>{row.meta}</small>
                </div>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  )
}
