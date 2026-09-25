import type { FileDiff, Project, UserMessage } from "../types/sdk-shim"
import { useDialog } from "@unifia/ui/context/dialog"
import { Icon } from "@unifia/ui/icon"
import { IconButton } from "@unifia/ui/icon-button"
import { Tooltip } from "@unifia/ui/tooltip"
import { getFilename } from "@unifia/util/path"
import { getWorkerPool } from "@unifia/ui/pierre/worker"
import { useMutation } from "@tanstack/solid-query"
import {
  Show,
  Match,
  Switch,
  Suspense,
  createMemo,
  createEffect,
  createSignal,
  createComputed,
  lazy,
  on,
  onMount,
  untrack,
  type JSX,
} from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { useLocal } from "@/context/local"
import { useFile } from "@/context/file"
import { createStore, produce } from "solid-js/store"
import { createSessionScroll } from "@/pages/session/session-scroll"
import { showToast } from "@unifia/ui/toast"
import { useNavigate, useSearchParams } from "@solidjs/router"
import { NewSessionView, SessionHeader } from "@/components/session"
import { SessionTimelineSection } from "@/pages/session/session-timeline-section"
import { buildFollowupDockProps } from "@/pages/session/followup-dock-props"
import { buildRevertDockProps } from "@/pages/session/revert-dock-props"
import { useComments } from "@/context/comments"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"
import { useTerminal } from "@/context/terminal"
import { useWorkspaceWorkbench } from "@/context/workbench/provider"
import { createSessionComposerState, SessionComposerRegion } from "@/pages/session/composer"
import { createOpenReviewFile, createSessionTabs, createSizing } from "@/pages/session/helpers"
import { useSessionLayout } from "@/pages/session/session-layout"
import { syncSessionModel } from "@/pages/session/session-model-helpers"
import { SessionSidePanelSection } from "@/pages/session/session-side-panel-section"
import { SessionEditorSurface } from "@/pages/session/session-editor-surface"
import { useMode } from "@/context/mode"
import { WorkSurface } from "@/pages/workbench/work-surface"
import { MODE_LOADERS } from "@/pages/workbench-mode-loader"
import { SessionArtifactViewerSection } from "@/pages/session/session-artifact-viewer-section"
import { SessionParentBack, SessionTitleMenu } from "@/pages/session/session-title-menu"
import { TerminalPanel } from "@/pages/session/terminal-panel"
import { KeyboardHintsBar } from "@/components/keyboard-hints-bar"
import { useSessionCommands } from "@/pages/session/use-session-commands"
import { useSessionHashScroll } from "@/pages/session/use-session-hash-scroll"
import { DesktopChatSeparator } from "@/pages/session/desktop-chat-separator"
import { splitChatWidth } from "@/pages/session/chat-width"
import { createCommentActions } from "@/pages/session/session-comment-actions"
import { createKeyboardHandler } from "@/pages/session/session-keyboard"
import { createVcsHelpers, type VcsMode } from "@/pages/session/session-vcs"
import { createSessionSyncEffects } from "@/pages/session/session-sync-effects"
import { createReviewHelpers } from "@/pages/session/session-review-helpers"
import {
  createFollowupState,
  type FollowupStore,
} from "@/pages/session/session-followup-state"
import { createSessionMutations } from "@/pages/session/session-mutations"
import { Persist, persisted } from "@/utils/persist"
import { same } from "@/utils/same"
import { formatServerError } from "@/utils/server-errors"
import { useViewMode } from "@/hooks/use-view-mode"
import { useShell, useViewport } from "@/shell/v110-store"
import { useArtifactLoader } from "@/pages/session/use-artifact-loader"
import { usePromptInitializer } from "@/pages/session/use-prompt-initializer"
import { SettingsSurface } from "@/pages/settings/settings-surface"
import { UserSurface } from "@/pages/settings/user-surface"
import { BrowserSurface } from "@/pages/workbench/browser-surface"
import { MemorySurface } from "@/pages/workbench/memory-surface"

const MAIN_PANE_DESTINATIONS: ReadonlySet<string> = new Set(["settings", "user", "browser", "memory"])
const emptyUserMessages: UserMessage[] = []

type ChangeMode = "git" | "branch" | "session" | "turn"

// The chat pane above (composer, timeline, header) is identical across every
// shell mode -- one shared conversation, per the maquette and an explicit
// product decision (2026-09-22) reversing the earlier per-mode chats
// (pages/workbench-chat.tsx's WorkbenchChat, which created a *separate*
// session per mode). Only the main/right content swaps by mode. Design and
// Automate stay lazy (F10, workbench-mode-loader.ts) so a Code or Work
// session never pays for their chunks; Work is bundled eagerly already, so
// WorkSurface imports straight.
const DesignSurface = lazy(
  () => MODE_LOADERS.design.load() as Promise<{ default: (props: Record<string, never>) => JSX.Element }>,
)
const AutomateSurface = lazy(
  () => MODE_LOADERS.automate.load() as Promise<{ default: (props: Record<string, never>) => JSX.Element }>,
)

