// =============================================================================
// components/team/team-panel.tsx — TEAM-M03
//
// The desktop Team surface: runs, the selected run's graph, the shared model
// selector, and the reason there are no lifecycle controls.
//
// Composes the primitives in this directory against the context from TEAM-M01.
// Every user-facing string arrives through `labels`, because this component is
// shared with mobile (TEAM-M04) and neither surface owns the other's copy; the
// dictionary work is TEAM-M05's.
//
// Not routed. No card in the plan assigns the job of opening this panel, and
// wiring it means editing pages/layout.tsx — a routing-scope file that this
// card's Target manifest does not cover and that AGENTS.md requires explicit
// scope confirmation for. Recorded as R-UI-UNROUTED-001 rather than done
// quietly: a Team UI nobody can open is the same defect as a Team runtime
// nothing calls.
// =============================================================================

import { createMemo, createSignal, Match, Show, Switch } from "solid-js"
import { TeamGraph, type TeamGraphTask, type TeamGraphWave } from "@opencode-ai/ui/team-graph"
import { useTeam } from "@/context/team"
import { CollectionView, type CollectionLabels } from "./collection-view"
import { LifecycleNotice } from "./lifecycle-notice"
import { ModelSelector, type ModelOption, type SelectorLabels } from "./model-selector"

export interface TeamPanelLabels {
  readonly runs: CollectionLabels
  readonly models: CollectionLabels
  readonly selector: SelectorLabels
  readonly graph: string
  readonly lifecycle: string
  /** Shown while a recoverable failure is still being retried. */
  readonly retrying: string
  /** Shown once retrying has been given up, so the surface is not just silent. */
  readonly exhausted: string
}

export interface TeamPanelProps {
  readonly labels: TeamPanelLabels
  /**
   * Waves for the selected run, already laid out by the caller.
   *
   * The layout algorithm lives in the CLI package and is tested there; passing
   * the result in keeps one implementation of "which task runs when" rather
   * than growing a second one here that could disagree with the terminal.
   */
  readonly waves: readonly TeamGraphWave[]
  readonly tasks: readonly TeamGraphTask[]
  /** True once recovery has stopped retrying; see refresh-policy.ts. */
  readonly exhausted?: boolean
}

export function TeamPanel(props: TeamPanelProps) {
  const team = useTeam()
  const [selectedTask, setSelectedTask] = createSignal<string | undefined>(undefined)

  const options = createMemo<ModelOption[]>(() =>
    team.models.page().items.map((model) => ({
      providerID: model.providerID,
      modelID: model.modelId,
      label: model.family ? `${model.family} · ${model.modelId}` : model.modelId,
    })),
  )

  return (
    <div class="flex flex-col gap-4 p-3">
      <LifecycleNotice capabilities={team.capabilities()} reason={props.labels.lifecycle} />

      {/* Retrying and having given up are different things to show. Collapsing
          them leaves a panel that silently stops updating. */}
      <Switch>
        <Match when={props.exhausted}>
          <p role="alert" class="text-11-regular text-text-danger">
            {props.labels.exhausted}
          </p>
        </Match>
        <Match when={team.runs.stale()}>
          <p role="status" class="text-11-regular text-text-weaker">
            {props.labels.retrying}
          </p>
        </Match>
      </Switch>

      <CollectionView
        page={team.runs.page()}
        reachability={team.runs.reachability()}
        labels={props.labels.runs}
        onMore={() => void team.runs.more()}
      >
        {(run) => (
          <div class="flex items-center gap-2 text-11-regular">
            <span class="text-text-base">{run.runId}</span>
            <span class="text-text-weaker">{run.status}</span>
          </div>
        )}
      </CollectionView>

      <Show when={props.waves.length > 0}>
        <TeamGraph
          label={props.labels.graph}
          waves={props.waves}
          tasks={props.tasks}
          selected={selectedTask()}
          onSelect={setSelectedTask}
        />
      </Show>

      <ModelSelector
        options={options()}
        selected={team.selection.effective()}
        source={team.selection.source()}
        rejected={team.selection.rejected()}
        labels={props.labels.selector}
        onPick={(selection) => team.selection.setOverride(selection)}
        onSaveDefault={(selection) => team.selection.save(selection)}
        onClearOverride={() => team.selection.clearOverride()}
      />

      <CollectionView
        page={team.models.page()}
        reachability={team.models.reachability()}
        labels={props.labels.models}
        onMore={() => void team.models.more()}
      >
        {(model) => <span class="text-11-regular text-text-weak">{model.modelId}</span>}
      </CollectionView>
    </div>
  )
}
