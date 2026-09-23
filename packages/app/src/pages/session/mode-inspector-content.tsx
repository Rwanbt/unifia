/* SPDX-License-Identifier: MIT */

import { For, Show, createSignal, type JSX } from "solid-js"
import type { WorkspaceDestination } from "@/context/mode-directory"
import { SettingsObservabilityTimeline } from "@/components/settings-observability-timeline"

type InspectorRow = { label: string; value: string }
type InspectorCard = {
  title: string
  rows?: readonly InspectorRow[]
  description?: string
  ranges?: readonly string[]
}


const CODE_INSPECTOR_TABS = ["Overview", "Symbols", "Search", "Review", "Git", "Context", "History"] as const
const EXECUTION_FILTERS = ["Tout", "Modèle", "Contexte", "Outils", "Sources", "Skills", "Mémoire", "Agents", "Règles", "Interaction", "Usage"] as const

const INSPECTOR_CARDS: Record<WorkspaceDestination, readonly InspectorCard[]> = {
  code: [
    { title: "Session", rows: [{ label: "Modèle", value: "MiniMax M3" }, { label: "Mode", value: "Build" }, { label: "Contexte", value: "3 fichiers" }] },
  ],
  work: [{ title: "Créer le nouveau design", rows: [{ label: "État", value: "En cours" }, { label: "Agent", value: "Designer" }, { label: "Progression", value: "64%" }] }],
  design: [
    { title: "Heading", rows: [{ label: "Size", value: "58 px" }, { label: "Weight", value: "650" }, { label: "Tracking", value: "-5%" }] },
    { title: "Tokens", ranges: ["Type", "Contrast"] },
  ],
  automate: [{ title: "Aucune sélection", description: "Cliquez sur un node ou une connexion du Flow pour ouvrir ses propriétés ici." }],
  browser: [
    { title: "Browser control", rows: [{ label: "Controller", value: "Unifia AI" }, { label: "Network", value: "Online" }, { label: "Viewport", value: "Desktop" }, { label: "Actions", value: "Observable" }] },
    { title: "Permissions", rows: [{ label: "Navigate", value: "Allow" }, { label: "Click / type", value: "Allow" }, { label: "Downloads", value: "Ask" }, { label: "Sensitive actions", value: "Ask" }] },
  ],
  memory: [
    { title: "Vision produit.md", rows: [{ label: "Liens", value: "11" }, { label: "Backlinks", value: "3" }, { label: "Tags", value: "2" }] },
    { title: "Memory context", description: "Les notes du vault peuvent être attachées aux conversations, agents, tâches et workflows comme contexte persistant." },
  ],
  settings: [{ title: "Unifia Preferences", rows: [{ label: "Vue active", value: "Réglages intégrés" }, { label: "Comportement", value: "Chat visible" }] }],
  user: [{ title: "Contexte utilisateur", rows: [{ label: "Espace", value: "Personnel" }, { label: "Type", value: "Privé" }, { label: "Sessions", value: "4" }] }, { title: "Isolation", description: "Chat, Memory, providers, secrets et automatisations suivent l'espace actif." }],
}

const EXECUTION_COPY: Record<WorkspaceDestination, { title: string; description: string }> = {
  code: { title: "Session · Refonte Prism EQ", description: "Trace des événements et observabilité de la session Code." },
  work: { title: "Tâche · Créer le nouveau design", description: "Activité et progression de l’opération Work sélectionnée." },
  design: { title: "Canvas · Landing / Desktop", description: "Événements associés au rendu et aux changements du canvas." },
  automate: { title: "Flow · Issue triage v2", description: "Historique des runs et événements du workflow." },
  browser: { title: "Browser · AI Activity", description: "Actions observables de navigation et de contrôle." },
  memory: { title: "Note · Vision produit.md", description: "Activité de lecture, liens et provenance du vault." },
  settings: { title: "Réglages · Observabilité", description: "Événements de configuration de l’espace actif." },
  user: { title: "Compte · Organisations", description: "Événements de l’espace et de l’identité locale." },
}