export default function Page() {
  const globalSync = useGlobalSync()
  const layout = useLayout()
  const local = useLocal()
  const file = useFile()
  const sync = useSync()
  const dialog = useDialog()
  const language = useLanguage()
  const sdk = useSDK()
  const settings = useSettings()
  const prompt = usePrompt()
  const comments = useComments()
  const terminal = useTerminal()
  const [searchParams, setSearchParams] = useSearchParams<{ prompt?: string }>()
  const navigate = useNavigate()
  const _workbench = useWorkspaceWorkbench()
  // Read-only capture of the message-timeline scroll viewport for
  // PromptIndex (A3-01). Wraps setScrollRef below rather than reaching
  // into createSessionScroll/createAutoScroll internals: this signal
  // has no write path back into the existing scroll machinery.
  const [scrollEl, setScrollEl] = createSignal<HTMLDivElement>()
  const { params, sessionKey, tabs, view } = useSessionLayout()
  const mode = useMode()
  // FORK: ADR-0005 dual-mode layout effect (Agent ⇄ IDE toggle).
  useViewMode()

  const { artifactDocument, artifactError } = useArtifactLoader(() => (searchParams as { artifact?: string }).artifact)

  usePromptInitializer({
    prompt,
    hasSessionId: () => Boolean(params.id),
    searchParams: () => searchParams as { prompt?: string },
    setSearchParams: (next) => setSearchParams(next as Parameters<typeof setSearchParams>[0]),
  })

  const [ui, setUi] = createStore({
    pendingMessage: undefined as string | undefined,
    scrollGesture: 0,
    scroll: {
      overflow: false,
      bottom: true,
      jump: false,
    },
  })

  const composer = createSessionComposerState()

  const workspaceKey = createMemo(() => params.dir ?? "")
  const workspaceTabs = createMemo(() => layout.tabs(workspaceKey))

  createEffect(
    on(
      () => params.id,
      (id, prev) => {
        if (!id) return
        if (prev) return

        const pending = layout.handoff.tabs()
        if (!pending) return
        if (Date.now() - pending.at > 60_000) {
          layout.handoff.clearTabs()
          return
        }

        if (pending.id !== id) return
        layout.handoff.clearTabs()
        if (pending.dir !== (params.dir ?? "")) return

        const from = workspaceTabs().tabs()
        if (from.all.length === 0 && !from.active) return

        const current = tabs().tabs()
        if (current.all.length > 0 || current.active) return

        const all = normalizeTabs(from.all)
        const active = from.active ? normalizeTab(from.active) : undefined
        tabs().setAll(all)
        tabs().setActive(active && all.includes(active) ? active : all[0])

        workspaceTabs().setAll([])
        workspaceTabs().setActive(undefined)
      },
      { defer: true },
    ),
  )

  const shell = useShell(useViewport())
  const isDesktop = createMemo(() => shell.kind() !== "overlay")
  const platformCtx = usePlatform()
  const isMobileDevice = createMemo(() => platformCtx.platform === "mobile")
  const size = createSizing()
  const desktopInspectorOpen = createMemo(
    () => isDesktop() && (layout.inspector.opened() || layout.hover.inspector.active()),
  )
  // Every inspector tab owns the same fixed-width track. The active tab only
  // changes the content; it must never change the workspace geometry.
  const desktopInspectorWide = createMemo(() => desktopInspectorOpen())
  // The layout shown: a stored Split on a portrait tablet or phone, which
  // does not offer it, shows the main surface (fitLayout).
  const workspaceView = createMemo(() => shell.fit(view().workspace.current()))
  const sessionPanelWidth = createMemo(() => {
    // The editor view collapses only the chat surface. The Inspector remains
    // independently open and keeps its own fixed track when visible.
    // Every session mode uses the same Chat/Split/Editor switch. The active
    // mode changes the main surface content, never the workspace geometry.
    const current = workspaceView()
    // Chat and Editor share the phone screen as exclusive views. Keeping both
    // in the vertical stack let the composer paint over the editor surface.
    // Main-pane destinations use that same full-screen Editor track.
    if (current === "main") return "0px"
    // Wide Chat layout: the surface is the focused column itself, centred on
    // the window by v110-chat.css, so switching layouts animates one box's
    // left edge and width like the reference (ADR-053).
    if (current === "chat" && shell.kind() === "grid") return "var(--v110-chat-column)"
    if (isDesktop() && current === "split")
      return splitChatWidth({
        resized: layout.session.resized(),
        width: layout.session.width(),
        compact: shell.kind() === "single",
        sidePanelOpen: layout.sidebar.opened() || desktopInspectorOpen(),
      })
    if (!desktopInspectorOpen()) return "100%"
    if (isMobileDevice()) return "50%"
    // The inspector card also takes its outer and inner gutters.
    return `calc(100% - ${layout.inspector.width()}px - var(--v110-inspector-margins))`
  })
  // The chat is one pane shared by every mode, so every mode focuses it the
  // same way in the Chat layout (ADR-053).
  const centered = createMemo(() => isDesktop() && workspaceView() === "chat")
  const [chatSurface, setChatSurface] = createSignal<HTMLDivElement>()
  const [workspaceMain, setWorkspaceMain] = createSignal<HTMLDivElement>()

  // Settings, account, browser and memory render in the main pane, which the
  // Chat layout hides entirely; opening one from Chat used to change only the
  // breadcrumb. Like the reference's demo, show it beside the chat instead.
  // Only a destination change reacts, so picking Chat afterwards still works.
  createEffect(
    on(
      () => mode.destination(),
      (destination) => {
        if (!MAIN_PANE_DESTINATIONS.has(destination)) return
        if (view().workspace.current() === "chat") view().workspace.set("split")
      },
    ),
  )

  function normalizeTab(tab: string) {
    if (!tab.startsWith("file://")) return tab
    return file.tab(tab)
  }

  function normalizeTabs(list: string[]) {
    const seen = new Set<string>()
    const next: string[] = []
    for (const item of list) {
      const value = normalizeTab(item)
      if (seen.has(value)) continue
      seen.add(value)
      next.push(value)
    }
    return next
  }

  const openReviewPanel = () => {
    layout.inspector.setTab("inspector")
    if (!layout.inspector.opened()) layout.inspector.open()
  }

  const info = createMemo(() => (params.id ? sync.session.get(params.id) : undefined))
  const diffs = createMemo(() => (params.id ? (sync.data.session_diff[params.id] ?? []) : []))
  const sessionCount = createMemo(() => Math.max(info()?.summary?.files ?? 0, diffs().length))
  const hasSessionReview = createMemo(() => sessionCount() > 0)
  const canReview = createMemo(() => !!sync.project)
  const reviewTab = createMemo(() => isDesktop())
  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab,
    review: reviewTab,
    hasReview: canReview,
  })
  const _contextOpen = tabState.contextOpen
  const _openedTabs = tabState.openedTabs
  const activeTab = tabState.activeTab
  const activeFileTab = tabState.activeFileTab
  const revertMessageID = createMemo(() => info()?.revert?.messageID)
  const messages = createMemo(() => (params.id ? (sync.data.message[params.id] ?? []) : []))
  const messagesReady = createMemo(() => {
    const id = params.id
    if (!id) return true
    return sync.data.message[id] !== undefined
  })
  const historyMore = createMemo(() => {
    const id = params.id
    if (!id) return false
    return sync.session.history.more(id)
  })
  const historyLoading = createMemo(() => {
    const id = params.id
    if (!id) return false
    return sync.session.history.loading(id)
  })
  const diffsReady = createMemo(() => {
    const id = params.id
    if (!id) return true
    if (!hasSessionReview()) return true
    return sync.data.session_diff[id] !== undefined
  })

  const userMessages = createMemo(
    () => messages().filter((m) => m.role === "user") as UserMessage[],
    emptyUserMessages,
    { equals: same },
  )
  const visibleUserMessages = createMemo(
    () => {
      const revert = revertMessageID()
      if (!revert) return userMessages()
      return userMessages().filter((m) => m.id < revert)
    },
    emptyUserMessages,
    {
      equals: same,
    },
  )
  const lastUserMessage = createMemo(() => visibleUserMessages().at(-1))

  createEffect(() => {
    const tab = activeFileTab()
    if (!tab) return

    const path = file.pathFromTab(tab)
    // Force: between two activations of the same tab the file may have
    // changed (external edit, another session, save-then-close-then-reopen).
    // Without force, the cache hit at file.tsx:166 returns the stale
    // pre-change content. Cost: one file.read per tab activation.
    if (path) file.load(path, { force: true })
  })

  createEffect(
    on(
      () => lastUserMessage()?.id,
      () => {
        const msg = lastUserMessage()
        if (!msg) return
        syncSessionModel(local, msg)
      },
    ),
  )

  createEffect(
    on(
      () => ({ dir: params.dir, id: params.id }),
      (next, prev) => {
        if (!prev) return
        if (next.dir === prev.dir && next.id === prev.id) return
        if (prev.id && !next.id) local.session.reset()
      },
      { defer: true },
    ),
  )

  const [store, setStore] = createStore({
    messageId: undefined as string | undefined,
    changes: "git" as ChangeMode,
    newSessionWorktree: "main",
    deferRender: false,
  })

  const [vcs, setVcs] = createStore({
    diff: {
      git: [] as FileDiff[],
      branch: [] as FileDiff[],
    },
    ready: {
      git: false,
      branch: false,
    },
  })

  const [followup, setFollowup] = persisted(
    Persist.workspace(sdk.directory, "followup", ["followup.v1"]),
    createStore<FollowupStore>({
      items: {},
      failed: {},
      paused: {},
      edit: {},
    }),
  )

  createComputed((prev) => {
    const key = sessionKey()
    if (key !== prev) {
      setStore("deferRender", true)
      requestAnimationFrame(() => {
        setTimeout(() => setStore("deferRender", false), 0)
      })
    }
    return key
  }, sessionKey())

  const { resetVcs, loadVcs } = createVcsHelpers({ sync, vcs, setVcs, sdk })

  const refreshVcs = () => {
    resetVcs()
    const mode = untrack(vcsMode)
    if (!mode) return
    if (!untrack(wantsReview)) return
    void loadVcs(mode, true)
  }

  const turnDiffs = createMemo(() => lastUserMessage()?.summary?.diffs ?? [])
  const changesOptions = createMemo<ChangeMode[]>(() => {
    const list: ChangeMode[] = []
    if (sync.project?.vcs === "git") list.push("git")
    if (
      sync.project?.vcs === "git" &&
      sync.data.vcs?.branch &&
      sync.data.vcs?.default_branch &&
      sync.data.vcs.branch !== sync.data.vcs.default_branch
    ) {
      list.push("branch")
    }
    list.push("session", "turn")
    return list
  })
  const vcsMode = createMemo<VcsMode | undefined>(() => {
    if (store.changes === "git" || store.changes === "branch") return store.changes
  })
  const reviewDiffs = createMemo(() => {
    if (store.changes === "git") return vcs.diff.git
    if (store.changes === "branch") return vcs.diff.branch
    if (store.changes === "session") return diffs()
    return turnDiffs()
  })
  const reviewCount = createMemo(() => {
    if (store.changes === "git") return vcs.diff.git.length
    if (store.changes === "branch") return vcs.diff.branch.length
    if (store.changes === "session") return sessionCount()
    return turnDiffs().length
  })
  const hasReview = createMemo(() => reviewCount() > 0)
  const reviewReady = createMemo(() => {
    if (store.changes === "git") return vcs.ready.git
    if (store.changes === "branch") return vcs.ready.branch
    if (store.changes === "session") return !hasSessionReview() || diffsReady()
    return true
  })

  const newSessionWorktree = createMemo(() => {
    if (store.newSessionWorktree === "create") return "create"
    const project = sync.project
    if (project && sdk.directory !== project.worktree) return sdk.directory
    return "main"
  })

  const setActiveMessage = (message: UserMessage | undefined) => {
    messageMark = scrollMark
    setStore("messageId", message?.id)
  }

  const anchor = (id: string) => `message-${id}`

  const cursor = () => {
    const root = scroller
    if (!root) return store.messageId

    const box = root.getBoundingClientRect()
    const line = box.top + 100
    const list = [...root.querySelectorAll<HTMLElement>("[data-message-id]")]
      .map((el) => {
        const id = el.dataset.messageId
        if (!id) return

        const rect = el.getBoundingClientRect()
        return { id, top: rect.top, bottom: rect.bottom }
      })
      .filter((item): item is { id: string; top: number; bottom: number } => !!item)

    const shown = list.filter((item) => item.bottom > box.top && item.top < box.bottom)
    const hit = shown.find((item) => item.top <= line && item.bottom >= line)
    if (hit) return hit.id

    const near = [...shown].sort((a, b) => {
      const da = Math.abs(a.top - line)
      const db = Math.abs(b.top - line)
      if (da !== db) return da - db
      return a.top - b.top
    })[0]
    if (near) return near.id

    return list.filter((item) => item.top <= line).at(-1)?.id ?? list[0]?.id ?? store.messageId
  }

  function navigateMessageByOffset(offset: number) {
    const msgs = visibleUserMessages()
    if (msgs.length === 0) return

    const current = store.messageId && messageMark === scrollMark ? store.messageId : cursor()
    const base = current ? msgs.findIndex((m) => m.id === current) : msgs.length
    const currentIndex = base === -1 ? msgs.length : base
    const targetIndex = currentIndex + offset
    if (targetIndex < 0 || targetIndex > msgs.length) return

    if (targetIndex === msgs.length) {
      resumeScroll()
      return
    }

    autoScroll.pause()
    scrollToMessage(msgs[targetIndex], "auto")
  }

  const sessionEmptyKey = createMemo(() => {
    const project = sync.project
    if (project && !project.vcs) return "session.review.noVcs"
    if (sync.data.config?.snapshot === false) return "session.review.noSnapshot"
    return "session.review.empty"
  })

  function upsert(next: Project) {
    const list = globalSync.data.project
    sync.set("project", next.id)
    const idx = list.findIndex((item) => item.id === next.id)
    if (idx >= 0) {
      globalSync.set(
        "project",
        produce((draft) => {
          Object.assign(draft[idx], next)
        }),
      )
      return
    }
    const at = list.findIndex((item) => item.id > next.id)
    if (at >= 0) {
      globalSync.set(
        "project",
        produce((draft) => {
          draft.splice(at, 0, next)
        }),
      )
      return
    }
    globalSync.set(
      "project",
      produce((draft) => {
        draft.push(next)
      }),
    )
  }

  const gitMutation = useMutation(() => ({
    mutationFn: () => sdk.client.project.initGit(),
    onSuccess: (x) => {
      if (!x.data) return
      upsert(x.data)
    },
    onError: (err) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(err, language.t),
      })
    },
  }))

  function initGit() {
    if (gitMutation.isPending) return
    gitMutation.mutate()
  }

  let inputRef!: HTMLDivElement
  let promptDock: HTMLDivElement | undefined
  let dockHeight = 0
  let scroller: HTMLDivElement | undefined
  let scrollMark = 0
  let messageMark = 0

  const scrollGestureWindowMs = 250

  const markScrollGesture = (target?: EventTarget | null) => {
    const root = scroller
    if (!root) return

    const el = target instanceof Element ? target : undefined
    const nested = el?.closest("[data-scrollable]")
    if (nested && nested !== root) return

    setUi("scrollGesture", Date.now())
  }

  const hasScrollGesture = () => Date.now() - ui.scrollGesture < scrollGestureWindowMs

  createEffect(
    on(
      () => visibleUserMessages().at(-1)?.id,
      (lastId, prevLastId) => {
        if (lastId && prevLastId && lastId > prevLastId) {
          setStore("messageId", undefined)
        }
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      sessionKey,
      () => {
        setStore("messageId", undefined)
        setStore("changes", "git")
        setUi("pendingMessage", undefined)
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => sdk.directory,
      () => {
        resetVcs()
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => [sync.data.vcs?.branch, sync.data.vcs?.default_branch] as const,
      (next, prev) => {
        if (prev === undefined || same(next, prev)) return
        refreshVcs()
      },
      { defer: true },
    ),
  )


  createEffect(
    on(
      () => params.dir,
      (dir) => {
        if (!dir) return
        setStore("newSessionWorktree", "main")
      },
      { defer: true },
    ),
  )

  const {
    addCommentToContext,
    updateCommentInContext,
    removeCommentFromContext,
    reviewCommentActions,
  } = createCommentActions({ file, comments, prompt, language })

  const { handleKeyDown } = createKeyboardHandler({
    dialog,
    view,
    terminal,
    composer,
    getInputRef: () => inputRef,
    markScrollGesture,
  })

  const mobileChanges = createMemo(() => false)
  const wantsReview = createMemo(() =>
    isDesktop()
      ? (desktopInspectorOpen() && layout.inspector.tab() === "explorer") ||
        (desktopInspectorWide() && activeTab() === "review")
      : false,
  )

  createEffect(() => {
    const list = changesOptions()
    if (list.includes(store.changes)) return
    const next = list[0]
    if (!next) return
    setStore("changes", next)
  })

  const explorerView = () => layout.inspector.explorerView()

  createSessionSyncEffects({
    sdk,
    sync,
    globalSync,
    layout,
    file,
    params,
    sessionKey,
    vcsMode,
    wantsReview,
    composer,
    loadVcs,
    refreshVcs,
    activeFileTab,
    explorerView,
    isVcsReady: (mode) => vcs.ready[mode],
  })

  const [tree, setTree] = createStore({
    reviewScroll: undefined as HTMLDivElement | undefined,
    pendingDiff: undefined as string | undefined,
    activeDiff: undefined as string | undefined,
  })

  createEffect(
    on(
      sessionKey,
      () => {
        setTree({
          reviewScroll: undefined,
          pendingDiff: undefined,
          activeDiff: undefined,
        })
      },
      { defer: true },
    ),
  )

  const showAllFiles = () => {
    if (explorerView() !== "changed") return
    layout.inspector.setExplorerView("all")
  }

  const focusInput = () => inputRef?.focus()

  useSessionCommands({
    navigateMessageByOffset,
    setActiveMessage,
    focusInput,
    review: reviewTab,
  })

  const openReviewFile = createOpenReviewFile({
    showAllFiles,
    tabForPath: file.tab,
    openTab: tabs().open,
    setActive: tabs().setActive,
    loadFile: file.load,
  })

  const { reviewEmptyText, reviewContent, reviewPanel, focusReviewDiff } =
    createReviewHelpers({
      canReview,
      language,
      changesOptions,
      store,
      onSelectChange: (value) => setStore("changes", value),
      reviewReady,
      hasSessionReview,
      diffsReady,
      sessionEmptyKey,
      reviewDiffs,
      view,
      tree,
      setTree,
      addCommentToContext,
      updateCommentInContext,
      removeCommentFromContext,
      reviewCommentActions,
      file,
      comments,
      openReviewFile,
      openReviewPanel,
      layout,
      gitMutation,
      initGit,
    })

  createEffect(
    on(
      activeFileTab,
      (active) => {
        if (!active) return
        if (explorerView() !== "changed") return
        showAllFiles()
      },
      { defer: true },
    ),
  )


  const {
    autoScroll,
    scheduleScrollState,
    setScrollRef,
    setContentRef,
    markUserScroll,
    historyWindow,
    fill,
  } = createSessionScroll({
    params,
    messagesReady,
    messages,
    visibleUserMessages,
    historyMore,
    historyLoading,
    sync,
    onAutoScrollReset: () => {
      setStore("messageId", undefined)
    },
    getScrollState: () => ui.scroll,
    setScrollState: (next) => setUi("scroll", next),
    onScrollerRefChange: (el) => { scroller = el },
  })

  const resumeScroll = () => {
    setStore("messageId", undefined)
    autoScroll.forceScrollToBottom()
    clearMessageHash()

    const el = scroller
    if (el) scheduleScrollState(el)
  }

  // When the user returns to the bottom, treat the active message as "latest".
  createEffect(
    on(
      autoScroll.userScrolled,
      (scrolled) => {
        if (scrolled) return
        setStore("messageId", undefined)
        clearMessageHash()
      },
      { defer: true },
    ),
  )

  const { fail, busy, reverting, restoring, restore, rolled, actions } = createSessionMutations({
    sdk,
    sync,
    params,
    info,
    prompt,
    userMessages,
    revertMessageID,
    language,
    navigate,
  })

  const {
    editingFollowup,
    sendingFollowup,
    queueEnabled,
    queueFollowup,
    followupDock,
    sendFollowup,
    editFollowup,
    clearFollowupEdit,
  } = createFollowupState({
    sessionID: () => params.id,
    followup,
    setFollowup,
    sdk,
    sync,
    globalSync,
    settings,
    language,
    composer,
    isBusy: busy,
    resumeScroll,
    onError: fail,
  })


  createResizeObserver(
    () => promptDock,
    ({ height }) => {
      const next = Math.ceil(height)

      if (next === dockHeight) return

      const el = scroller
      const delta = next - dockHeight
      const stick = el
        ? !autoScroll.userScrolled() || el.scrollHeight - el.clientHeight - el.scrollTop < 10 + Math.max(0, delta)
        : false

      dockHeight = next

      if (stick) autoScroll.forceScrollToBottom()

      if (el) scheduleScrollState(el)
      fill()
    },
  )

  const { clearMessageHash, scrollToMessage } = useSessionHashScroll({
    sessionKey,
    sessionID: () => params.id,
    messagesReady,
    visibleUserMessages,
    historyMore,
    historyLoading,
    loadMore: (sessionID) => sync.session.history.loadMore(sessionID),
    turnStart: historyWindow.turnStart,
    currentMessageId: () => store.messageId,
    pendingMessage: () => ui.pendingMessage,
    setPendingMessage: (value) => setUi("pendingMessage", value),
    setActiveMessage,
    setTurnStart: historyWindow.setTurnStart,
    autoScroll,
    scroller: () => scroller,
    anchor,
    scheduleScrollState,
    consumePendingMessage: layout.pendingMessage.consume,
  })

  createEffect(
    on(
      () => params.id,
      (id) => {
        if (!id) requestAnimationFrame(() => inputRef?.focus())
      },
    ),
  )

  onMount(() => {
    makeEventListener(document, "keydown", handleKeyDown)
    // FORK (PLAN-READONLY-VIEWER-REACTIVITY Phase 7 / CORRECTIF F9,
    // 2026-07-19): getWorkerPool() is memoized module-level (safe to call
    // repeatedly) — pre-warming here hides the Shiki-WASM/Worker cold-start
    // behind normal session navigation instead of paying it synchronously on
    // the first file open. Real-device finding (Android WebView, slower
    // Worker/WASM boot than desktop): colors on the first file opened in a
    // session lag noticeably behind content.
    //
    // Only "unified" is pre-warmed — the read-only viewer's pool. "split"
    // (the diff/review viewer) may never open in a given session, so it
    // stays lazy, created on first actual use. Deferred to idle so it never
    // competes with session mount work, and best-effort: a worker/WASM boot
    // failure here must never surface as an unhandled rejection or block
    // the session from opening.
    const warmUnifiedWorkerPool = () => {
      try {
        getWorkerPool("unified")
      } catch {
        // pre-warm is best-effort — the pool is created lazily again on
        // first real use if this failed.
      }
    }
    if (typeof requestIdleCallback !== "undefined") requestIdleCallback(warmUnifiedWorkerPool)
    else warmUnifiedWorkerPool()
  })


  // Reference `.mode-chat-head`'s scope badge: project name plus the active
  // branch, read from the same sources session-new-view.tsx already uses so
  // the two surfaces never disagree about what "the current project" is.
  const chatScopeLabel = createMemo(() => {
    const root = sync.project?.worktree ?? sdk.directory
    const project = getFilename(root)
    const branch = sync.data.vcs?.branch
    return branch ? `${project} / ${branch}` : project
  })

  const copyConversationContext = async () => {
    const root = scrollEl()
    if (!root) return
    const nodes = root.querySelectorAll<HTMLElement>("[data-message-id]")
    const text = [...nodes]
      .map((node) => node.textContent?.trim() ?? "")
      .filter(Boolean)
      .join("\n\n---\n\n")
    if (!text) return
    await navigator.clipboard.writeText(text)
    showToast({ title: language.t("toast.session.contextCopied") })
  }

  return (
    <div data-v110="session-clip" class="relative bg-background-base size-full overflow-clip flex flex-col">
      <SessionHeader />
      <Show when={artifactDocument() || artifactError()}>
        <SessionArtifactViewerSection
          artifactDocument={artifactDocument}
          artifactError={artifactError}
        />
      </Show>
      <div data-component="session-workspace" class="relative flex-1 min-h-0 flex flex-col">
        <div
          ref={setWorkspaceMain}
          data-component="session-workspace-main"
          data-inspector-open={desktopInspectorOpen()}
          class="flex-1 min-h-0 flex flex-col shell:flex-row"
        >
        {/* Session panel */}
        <div
          ref={setChatSurface}
          data-v110="session-chat-surface"
          data-collapsed={sessionPanelWidth() === "0px" ? "" : undefined}
          data-layout={workspaceView()}
          data-side-open={layout.sidebar.opened() || desktopInspectorOpen() ? "" : undefined}
          classList={{
            "@container relative shrink-0 flex flex-col min-h-0 h-full bg-background-stronger flex-1 shell:flex-none": true,
            "transition-[width,margin] duration-[620ms] ease-[cubic-bezier(0.18,0.84,0.22,1)] will-change-[width,margin] motion-reduce:transition-none":
              !size.active(),
          }}
          style={{
            width: sessionPanelWidth(),
          }}
        >
          <Show when={isDesktop() && workspaceView() === "split"}>
            <DesktopChatSeparator
              chat={chatSurface()}
              workspace={workspaceMain()}
              label={language.t("session.chat.resize")}
              onStart={() => size.start()}
              onResize={(width) => {
                size.touch()
                layout.session.resize(width)
              }}
            />
          </Show>
          <div
            data-v110="mode-chat-head"
            class="h-11 shrink-0 flex items-center gap-2 px-1"
            classList={{ "v110-chat-column": centered() }}
          >
            <Show when={params.id ? sync.session.get(params.id)?.parentID : undefined}>
              {(parentID) => <SessionParentBack parentID={parentID()} />}
            </Show>
            <b class="text-12-medium text-text-strong shrink-0">{language.t("session.chat.conversation")}</b>
            <Tooltip value={language.t("session.chat.scope.tooltip")}>
              <span data-v110="chat-scope" class="flex min-w-0 items-center truncate">
                <Icon name="scope" size="small" class="shrink-0" />
                <span class="truncate">{chatScopeLabel()}</span>
              </span>
            </Tooltip>
            <Show when={settings.general.observabilityDomain("trajectory")}>
              <button
                type="button"
                data-v110="trajectory-btn"
                onClick={() => {
                  layout.inspector.setTab("execution")
                  layout.inspector.open()
                }}
              >
                <Icon name="trajectory" size="small" />
                <span>{language.t("session.chat.trajectory")}</span>
              </button>
            </Show>
            <Show when={params.id}>{(id) => <SessionTitleMenu sessionID={id()} />}</Show>
            <div class="flex-1" />
          </div>
          <div class="relative flex-1 min-h-0 overflow-hidden">
            <Switch>
              <Match when={params.id}>
                <Show when={messagesReady()}>
                  <SessionTimelineSection
                    mobileChanges={mobileChanges()}
                    mobileFallback={reviewContent({
                      diffStyle: "unified",
                      classes: { root: "pb-8", header: "px-4", container: "px-4" },
                      loadingClass: "px-4 py-4 text-text-weak",
                      emptyClass: "h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-6",
                    })}
                    actions={actions}
                    scroll={ui.scroll}
                    onResumeScroll={resumeScroll}
                    setScrollRef={(el) => {
                      setScrollRef(el)
                      setScrollEl(el)
                    }}
                    onScheduleScrollState={scheduleScrollState}
                    onAutoScrollHandleScroll={autoScroll.handleScroll}
                    onMarkScrollGesture={markScrollGesture}
                    hasScrollGesture={hasScrollGesture}
                    onUserScroll={markUserScroll}
                    onTurnBackfillScroll={historyWindow.onScrollerScroll}
                    onAutoScrollInteraction={autoScroll.handleInteraction}
                    centered={centered}
                    setContentRef={setContentRef}
                    turnStart={historyWindow.turnStart}
                    historyMore={historyMore}
                    historyLoading={historyLoading}
                    onLoadEarlier={() => {
                      void historyWindow.loadAndReveal()
                    }}
                    renderedUserMessages={() => historyWindow.renderedUserMessages()}
                    visibleUserMessages={visibleUserMessages}
                    messagesReady={messagesReady}
                    scrollEl={scrollEl}
                    anchor={anchor}
                  />
                </Show>
              </Match>
              <Match when={true}>
                <NewSessionView worktree={newSessionWorktree()} />
              </Match>
            </Switch>
          </div>

          <IconButton
            icon="copy"
            variant="ghost"
            size="small"
            data-v110="chat-copy-context"
            aria-label={language.t("session.chat.copyContext")}
            onClick={copyConversationContext}
          />

          <SessionComposerRegion
            state={composer}
            ready={!store.deferRender && messagesReady()}
            centered={centered()}
            inputRef={(el) => {
              inputRef = el
            }}
            newSessionWorktree={newSessionWorktree()}
            onNewSessionWorktreeReset={() => setStore("newSessionWorktree", "main")}
            onSubmit={() => {
              comments.clear()
              resumeScroll()
            }}
            onResponseSubmit={resumeScroll}
            followup={buildFollowupDockProps({
              paramsId: () => params.id,
              queueEnabled,
              followupDock,
              sendingFollowup,
              editingFollowup,
              queueFollowup,
              setFollowup,
              sendFollowup,
              editFollowup,
              clearFollowupEdit,
            })}
            revert={buildRevertDockProps({ rolled, restoring, reverting, restore })}
            setPromptDockRef={(el) => {
              promptDock = el
            }}
          />

        </div>

        {/* WHY a boundary of its own: the lazy Design/Automate chunks and the
            surfaces' queries suspend while they load. Without it the router's
            Suspense caught them and blanked the whole page -- chat included --
            until the slowest query settled (a whole-repo file listing never
            did on a large workspace). */}
        <Suspense>
        <Switch>
          <Match when={mode.destination() === "settings" && workspaceView() !== "chat"}>
            <SettingsSurface />
          </Match>
          <Match when={mode.destination() === "user" && workspaceView() !== "chat"}>
            <UserSurface />
          </Match>
          <Match when={mode.destination() === "browser" && workspaceView() !== "chat"}>
            <BrowserSurface />
          </Match>
          <Match when={mode.destination() === "memory" && workspaceView() !== "chat"}>
            <MemorySurface />
          </Match>
          {/* workbench-mode.tsx had this exact branch before /:mode routed
              here (2026-09-22). Without it, a denied/invalid mode (e.g.
              Automate without workflow.run) silently falls through to the
              mode resolver's own "code" fallback and an empty chat -- no
              feedback that the requested mode never mounted. */}
          <Match when={mode.routeKind() === "invalid"}>
            <section class="size-full p-6" data-workbench-error="invalid-route">
              <h1 class="text-18-medium">{language.t("workbench.errors.invalidMode")}</h1>
              <p class="mt-2 text-14-regular text-text-weak">
                {language.t("workbench.errors.invalidModeDescription")}
              </p>
            </section>
          </Match>
          <Match when={mode.active() === "work" && workspaceView() !== "chat"}>
            <WorkSurface />
          </Match>
          <Match when={mode.active() === "design" && workspaceView() !== "chat"}>
            <DesignSurface />
          </Match>
          <Match when={mode.active() === "automate" && workspaceView() !== "chat"}>
            <AutomateSurface />
          </Match>
          <Match when={workspaceView() !== "chat"}>
            <SessionEditorSurface />
          </Match>
        </Switch>
        </Suspense>

        <SessionSidePanelSection
          canReview={canReview}
          diffs={reviewDiffs}
          diffsReady={reviewReady}
          empty={reviewEmptyText}
          hasReview={hasReview}
          reviewCount={reviewCount}
          reviewPanel={reviewPanel}
          activeDiff={tree.activeDiff}
          focusReviewDiff={focusReviewDiff}
          size={size}
          sessionId={params.id}
          revert={(messageID) => {
            if (params.id) void actions.revert({ sessionID: params.id, messageID })
          }}
          reverting={reverting}
        />

        </div>

        {/* Mobile: absolute overlay anchored to the relative workspace.
            Desktop mounts it inside the Code editor card instead
            (session-editor-surface.tsx), as the v110 maquette does. */}
        <Show when={isMobileDevice()}>
          <TerminalPanel />
        </Show>
      </div>

      {/* FORK: Stretch Phase 6 — keyboard hints bar (tablet + hardware keyboard) */}
      <KeyboardHintsBar />
    </div>
  )
}
