// =============================================================================
// ui/components/team-graph.tsx — TEAM-M03
//
// The interactive task graph of a Team run, as a reusable component.
//
// Lives in packages/ui because the desktop app and mobile draw the same graph
// and must not each grow their own version of "which task is blocked by which"
// — that is one fact, and it gets one owner.
//
// The layout arrives already computed. Deciding a graph's shape and drawing it
// are separate jobs, and only the first one has a right answer that can be
// tested; the pure part of that decision lives below the component and is
// exercised by team-graph.test.ts.
// =============================================================================

import { For, Show, createMemo, type JSX } from "solid-js"

import { relationsFor, emphasisFor, type TeamGraphTask, type TeamGraphWave, type TaskEmphasis } from "./team-graph-logic"
export { wavesFor, NO_RELATIONS, relationsFor, emphasisFor } from "./team-graph-logic"
export type { TeamGraphTask, TeamGraphWave, Relations, TaskEmphasis } from "./team-graph-logic"

export interface TeamGraphProps {
  readonly waves: readonly TeamGraphWave[]
  readonly tasks: readonly TeamGraphTask[]
  readonly selected?: string
  readonly onSelect?: (taskId: string | undefined) => void
  /** Rendered inside each node. The caller owns the wording. */
  readonly children?: (task: TeamGraphTask, emphasis: TaskEmphasis) => JSX.Element
  /** Accessible name for the graph region; supplied translated by the caller. */
  readonly label: string
}

export function TeamGraph(props: TeamGraphProps) {
  const byId = createMemo(() => new Map(props.tasks.map((task) => [task.taskId, task])))
  const relations = createMemo(() => relationsFor(props.tasks, props.selected))

  return (
    <div data-component="team-graph" role="group" aria-label={props.label}>
      <For each={props.waves}>
        {(wave) => (
          <div data-part="wave" data-wave={wave.index}>
            <For each={wave.taskIds}>
              {(taskId) => {
                const task = () => byId().get(taskId)
                const emphasis = () => emphasisFor(taskId, props.selected, relations())
                return (
                  <Show when={task()}>
                    {(resolved) => (
                      <button
                        type="button"
                        data-part="task"
                        data-status={resolved().status}
                        data-emphasis={emphasis()}
                        aria-pressed={emphasis() === "selected"}
                        onClick={() =>
                          props.onSelect?.(props.selected === taskId ? undefined : taskId)
                        }
                      >
                        {props.children?.(resolved(), emphasis()) ?? taskId}
                      </button>
                    )}
                  </Show>
                )
              }}
            </For>
          </div>
        )}
      </For>
    </div>
  )
}
