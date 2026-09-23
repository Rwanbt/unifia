// FORK: Phase 3 — Source Control panel (ADR-0005 roadmap).
// Provides a lightweight Git UI: view staged/unstaged changes, stage/unstage
// individual files, write a commit message and commit, push/pull, switch
// branch, and view the recent commit log. Heavy operations (push, pull, commit)
// show inline status so the user sees progress without leaving the panel.
//
// State is kept local — no global store — so the panel is self-contained. It
// is the Code inspector's Git tool (ADR-049).
//
// The SDK `Git` class mirrors the routes in `server/routes/git.ts`.
// @thread-safety all operations run on the main thread; no audio/RT concerns.
import {
  For,
  Show,
  createEffect,
  createMemo,
  on,
  onMount,
  type Component,
} from "solid-js"
import { createStore } from "solid-js/store"
import { getFilename } from "@unifia/util/path"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import type { GitBranchEntry, GitCommitEntry, GitOpResult, GitWorkingStatusEntry } from "../types/sdk-shim"

// ─── Types ────────────────────────────────────────────────────────────────────

type FileStatus = {
  path: string
  // git status X/Y codes flattened to a display kind
  kind: "modified" | "added" | "deleted" | "renamed" | "untracked" | "other"
  staged: boolean
}

type SourceControlState = {
  loading: boolean
  files: FileStatus[]
  branches: GitBranchEntry[]
  log: GitCommitEntry[]
  logLoading: boolean
  commitMessage: string
  busy: string | null // label of the running operation
  lastError: string | null
  lastSuccess: string | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function statusKind(code: string): FileStatus["kind"] {
  if (code === "??") return "untracked"
  if (code.includes("A") && !code.includes("D")) return "added"
  if (code.includes("D") && !code.includes("A")) return "deleted"
  if (code.includes("R")) return "renamed"
  if (code.includes("M") || code.includes("U")) return "modified"
  return "other"
}

function kindLabel(kind: FileStatus["kind"]): string {
  return { modified: "M", added: "A", deleted: "D", renamed: "R", untracked: "U", other: "?" }[kind]
}

// ─── Component ───────────────────────────────────────────────────────────────

export const SourceControl: Component<{
  directory?: string
  onOpenFile?: (path: string) => void
}> = (props) => {
  const language = useLanguage()
  const sdk = useSDK()

  const [state, setState] = createStore<SourceControlState>({
    loading: false,
    files: [],
    branches: [],
    log: [],
    logLoading: false,
    commitMessage: "",
    busy: null,
    lastError: null,
    lastSuccess: null,
  })

  const currentBranch = createMemo(() => state.branches.find((b) => b.current)?.name ?? "")
  const staged = createMemo(() => state.files.filter((f) => f.staged))
  const unstaged = createMemo(() => state.files.filter((f) => !f.staged))

  // ── Data loaders ──────────────────────────────────────────────────────────

  const loadStatus = async () => {
    setState("loading", true)
    try {
      const [statusRes, branchRes] = await Promise.all([
        sdk.client.git.workingStatus({ directory: props.directory }),
        sdk.client.git.branches({ directory: props.directory }),
      ])

      const rawFiles = (statusRes.data ?? []) as GitWorkingStatusEntry[]

      const files: FileStatus[] = rawFiles
        .filter((f): f is typeof f & { file: string } => f.file !== undefined)
        .map((f) => {
          // XY code: X = index (staged), Y = worktree (unstaged)
          const x = f.code?.[0] ?? "?"
          const isStaged = x !== " " && x !== "?"
          return {
            path: f.file,
            kind: statusKind(f.code ?? "??"),
            staged: isStaged,
          }
        })

      setState("files", files)
      setState("branches", (branchRes.data ?? []) as GitBranchEntry[])
    } catch (err) {
      setState("lastError", err instanceof Error ? err.message : language.t("sourceControl.statusReadError"))
    } finally {
      setState("loading", false)
    }
  }

  const loadLog = async () => {
    setState("logLoading", true)
    try {
      const res = await sdk.client.git.log({ directory: props.directory, limit: "20" })
      setState("log", (res.data ?? []) as GitCommitEntry[])
    } catch {
      setState("log", [])
    } finally {
      setState("logLoading", false)
    }
  }

  onMount(() => {
    void loadStatus()
    void loadLog()
  })

  // Reload when directory changes
  createEffect(
    on(
      () => props.directory,
      () => {
        void loadStatus()
      },
    ),
  )

  // ── Mutations ─────────────────────────────────────────────────────────────

  const withBusy = async (label: string, fn: () => Promise<void>) => {
    setState("busy", label)
    setState("lastError", null)
    setState("lastSuccess", null)
    try {
      await fn()
    } catch (err) {
      setState("lastError", err instanceof Error ? err.message : String(err))
    } finally {
      setState("busy", null)
    }
  }

  const stageFile = (path: string) =>
    withBusy(language.t("sourceControl.stagingProgress"), async () => {
      await sdk.client.git.add({ directory: props.directory, files: [path] })
      await loadStatus()
    })

  const unstageFile = (path: string) =>
    withBusy(language.t("sourceControl.unstagingProgress"), async () => {
      await sdk.client.git.reset({ directory: props.directory, files: [path] })
      await loadStatus()
    })

  const commitChanges = () =>
    withBusy(language.t("sourceControl.committingProgress"), async () => {
      const msg = state.commitMessage.trim()
      if (!msg) {
        setState("lastError", language.t("sourceControl.emptyCommit"))
        return
      }
      const res = (await sdk.client.git.commit({ directory: props.directory, message: msg })) as {
        data?: { hash?: string; error?: string }
        error?: { error?: string }
      }
      if (res.error?.error) {
        setState("lastError", res.error.error)
        return
      }
      setState("commitMessage", "")
      setState("lastSuccess", language.t("sourceControl.commitSuccess", { hash: res.data?.hash ?? "" }))
      await loadStatus()
      await loadLog()
    })

  const pushChanges = () =>
    withBusy(language.t("sourceControl.pushingProgress"), async () => {
      const res = (await sdk.client.git.push({ directory: props.directory })) as {
        data?: GitOpResult
      }
      const result = res.data
      if (result && !result.ok) {
        setState("lastError", result.error ?? "git push failed")
        return
      }
      setState("lastSuccess", language.t("sourceControl.pushed"))
    })

  const pullChanges = () =>
    withBusy(language.t("sourceControl.pullingProgress"), async () => {
      const res = (await sdk.client.git.pull({ directory: props.directory })) as {
        data?: GitOpResult
      }
      const result = res.data
      if (result && !result.ok) {
        setState("lastError", result.error ?? "git pull failed")
        return
      }
      setState("lastSuccess", language.t("sourceControl.pulled"))
      await loadStatus()
    })

  const switchBranch = (name: string) =>
    withBusy(language.t("sourceControl.checkoutProgress"), async () => {
      await sdk.client.git.branch({
        directory: props.directory,
        name,
        create: false,
      })
      await loadStatus()
    })

  // ── Render ────────────────────────────────────────────────────────────────
  // The reference's Git tool (Code inspector, ADR-049): the changed files,
  // the commit box and the branches, each in a .v57-inspector-card. The
  // recent log stays below them.

  const sortedFiles = createMemo(() => [...unstaged(), ...staged()])
  const localBranches = createMemo(() => state.branches.filter((branch) => !branch.remote))

  return (
    <div data-source-control>
      <Show when={state.busy || state.lastError || state.lastSuccess}>
        <p data-source-status data-tone={state.lastError ? "error" : state.lastSuccess ? "success" : undefined}>
          {state.lastError ?? state.lastSuccess ?? state.busy}
        </p>
      </Show>

      <section data-code-card>
        <h4>{language.t("sourceControl.commit")}</h4>
        <textarea
          data-commit-message
          placeholder={language.t("sourceControl.commitPlaceholder")}
          value={state.commitMessage}
          onInput={(e) => setState("commitMessage", e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              void commitChanges()
            }
          }}
        />
        <div data-code-actions>
          <button
            type="button"
            data-primary
            onClick={() => void commitChanges()}
            disabled={!!state.busy || staged().length === 0 || !state.commitMessage.trim()}
          >
            {language.t("sourceControl.commit")}
          </button>
          <button type="button" onClick={() => void pullChanges()} disabled={!!state.busy}>
            {language.t("sourceControl.pull")}
          </button>
          <button type="button" onClick={() => void pushChanges()} disabled={!!state.busy}>
            {language.t("sourceControl.push")}
          </button>
          <button type="button" onClick={() => void loadStatus()} disabled={state.loading}>
            {language.t("sourceControl.refresh")}
          </button>
        </div>
      </section>

      <section data-code-card>
        <h4>{language.t("sourceControl.cardTitle", { branch: currentBranch() || "—" })}</h4>
        <Show when={state.files.length > 0} fallback={<p data-code-empty>{language.t("sourceControl.noChanges")}</p>}>
          <For each={sortedFiles()}>
            {(file) => (
              <FileRow
                file={file}
                action={file.staged ? "unstage" : "stage"}
                onAction={() => void (file.staged ? unstageFile(file.path) : stageFile(file.path))}
                onOpen={() => props.onOpenFile?.(file.path)}
                busy={!!state.busy}
              />
            )}
          </For>
        </Show>
      </section>

      <section data-code-card>
        <h4>{language.t("sourceControl.branches")}</h4>
        <For each={localBranches()}>
          {(branch) => (
            <button
              type="button"
              data-code-row
              data-current={branch.current ? "" : undefined}
              disabled={!!state.busy}
              onClick={() => {
                if (!branch.current) void switchBranch(branch.name ?? "")
              }}
            >
              <span data-code-glyph>⑂</span>
              <span data-code-label>{branch.current ? <b>{branch.name}</b> : branch.name}</span>
              <small>{branch.current ? language.t("sourceControl.current") : language.t("sourceControl.branch")}</small>
            </button>
          )}
        </For>
      </section>

      <section data-code-card>
        <h4>{language.t("sourceControl.history")}</h4>
        <Show when={!state.logLoading} fallback={<p data-code-empty>{language.t("sourceControl.loading")}</p>}>
          <Show when={state.log.length > 0} fallback={<p data-code-empty>{language.t("sourceControl.noCommits")}</p>}>
            <For each={state.log}>
              {(entry) => (
                <div data-code-row>
                  <span data-code-glyph>●</span>
                  <span data-code-label>{entry.subject}</span>
                  <small>
                    {entry.shortHash} · {formatAge(entry.timestamp, language)}
                  </small>
                </div>
              )}
            </For>
          </Show>
        </Show>
      </section>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FileRow(props: {
  file: FileStatus
  action: "stage" | "unstage"
  onAction: () => void
  onOpen: () => void
  busy: boolean
}) {
  const language = useLanguage()
  const filename = () => getFilename(props.file.path)

  return (
    <div data-code-row>
      <span data-git-status={kindLabel(props.file.kind)}>{kindLabel(props.file.kind)}</span>
      <button type="button" data-file-link title={props.file.path} onClick={props.onOpen}>
        <b>{filename()}</b>
      </button>
      <button type="button" data-row-action onClick={props.onAction} disabled={props.busy}>
        {props.action === "stage" ? language.t("sourceControl.stageAction") : language.t("sourceControl.unstageAction")}
      </button>
    </div>
  )
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatAge(unixSeconds: number, language: ReturnType<typeof useLanguage>): string {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds
  if (diff < 60) return language.t("sourceControl.justNow")
  if (diff < 3600) return language.t("sourceControl.minutesAgo", { count: Math.floor(diff / 60) })
  if (diff < 86400) return language.t("sourceControl.hoursAgo", { count: Math.floor(diff / 3600) })
  if (diff < 86400 * 30) return language.t("sourceControl.daysAgo", { count: Math.floor(diff / 86400) })
  return new Date(unixSeconds * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
}