function InspectorCardView(props: { card: InspectorCard }): JSX.Element {
  return (
    <section data-inspector-card class="mb-2.5 rounded-[11px] border border-border-base bg-background-stronger p-2.5">
      <h4 class="mb-2 text-10-medium text-text-base">{props.card.title}</h4>
      <Show when={props.card.description}>
        <p class="text-10-regular leading-relaxed text-text-weak">{props.card.description}</p>
      </Show>
      <Show when={props.card.rows}>
        <div class="flex flex-col">
          <For each={props.card.rows}>
            {(row) => (
              <div data-inspector-row class="flex items-center justify-between border-b border-border-base py-1.5 text-10-regular last:border-b-0">
                <span class="text-text-weak">{row.label}</span>
                <span class="text-text-base">{row.value}</span>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.card.ranges}>
        <div class="flex flex-col gap-2">
          <For each={props.card.ranges}>
            {(label) => (
              <label class="flex flex-col gap-1.5 text-9-regular text-text-weak">
                {label}
                <input type="range" value={label === "Type" ? "72" : "64"} aria-label={label} class="w-full accent-text-base" />
              </label>
            )}
          </For>
        </div>
      </Show>
    </section>
  )
}

export function ModeInspectorSurface(props: { mode: WorkspaceDestination }): JSX.Element {
  const [activeCodeTab, setActiveCodeTab] = createSignal<(typeof CODE_INSPECTOR_TABS)[number]>("Overview")
  return (
    <div data-mode-inspector={props.mode} data-inspector-state="default" class="h-full min-w-0 overflow-y-auto bg-background-base p-2.5">
      <Show when={props.mode === "code"}>
        <nav data-inspector-nav="code" aria-label="Code Inspector" class="mb-2 border-b border-border-base pb-2">
          <div class="flex gap-0.5">
            <For each={CODE_INSPECTOR_TABS}>
              {(tab) => (
                <button
                  type="button"
                  data-inspector-subtab={tab.toLowerCase()}
                  aria-pressed={activeCodeTab() === tab}
                  class="h-[26px] rounded-lg px-2 text-9-regular text-text-weak hover:bg-background-stronger hover:text-text-base"
                  classList={{ "bg-background-stronger text-text-base": activeCodeTab() === tab }}
                  onClick={() => setActiveCodeTab(tab)}
                >
                  {tab}
                </button>
              )}
            </For>
          </div>
        </nav>
      </Show>
      <For each={INSPECTOR_CARDS[props.mode]}>{(card) => <InspectorCardView card={card} />}</For>
      <Show when={props.mode === "code"}>
        <p data-inspector-subtab-state class="text-9-regular text-text-weaker">{activeCodeTab()} · session workspace</p>
      </Show>
    </div>
  )
}

export function ModeExecutionSurface(props: { mode: WorkspaceDestination; sessionId?: string }): JSX.Element {
  const copy = EXECUTION_COPY[props.mode]
  const [activeFilter, setActiveFilter] = createSignal<(typeof EXECUTION_FILTERS)[number]>("Tout")
  return (
    <div data-mode-execution={props.mode} class="h-full min-w-0 overflow-y-auto bg-background-base p-2.5">
      <section class="mb-2.5 rounded-[13px] border border-border-base bg-background-stronger p-2.5">
        <h4 class="mb-1 text-10-medium text-text-base">{copy.title}</h4>
        <p class="text-10-regular leading-relaxed text-text-weak">{copy.description}</p>
      </section>
      <div data-execution-filters class="mb-2 flex gap-1 overflow-x-auto">
        <For each={EXECUTION_FILTERS}>
          {(filter) => (
            <button
              type="button"
              data-execution-filter={filter.toLowerCase()}
              aria-pressed={activeFilter() === filter}
              class="min-h-[28px] rounded-lg border border-border-base bg-background-stronger px-2 text-left text-9-regular text-text-weak hover:bg-surface-raised-base-hover hover:text-text-base"
              classList={{ "bg-surface-raised-base text-text-base": activeFilter() === filter }}
              onClick={() => setActiveFilter(filter)}
            >
              {filter}
            </button>
          )}
        </For>
      </div>
      <p data-execution-filter-state class="mb-2 text-9-regular text-text-weaker">Filtre : {activeFilter()}</p>
      <SettingsObservabilityTimeline
        sessions={[{ id: props.sessionId ?? "", title: props.sessionId ?? "" }]}
        sessionId={props.sessionId}
        scope="project"
        onSelectSession={() => {}}
      />
    </div>
  )
}
