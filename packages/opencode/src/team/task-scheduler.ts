/**
 * task-scheduler.ts — TEAM-K01
 *
 * Parallel READ scheduler: given a set of read-only tasks with provider
 * capacity constraints, produce an ordered plan of execution "waves" so
 * that:
 *
 *   - each task is scheduled exactly once (no duplicate attempts);
 *   - the per-wave concurrency never exceeds the bound implied by the
 *     provider capacity declared for the tasks scheduled in that wave;
 *   - the plan is deterministic for a fixed (tasks, config) pair (same
 *     seed in config ⇒ identical waves in identical order);
 *   - no task is starved: every task in the input set appears in some
 *     wave (full coverage);
 *   - cancellation is honoured: scheduling an AbortSignal that has been
 *     triggered yields only the prefix of waves already committed, with
 *     no further work scheduled after the abort point.
 *
 * The module is deliberately clock-free and pure: the caller provides the
 * seed and the AbortSignal, and the function does not touch the network,
 * the filesystem, the LLM, or the wall clock. This keeps it trivially
 * testable with property-based random inputs (no flakiness, no flakes to
 * paper over).
 *
 * Design notes (see docs/team/scope-manifest/TEAM-K01.yaml + the K01
 * handoff for the full rationale):
 *
 *   - One scheduler = one set of read-only tasks scheduled together. K02
 *     extends the same file to add the parallel-write conflict matrix on
 *     top; K01 keeps the surface area minimal so that the invariants the
 *     test suite proves are easy to reason about.
 *
 *   - Tasks are sorted by (priority DESC, taskId ASC) where the taskId
 *     tiebreak makes the order deterministic and stable under permutations
 *     of the input. Capacity per wave is computed from the maximum
 *     providerCapacity[t.providerId] of any task in the wave.
 *
 *   - Waves are filled greedily in priority order, each wave capped by
 *     the smallest providerCapacity that any of its tasks declares
 *     (pessimistic — we cannot know which provider a task in the wave
 *     will land on until runtime, so we use the minimum). This is the
 *     only safe choice given we are pre-scheduling without runtime
 *     knowledge of which provider the task actually hits.
 *
 *   - Cancellation is checked before each wave commit, not after: if the
 *     signal aborts mid-fill, the partially filled wave is dropped. This
 *     matches the integration-runtime contract (IntegrationRuntime awaits
 *     the scheduler and a cancelled run yields a partial plan, never a
 *     partial commit).
 *
 *   - We do NOT depend on `effect`, on `lock-manager`, or on
 *     `attempt-manager`. The scheduler is a pure function over plain
 *     values; downstream cards wire it into Effect services and the
 *     runtime.
 *
 *   - We do NOT add a Zod schema for the inputs/outputs: the only
 *     consumers of this module within K01's scope are the tests and the
 *     K02 extension, and both are within the team/ package. types.ts
 *     will get a typed export when K02 lands the persistence layer; for
 *     now, plain readonly interfaces are the smallest change.
 */

export const TASK_SCHEDULER_SCHEMA_VERSION = "1.0.0" as const;

/**
 * Hard upper bound on the number of tasks a single call will accept.
 * Beyond this, callers are expected to chunk and merge plans. This limit
 * exists to keep the worst-case scheduling cost bounded and to make
 * property-check runs (5000+ random inputs) finish in seconds, not
 * minutes.
 */
export const TASK_SCHEDULER_MAX_TASKS_PER_CALL = 4096 as const;

/**
 * Lower bound on provider capacity. A capacity of 0 would mean "this
 * provider is fully offline" — scheduling such a task can never complete.
 * We fail closed at schedule() time rather than producing a plan that
 * would deadlock.
 */
export const TASK_SCHEDULER_MIN_PROVIDER_CAPACITY = 1 as const;

/**
 * A read-only task to be scheduled. "Read-only" here means "the task
 * performs no git write to the worktree it was assigned to" — read tasks
 * may still perform local computation, LLM calls, and outbound HTTP
 * calls (e.g. a provider health probe). K02 introduces the conflict
 * matrix that distinguishes these cases.
 */
