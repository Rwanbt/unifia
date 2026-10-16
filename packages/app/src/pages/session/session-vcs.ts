/**
 * Factory for VCS diff helpers in the session page.
 * Extracted from session.tsx to keep that file under the 1500-LOC budget.
 *
 * NOTE: `refreshVcs` stays in session.tsx because it forward-references
 * `wantsReview` (defined later in the component).  Only the pure I/O
 * helpers — which have no forward dependencies — move here.
 */
import type { FileDiff } from "../../types/sdk-shim"
import type { SetStoreFunction } from "solid-js/store"

export type VcsMode = "git" | "branch"

interface VcsState {
  diff: { git: FileDiff[]; branch: FileDiff[] }
  ready: { git: boolean; branch: boolean }
}

interface VcsDeps {
  sync: { project: { vcs?: string } | null | undefined }
  vcs: VcsState
  setVcs: SetStoreFunction<VcsState>
  sdk: {
    client: {
      vcs: {
        diff: (opts: { mode: VcsMode }) => Promise<{ data?: FileDiff[] | null }>
      }
    }
  }
}

export function createVcsHelpers(deps: VcsDeps) {
  const { sync, vcs, setVcs, sdk } = deps

  const vcsTask = new Map<VcsMode, Promise<void>>()
  const vcsRun = new Map<VcsMode, number>()

  const bumpVcs = (mode: VcsMode) => {
    const next = (vcsRun.get(mode) ?? 0) + 1
    vcsRun.set(mode, next)
    return next
  }

  const resetVcs = (mode?: VcsMode) => {
    const list = mode ? [mode] : (["git", "branch"] as const)
    list.forEach((item) => {
      // Stale-while-revalidate: keep the rendered diff list visible while the
      // refresh is in flight so a transient empty state never collapses the
      // review panel and erases the reader's scroll anchor (see #736, #734).
      // The previously committed list is only replaced when a new fetch resolves.
      bumpVcs(item)
      vcsTask.delete(item)
      setVcs("ready", item, false)
    })
  }

  const loadVcs = (mode: VcsMode, force = false) => {
    if (sync.project?.vcs !== "git") return Promise.resolve()
    if (!force && vcs.ready[mode]) return Promise.resolve()

    if (force) {
      if (vcsTask.has(mode)) bumpVcs(mode)
      vcsTask.delete(mode)
      setVcs("ready", mode, false)
    }

    const current = vcsTask.get(mode)
    if (current) return current

    const run = bumpVcs(mode)

    const task = sdk.client.vcs
      .diff({ mode })
      .then((result) => {
        // Stale-run guard: only the current run's result is committed.
        if (vcsRun.get(mode) !== run) return
        setVcs("diff", mode, result.data ?? [])
        setVcs("ready", mode, true)
      })
      .catch((error) => {
        // Stale-while-revalidate: on failure, keep the prior list so a
        // transient/network error cannot collapse the review panel and
        // erase the reader's scroll anchor. The rest of the async is
        // observed via `ready`, which goes true even when empty data.
        if (vcsRun.get(mode) !== run) return
        console.debug("[session-review] failed to load vcs diff", { mode, error })
        setVcs("ready", mode, true)
      })
      .finally(() => {
        if (vcsTask.get(mode) === task) vcsTask.delete(mode)
      })

    vcsTask.set(mode, task)
    return task
  }

  return { vcsTask, vcsRun, bumpVcs, resetVcs, loadVcs }
}
