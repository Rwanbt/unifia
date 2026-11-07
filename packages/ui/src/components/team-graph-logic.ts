// Pure dependency graph logic shared by renderers and deterministic unit tests.
export interface TeamGraphTask {
  readonly taskId: string
  readonly status: string
  readonly dependsOn: readonly string[]
}

export interface TeamGraphWave {
  readonly index: number
  readonly taskIds: readonly string[]
}

/** Deterministic topological waves for every Team surface. */
export function wavesFor(tasks: readonly TeamGraphTask[]): readonly TeamGraphWave[] {
  const remaining = new Map(tasks.map((task) => [task.taskId, task] as const))
  const completed = new Set<string>()
  const waves: TeamGraphWave[] = []
  while (remaining.size > 0) {
    const ready = [...remaining.values()]
      .filter((task) => task.dependsOn.every((dependency) => completed.has(dependency)))
      .map((task) => task.taskId)
      .sort()
    if (ready.length === 0) {
      waves.push({ index: waves.length, taskIds: [...remaining.keys()].sort() })
      break
    }
    waves.push({ index: waves.length, taskIds: ready })
    for (const taskId of ready) {
      remaining.delete(taskId)
      completed.add(taskId)
    }
  }
  return waves
}

/**
 * Which tasks are related to the selected one, and how.
 *
 * The two sets are not disjoint, and deliberately so: inside a cycle a task
 * genuinely is both upstream and downstream of the selection, and forcing it
 * into one would misreport the graph. `emphasisFor` is what resolves that into
 * a single presentation, so every node still gets exactly one appearance.
 */
export interface Relations {
  readonly ancestors: ReadonlySet<string>
  readonly descendants: ReadonlySet<string>
}

export const NO_RELATIONS: Relations = { ancestors: new Set(), descendants: new Set() }

/**
 * Everything the selected task waits for, and everything waiting on it.
 *
 * Transitive on purpose. Showing only direct neighbours answers "what did I
 * declare?" when the question a reader actually has is "what has to finish
 * before this can start?" — and in a deep plan those are different sets.
 */
export function relationsFor(tasks: readonly TeamGraphTask[], selected: string | undefined): Relations {
  if (selected === undefined) return NO_RELATIONS

  const byId = new Map(tasks.map((task) => [task.taskId, task]))
  if (!byId.has(selected)) return NO_RELATIONS

  const dependents = new Map<string, string[]>()
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      const list = dependents.get(dependency)
      if (list) list.push(task.taskId)
      else dependents.set(dependency, [task.taskId])
    }
  }

  const walk = (start: string, next: (id: string) => readonly string[]): Set<string> => {
    const found = new Set<string>()
    const queue = [...next(start)]
    while (queue.length > 0) {
      const id = queue.pop()!
      // The visited check is also the cycle guard: a graph with a cycle must
      // colour its nodes, not hang the panel that draws them.
      if (found.has(id) || id === start) continue
      found.add(id)
      queue.push(...next(id))
    }
    return found
  }

  return {
    ancestors: walk(selected, (id) => byId.get(id)?.dependsOn ?? []),
    descendants: walk(selected, (id) => dependents.get(id) ?? []),
  }
}

/** How a task should be presented relative to the current selection. */
export type TaskEmphasis = "selected" | "ancestor" | "descendant" | "unrelated" | "none"

export function emphasisFor(taskId: string, selected: string | undefined, relations: Relations): TaskEmphasis {
  if (selected === undefined) return "none"
  if (taskId === selected) return "selected"
  if (relations.ancestors.has(taskId)) return "ancestor"
  if (relations.descendants.has(taskId)) return "descendant"
  return "unrelated"
}