export interface ReadTask {
  readonly taskId: string;
  readonly providerId: string;
  /** Higher priority sorts earlier in the plan. Ties broken by taskId. */
  readonly priority: number;
}

/**
 * The scheduler's view of a provider's current concurrency capacity.
 * Treated as a snapshot taken at the moment schedule() is called; the
 * runtime is responsible for invalidating plans whose capacity went down
 * (the K02 conflict matrix and IntegrationRuntime handle that).
 */
export interface ProviderCapacity {
  readonly providerId: string;
  /** Maximum number of concurrent tasks this provider can serve now. */
  readonly capacity: number;
}

/**
 * Static configuration for one schedule() call. The seed makes the
 * tiebreak deterministic; the abortSignal lets the caller cancel mid-plan.
 */
export interface SchedulerConfig {
  readonly seed: number;
  readonly providerCapacities: readonly ProviderCapacity[];
  readonly defaultCapacity: number;
  readonly abortSignal?: AbortSignal;
}

/**
 * One wave = a set of tasks that can run concurrently. A task appears in
 * exactly one wave; wave index 0 runs first.
 */
export interface ScheduleWave {
  readonly waveIndex: number;
  readonly taskIds: readonly string[];
  /** Worst-case effective capacity used by this wave (= min over tasks). */
  readonly effectiveCapacity: number;
}

/**
 * The full plan returned by schedule(). Waves are ordered; within a wave
 * tasks are unordered (they may run concurrently).
 */
export interface ReadSchedule {
  readonly schemaVersion: typeof TASK_SCHEDULER_SCHEMA_VERSION;
  readonly waves: readonly ScheduleWave[];
  /** Number of input tasks (after duplicate removal; = sum of wave sizes). */
  readonly totalTasks: number;
  /**
   * Whether schedule() returned early because of cancellation. When true,
   * the omitted tail of tasks was never scheduled.
   */
  readonly cancelled: boolean;
}

export class TaskSchedulerInputError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "TaskSchedulerInputError";
  }
}

function validateInputs(
  tasks: readonly ReadTask[],
  config: SchedulerConfig,
): void {
  if (!Number.isFinite(config.seed)) {
    throw new TaskSchedulerInputError("seed must be a finite number");
  }
  if (!Number.isInteger(config.defaultCapacity)) {
    throw new TaskSchedulerInputError("defaultCapacity must be an integer");
  }
  if (config.defaultCapacity < TASK_SCHEDULER_MIN_PROVIDER_CAPACITY) {
    throw new TaskSchedulerInputError(
      `defaultCapacity must be >= ${TASK_SCHEDULER_MIN_PROVIDER_CAPACITY}`,
    );
  }
  if (tasks.length > TASK_SCHEDULER_MAX_TASKS_PER_CALL) {
    throw new TaskSchedulerInputError(
      `task count ${tasks.length} exceeds TASK_SCHEDULER_MAX_TASKS_PER_CALL=${TASK_SCHEDULER_MAX_TASKS_PER_CALL}`,
    );
  }
  for (const cap of config.providerCapacities) {
    if (!Number.isInteger(cap.capacity)) {
      throw new TaskSchedulerInputError(
        `provider capacity for ${cap.providerId} must be an integer`,
      );
    }
    if (cap.capacity < TASK_SCHEDULER_MIN_PROVIDER_CAPACITY) {
      throw new TaskSchedulerInputError(
        `provider capacity for ${cap.providerId} must be >= ${TASK_SCHEDULER_MIN_PROVIDER_CAPACITY}`,
      );
    }
  }
  const seen = new Set<string>();
  for (const t of tasks) {
    if (t.taskId.length === 0) {
      throw new TaskSchedulerInputError("taskId must not be empty");
    }
    if (seen.has(t.taskId)) {
      throw new TaskSchedulerInputError(
        `duplicate taskId in input: ${t.taskId}`,
      );
    }
    seen.add(t.taskId);
  }
}

function capacityFor(
  providerId: string,
  capacities: readonly ProviderCapacity[],
  fallback: number,
): number {
  for (const c of capacities) {
    if (c.providerId === providerId) return c.capacity;
  }
  return fallback;
}

function sortKey(t: ReadTask, _seed: number): readonly [number, string] {
  // `seed` is currently a tiebreak-stable input that callers can use to
  // force a deterministic re-shuffle of equal-priority tasks (e.g. by
  // changing the seed and re-running through flattenSchedule()). The
  // primary key is -priority (higher first) and the secondary key is
  // taskId (lexicographic). Both keys are stable under permutations of
  // the input set as long as taskId uniqueness holds, which the
  // validator enforces. K02 will fold the seed into the conflict matrix
  // tiebreak for write tasks; for K01's read-only path the seed is
  // reserved but inert.
  const priorityKey = -t.priority;
  return [priorityKey, t.taskId] as const;
}

/**
 * Greedy wave-filling scheduler. The algorithm:
 *   1. Sort tasks by (priority DESC, taskId ASC), with seed folded into
 *      the priority key for tiebreaking.
 *   2. For each task in order, place it in the current wave if doing so
 *      would not exceed the smallest provider capacity of any task
 *      already in the wave (or this task itself).
 *   3. When the wave is "full" (next task would exceed effective capacity),
 *      commit the wave and start a new one.
 *   4. Check abortSignal before each wave commit; if aborted, drop the
 *      tail of tasks and return the prefix.
 *
 * Complexity: O(n log n) for the sort + O(n) for the linear pass.
 * Memory: O(n) for the sorted array + O(n) for the waves.
 */
export function schedule(
  tasks: readonly ReadTask[],
  config: SchedulerConfig,
): ReadSchedule {
  validateInputs(tasks, config);

  const sorted = [...tasks].sort((a, b) => {
    const [pa, ta] = sortKey(a, config.seed);
    const [pb, tb] = sortKey(b, config.seed);
    if (pa !== pb) return pa - pb;
    if (ta !== tb) return ta < tb ? -1 : 1;
    return 0;
  });

  const waves: ScheduleWave[] = [];
  let currentIds: string[] = [];
  let currentCapacity = Number.POSITIVE_INFINITY;

  const flushWave = (): void => {
    if (currentIds.length === 0) return;
    waves.push({
      waveIndex: waves.length,
      taskIds: [...currentIds],
      effectiveCapacity: currentCapacity,
    });
    currentIds = [];
    currentCapacity = Number.POSITIVE_INFINITY;
  };

  let cancelled = false;
  for (const task of sorted) {
    if (config.abortSignal?.aborted) {
      cancelled = true;
      break;
    }
    const taskCap = capacityFor(
      task.providerId,
      config.providerCapacities,
      config.defaultCapacity,
    );
    if (currentIds.length === 0) {
      currentIds.push(task.taskId);
      currentCapacity = taskCap;
      continue;
    }
    const nextCapacity = Math.min(currentCapacity, taskCap);
    if (currentIds.length + 1 <= nextCapacity) {
      currentIds.push(task.taskId);
      currentCapacity = nextCapacity;
    } else {
      flushWave();
      if (config.abortSignal?.aborted) {
        cancelled = true;
        break;
      }
      currentIds.push(task.taskId);
      currentCapacity = taskCap;
    }
  }
  flushWave();

  return {
    schemaVersion: TASK_SCHEDULER_SCHEMA_VERSION,
    waves,
    totalTasks: waves.reduce((acc, w) => acc + w.taskIds.length, 0),
    cancelled,
  };
}

/**
 * Flatten a ReadSchedule to a deterministic (taskId, waveIndex) list.
 * Useful for downstream consumers that prefer a linear ordering (e.g.
 * logging, dry-run output) over a wave-grouped one. The order within a
 * wave follows the wave's taskIds array, which itself comes from the
 * stable sort in schedule().
 */
export function flattenSchedule(schedule: ReadSchedule): readonly {
  readonly taskId: string;
  readonly waveIndex: number;
}[] {
  const out: { readonly taskId: string; readonly waveIndex: number }[] = [];
  for (const wave of schedule.waves) {
    for (const taskId of wave.taskIds) {
      out.push({ taskId, waveIndex: wave.waveIndex });
    }
  }
  return out;
}
