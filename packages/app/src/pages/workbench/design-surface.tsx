/* SPDX-License-Identifier: MIT */

import { tDesignApproval } from "@/i18n/design-approval"
import { createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { createQuery } from "@tanstack/solid-query"
import { useLanguage } from "@/context/language"
import { useMode } from "@/context/mode"
import { useSync } from "@/context/sync"
import { useWorkspaceWorkbench } from "@/context/workbench/provider"
import { workbenchQueryKey } from "@/context/workbench/query-keys"
import { createWorkbenchSession } from "@/pages/workbench/workbench-session"
import { DesignWorkspace, githubConnectionLabel, seedDesignTabState } from "@/pages/workbench/design-workspace"
import { DesignWorkshopMenu } from "@/pages/workbench/design-workshop-menu"
import { DesignFilesTab } from "@/pages/workbench/design-files-tab"
import { DesignArtifactTab } from "@/pages/workbench/design-artifact-tab"
import { createDesignComposerAttach } from "@/pages/workbench/design-composer-attach"
import { DesignSpecEditor } from "@/pages/workbench/design-spec-editor"
import { createArtifactStreamController } from "@/pages/workbench/use-artifact-stream"
import { syncDesignArtifactStream } from "@/pages/workbench/design-artifact-stream-sync"
import { ApprovalModal } from "@/pages/workbench/design-approval-modal"
import { ConnectionBanner } from "@/pages/workbench/connection-banner"
import {
  createDesignPreviewPanelState,
  createDesignSpecPanelState,
  renderDesignSpecSvg,
  createArtifactVersionPanelState,
  diffArtifactVersions,
  createIndexedDbDesignDraftStore,
  createIndexedDbCommentStore,
  describeGithubConnection,
  addComment,
  newCommentId,
  DesignDraftConflictError,
  EMPTY_COMMENT_STATE,
  type CommentState,
  type CommentTargetRect,
} from "@unifia/workbench-shell"
import { openTab, type DesignTab } from "@/pages/workbench/design-tabs"
import { TerminalPanel } from "@/pages/session/terminal-panel"
import { DesignBrowserTab } from "@/pages/workbench/design-browser-tab"
import { DesignCanvasTab } from "@/pages/workbench/design-canvas-tab"
import { createDesignSnapshot } from "@/pages/workbench/design-snapshot"
import { createDesignToolbarState } from "@/pages/workbench/design-toolbar-state"
import {
  canStartApproval,
  createApprovalOperations,
  reduceApprovalState,
  type ApprovalEvent,
  type ApprovalState,
} from "@/pages/workbench/design-approval"

export type { ApprovalState, ApprovalEvent } from "@/pages/workbench/design-approval"

export function DesignSurface(): JSX.Element {
  const language = useLanguage()
  const t = language.t
  const mode = useMode()
  const sync = useSync()
  const workbench = useWorkspaceWorkbench()
  const connection = workbench.connection
  createEffect(() => { void workbench.ensureConnected().catch(() => undefined) })
  const manifestQueryOptions = createMemo(() => {
    const current = connection()
    return { queryKey: workbenchQueryKey(current, "design-systems"), enabled: !!current, queryFn: () => current!.client.listDesignSystems(current!.workspaceId) }
  })
  const githubQueryOptions = createMemo(() => {
    const current = connection()
    return { queryKey: workbenchQueryKey(current, "github-status"), enabled: !!current, queryFn: () => current!.client.githubStatus(current!.workspaceId) }
  })
  const manifest = createQuery(manifestQueryOptions)
  const github = createQuery(githubQueryOptions)
  const [source, setSource] = createSignal("")
  const [draftRevision, setDraftRevision] = createSignal<number | undefined>()
  const [draftError, setDraftError] = createSignal<string>()
  const [artifactId, setArtifactId] = createSignal<string>()
  const [saveState, setSaveState] = createSignal<"idle" | "saving" | "saved" | "error">("idle")
  const [saveMessage, setSaveMessage] = createSignal("")
  const [exportState, setExportState] = createSignal<"idle" | "exporting" | "exported" | "error">("idle")
  const [openState, setOpenState] = createSignal<"idle" | "opening" | "opened" | "error">("idle")
  // DA-UI-02 — recoverable approval UX for the create/export flow.
  // The 8-state machine lives here; the modal, the timer, and the
  // navigation-cleanup hook all read it.
  const [approvalState, setApprovalStateRaw] = createSignal<ApprovalState>({ kind: "idle" })
  const setApprovalState = (event: ApprovalEvent) => setApprovalStateRaw((current) => reduceApprovalState(current, event))
  // DA-UI-03 — the in-flight request handle. The `runExportFlow`
  // writes it before the first `await` and clears it on every
  // terminal transition; `onCleanup` (below) calls `abort()` so a
  // navigation away from the Design surface never leaves a half-
  // finished operation talking to the broker.
  let exportAbort: AbortController | undefined
  // DA-UI-03 — the approval TTL timer. Set when the modal opens,
  // cleared when the user acts (allow/deny/cancel) or when the
  // approval state transitions to a terminal state. The timer
  // dispatches the `expire` event, which only takes effect when
  // the state is still `approval-required` (the reducer guards it).
  let approvalExpireTimer: ReturnType<typeof setTimeout> | undefined
  const draftStore = createIndexedDbDesignDraftStore()

  // Phase 3 — `DesignSurface` holds the workshop's tab state. Before phase 3,
  // `DesignWorkspace` owned its own store and `createDesignWorkspaceController`
  // offered a sibling store that no caller ever imported (verified: zero
  // consumers). Two stores means two truths and no way to open an artifact
  // tab from a streaming event. The seed plants the two non-closable tabs
  // ("Fichiers" + "Spec") so the workshop is never empty when the surface
  // mounts.
  const [tabState, setTabState] = createStore(seedDesignTabState())

  // P4-4 — `designContextPreview` (P22) et son placeholder DESIGN.md sont
  // retirés. C'était une étiquette statique de P22 servant à valider
  // l'observabilité du câblage catalogue → preamble ; le câblage est
  // désormais porté par l'agent lui-même, et le fil rend le contenu réel.
  let draftTimer: ReturnType<typeof setTimeout> | undefined
  let draftLoadEpoch = 0

  // P15 — Moteur de streaming des artefacts produits par l'agent Design.
  // L'agent lui-même (capability "design-agent") émettra `artifact:start/chunk/end`
  // via le SDK quand il sera branché ; en attendant, le controller est prêt et
  // exposé au reste de la surface (panneau live + persistance automatique).
  const compactScreen = typeof window !== "undefined" && window.matchMedia?.("(max-width: 767px)").matches === true
  const stream = createArtifactStreamController({ debounceMs: 100 })
  const [streamPersisted, setStreamPersisted] = createSignal<ReadonlySet<string>>(new Set())

  // Phase 4 — ouverture automatique d'un onglet artifact à chaque
  // `artifact:start`. Le Set local mémorise les ids déjà introduits : si
  // l'utilisateur ferme un onglet artifact puis qu'un nouveau chunk arrive
  // pour le même id, on ne le rouvre pas (l'utilisateur a exprimé un
  // choix de navigation explicite). Côté Phase 4, l'agent n'est pas
  // encore branché ; le câblage réel passe par `adaptRenderArtifactEvent`
  // quand l'adaptateur sera consommé par le controller.
  // P3-5 — état du toolbar remonté au niveau de la surface. L'onglet
  // artifact rend `ArtifactPreview` ; le `DesignToolbar` qui le surplombe
  // est piloté ici pour que les sélections (viewport, zoom, mode, snapshot,
  // sélection) survivent à un changement d'onglet puis un retour, et pour
  // qu'une seule instance d'état existe par surface (et non par panneau
  // éphémère, comme avant P3-5).
  // F11 — extracted to `design-toolbar-state.ts` so the surface file
  // stays under the 800-LOC gate. The factory returns the same
  // signals as before; the surface assigns them once and the
  // toolbar receives the accessors + setters as before.
  const { viewport, setViewport, zoom, setZoom, toolbarMode, setToolbarMode, selectMode, setSelectMode } = createDesignToolbarState({
    // A phone previews at its own size first: a 1440 px desktop frame scaled
    // into a 360 px pane is unreadable. The presets stay one tap away.
    viewport: compactScreen ? "mobile" : undefined,
  })
  // F11 — snapshot state machine extracted to `design-snapshot.ts`.
  // The surface holds the controller (so it survives tab switches)
  // and the iframe plugs `setCapture` once mounted. The controller
  // owns Solid signals, so the toolbar re-renders on transitions
  // without a polling tick.
  const snapshotController = createDesignSnapshot()
  // P3-5 / P17 — la fonction de capture vit dans l'iframe (postMessage
  // same-origin impossible depuis l'hôte). `ArtifactPreview` la remonte
  // via `onSnapshotReady` à chaque montage d'iframe ; on la garde ici
  // pour qu'un seul `requestSnapshot` (ci-dessous) puisse la déclencher
  // depuis le toolbar remonté. Une seule instance visible à la fois, donc
  // un seul `capture` survit à un changement d'onglet.
  // F11: now wired through the controller's setCapture slot.
  const setCapture = (fn: (() => Promise<{ dataUrl: string; w: number; h: number }>) | undefined) => {
    snapshotController.setCapture(fn)
  }
  const requestSnapshot = () => snapshotController.requestSnapshot()

  // Phase 8.3/9.6 — visibilité du panneau de commentaires, remontée au
  // même niveau que le reste du toolbar (P3-5) pour survivre à un
  // changement d'onglet. Ouvert par défaut : c'est le comportement
  // observable avant cette phase (le panneau était toujours affiché).
  // On a phone the panel stacks under the preview and halves it; it opens on
  // demand there (toolbar "Comments", or picking an element).
  const [commentPanelOpen, setCommentPanelOpen] = createSignal(!compactScreen)

  // Phase 9.6 — copie la dernière capture dans le presse-papiers, en plus
  // du téléchargement déjà câblé. F11: the copy state machine lives in
  // `design-snapshot.ts`; the toolbar reads `copyState()` and calls
  // `copySnapshot()` on the controller.
  const copySnapshot = () => snapshotController.copySnapshot()

  // P19 + P20 — Panneau de commentaires, rebranché. `CommentState` est un
  // registre plat (chaque `DesignComment` porte son propre `artifactId`),
  // donc un seul signal suffit pour tous les onglets artefact — pas besoin
  // d'un state par onglet. `commentTarget` mémorise le dernier élément
  // piqué (P18) tant qu'aucun autre pick ne le remplace ; il survit à un
  // changement d'onglet volontairement (revenir sur l'artefact retrouve
  // la cible en cours).
  const [commentState, setCommentState] = createSignal<CommentState>(EMPTY_COMMENT_STATE)
  const [commentTarget, setCommentTarget] = createSignal<{ elementId: string; artifactId: string; entryFile: string; rect?: CommentTargetRect }>()
  // Phase 8.1 — clicking a pin scrolls the sidebar to its comment; the
  // scroll target is a DOM id derived from the comment id (see CommentPanel).
  const [highlightedCommentId, setHighlightedCommentId] = createSignal<string>()

  // Phase 8.2 — persistance IndexedDB, même forme que `draftStore` juste en
  // dessous (epoch guard contre une réponse de `load` en retard qui
  // écraserait un changement de workspace plus récent ; sauvegarde
  // debouncée à 250 ms). `updateCommentState` est le seul chemin
  // d'écriture passé en aval (`onCommentChange`) — chaque mutation de
  // `CommentPanel` (add/update/remove/markSent/markResolved) passe par le
  // même `props.onChange`, donc les intercepter tous ici suffit.
  const commentStore = createIndexedDbCommentStore()
  const [commentPersistError, setCommentPersistError] = createSignal<string>()
  let commentLoadEpoch = 0
  let commentSaveTimer: ReturnType<typeof setTimeout> | undefined
  onMount(() => {
    createEffect(() => {
      const workspaceId = connection()?.workspaceId
      if (!workspaceId) return
      const epoch = ++commentLoadEpoch
      void commentStore
        .load(workspaceId)
        .then((state) => {
          if (epoch !== commentLoadEpoch || !state) return
          setCommentState(state)
        })
        .catch((error) => setCommentPersistError(error instanceof Error ? error.message : "design comments could not be loaded"))
    })
  })
  onCleanup(() => {
    if (commentSaveTimer) clearTimeout(commentSaveTimer)
  })
  function updateCommentState(state: CommentState): void {
    setCommentState(state)
    const workspaceId = connection()?.workspaceId
    if (!workspaceId) return
    if (commentSaveTimer) clearTimeout(commentSaveTimer)
    commentSaveTimer = setTimeout(() => {
      void commentStore.save(workspaceId, state).catch((error) => {
        setCommentPersistError(error instanceof Error ? error.message : "design comments could not be saved")
      })
    }, 250)
  }

  function addTokenComment(catalogId: string, elementId: string): void {
    updateCommentState(addComment(commentState(), {
      id: newCommentId(Date.now(), Math.random()),
      artifactId: `design-system:${catalogId}`,
      elementId,
      note: t("design.status.reviewToken", { elementId }),
      status: "open",
      createdAt: new Date().toISOString(),
    }))
  }

  syncDesignArtifactStream({
    stream,
    sessionId: mode.sessionId,
    messages: (sessionId) => sync.data.message[sessionId] ?? [],
    parts: (messageId) => sync.data.part[messageId],
    openArtifactTab: (id, filename) =>
      setTabState(openTab(tabState, { id, kind: "artifact", title: filename, closable: true })),
  })

  // P18 → P19 — callback de pick d'élément dans l'artefact : mémorise la
  // cible pour que `CommentPanel` sache sur quel `data-unifia-id` le
  // prochain "Ajouter" doit s'attacher. Phase 8.1 : le rect du pick est
  // capturé ici aussi, pour que le commentaire créé porte une épingle.
  function onArtifactSelectTarget(elementId: string, artifactId: string, entryFile: string, rect: CommentTargetRect): void {
    setCommentTarget({ elementId, artifactId, entryFile, rect })
    // Picking an element is how a comment starts: show where it goes.
    setCommentPanelOpen(true)
  }
  /**
   * P4-5 — boucle commentaire → raffinement → fil.
   *
   * Le contrat est porté par `createWorkbenchSession` (P1-1) : une seule
   * session par workspace, partagée entre tous les consumers (fil,
   * raffinement, `CommentPanel`). `sendRefinePrompt` est le seul appelant
   * de `refineSession.prompt` ; la réponse de l'agent apparaît dans le fil
   * parce que c'est la même session — pas de câblage supplémentaire côté
   * `WorkbenchThread`. Le test de l'ownership unique vit dans
   * `workbench-session.test.ts`.
   */
  const composer = createDesignComposerAttach()
  const refineSession = createWorkbenchSession({ title: () => t("workbench.chat.design") })
  async function sendRefinePrompt(prompt: string, label: string): Promise<void> {
    setSaveMessage(t("design.status.sending", { label }))
    try {
      await refineSession.prompt(prompt)
      setSaveMessage(t("design.status.promptSent", { label, count: prompt.length }))
    } catch (error) {
      setSaveMessage(t("design.status.sendFailed", { message: error instanceof Error ? error.message : String(error) }))
    }
  }
  let lastConnectionPhase: ReturnType<typeof workbench.phase> | undefined
  createEffect(() => {
    const phase = workbench.phase()
    if (lastConnectionPhase === phase) return
    const wasConnected = lastConnectionPhase === "ready" || lastConnectionPhase === undefined
    if (phase === "failed" || phase === "rolling_back" || phase === "cleanup_failed") {
      // Spec P15 §6 : la connexion qui tombe en cours de flux NE VIDE PAS
      // le rendu déjà obtenu. On pose juste un bandeau ; les byId restent intacts.
      if (wasConnected) stream.setConnectionError(t("workbench.errors.eventStreamDisconnected"))
    } else if (phase === "ready" && !wasConnected) {
      stream.setConnectionError(undefined)
    }
    lastConnectionPhase = phase
  })
  // Persistance automatique : quand une entry passe `complete: true`, on la
  // sauvegarde via `client.createArtifact` avec la provenance `design-agent`.
  // Idempotent : on garde un Set des ids déjà persistés pour éviter les doubles POST.
  createEffect(() => {
    const persisted = streamPersisted()
    const state = stream.state()
    const current = connection()
    if (!current) return
    for (const entry of state.byId.values()) {
      if (!entry.complete || persisted.has(entry.artifactId)) continue
      if (entry.error) continue
      const filename = entry.filename
      const kind = entry.kind
      const content = entry.content
      setStreamPersisted((set) => {
        if (set.has(entry.artifactId)) return set
        const next = new Set(set)
        next.add(entry.artifactId)
        return next
      })
      void current.client
        .createArtifact({
          workspaceId: current.workspaceId,
          kind,
          filename,
          content,
          metadata: { source: "design-agent-stream", sessionId: state.activeId ?? "" },
          provenance: { sourceTool: "design-agent", capabilityPack: "workbench-design" },
        })
        .then((result) => {
          setSaveMessage(
            t("design.status.artifactPersisted", {
              filename: result.artifact.filename,
              version: result.artifact.version,
            }),
          )
        })
        .catch((error) => {
          setSaveMessage(
            t("design.status.persistFailed", { message: error instanceof Error ? error.message : String(error) }),
          )
          setStreamPersisted((set) => {
            const next = new Set(set)
            next.delete(entry.artifactId)
            return next
          })
        })
    }
  })
  // P4-4 — `pushDemoStream` a été retiré : la démo manuelle n'a plus sa
  // place dans la surface. Le vrai câblage agent→artefact passe par
  // `adaptRenderArtifactEvent` (P4-2) branché sur le controller Solid via
  // l'effet P4-3 qui ouvre l'onglet. Tant que l'agent "design-agent" n'est
  // pas branché, la surface n'invente pas d'événements.
  onMount(() => {
    createEffect(() => {
      const workspaceId = connection()?.workspaceId
      if (!workspaceId) return
      const epoch = ++draftLoadEpoch
      void draftStore.load(workspaceId).then((draft) => {
        if (epoch !== draftLoadEpoch || !draft) return
        setSource(draft.source)
        setDraftRevision(draft.revision)
      }).catch((error) => setDraftError(error instanceof Error ? error.message : "design draft could not be loaded"))
    })
  })
  onCleanup(() => { if (draftTimer) clearTimeout(draftTimer) })
  function updateDraft(value: string): void {
    setSource(value)
    const workspaceId = connection()?.workspaceId
    if (!workspaceId) return
    if (draftTimer) clearTimeout(draftTimer)
    draftTimer = setTimeout(() => {
      void draftStore.save(workspaceId, value, draftRevision()).then((draft) => {
        setDraftRevision(draft.revision)
        setDraftError(undefined)
      }).catch((error) => {
        if (error instanceof DesignDraftConflictError) setDraftError("Design draft changed in another window; reload it before editing again")
        else setDraftError(error instanceof Error ? error.message : "design draft could not be saved")
      })
    }, 250)
  }
  const spec = createMemo(() => createDesignSpecPanelState({ kind: "inline", value: source() }))
  const preview = createMemo(() => createDesignPreviewPanelState(spec()))
  const validationQueryOptions = createMemo(() => {
    const current = connection()
    const value = source()
    return {
      queryKey: workbenchQueryKey(current, "spec-validation", { source: value }),
      enabled: !!current && value.trim().length > 0 && spec().diagnostics.length === 0,
      staleTime: 5_000,
      queryFn: () => current!.client.validateSpec(current!.workspaceId, value),
    }
  })
  const historyQueryOptions = createMemo(() => {
    const current = connection()
    const currentArtifactId = artifactId()
    return {
      queryKey: workbenchQueryKey(current, "design-history", { artifactId: currentArtifactId ?? "" }),
      enabled: !!current && !!currentArtifactId,
      queryFn: () => current!.client.artifactHistory(current!.workspaceId, currentArtifactId!),
    }
  })
  const validation = createQuery(validationQueryOptions)
  const history = createQuery(historyQueryOptions)
  async function saveDesignVersion(): Promise<void> {
    const current = connection()
    if (!current || !spec().spec || saveState() === "saving") return
    setSaveState("saving")
    setSaveMessage("")
    try {
      const result = await current.client.createArtifact({
        workspaceId: current.workspaceId,
        kind: "text",
        filename: "design-spec.json",
        content: source(),
        ...(artifactId() ? { artifactId: artifactId() } : {}),
        metadata: { target: "design", specId: spec().spec!.id, specVersion: spec().spec!.version },
        provenance: { sourceTool: "design-editor", capabilityPack: "workbench-design" },
      })
      setArtifactId(result.artifact.artifactId)
      setSaveState("saved")
      setSaveMessage(t("design.status.versionSaved", { version: result.artifact.version }))
      await history.refetch()
    } catch (error) {
      setSaveState("error")
      setSaveMessage(error instanceof Error ? error.message : "design version could not be saved")
    }
  }
  /**
   * DA-UI-02 — `runExportFlow` is the state-machine wrapper around the
   * old `exportDesignRender` call. The pre-DA-UI-02 code did two
   * things wrong: (1) it folded the `202 approvalRequired` response
   * into the same success branch as the nominal `exported` result,
   * leaving the user with no way to allow/deny/retry, and (2) it
   * had no guard against a second concurrent click racing the first
   * (a "double-click" could have queued two requests and confused
   * the broker). The new flow:
   *
   *   1. `canStartApproval` rejects the click when the machine is
   *      mid-flight — this is the DA-UI-03 double-click guard.
   *   2. The first `await` (createArtifact) and second (exportArtifact)
   *      both observe the abort signal so navigating away from the
   *      Design surface tears the operation down cleanly.
   *   3. On `202 approvalRequired` we transition to the
   *      `approval-required` sub-state, schedule the expiry timer,
   *      and render the modal. The user can then allow, deny, or
   *      cancel; the resolve path is `runResolveApproval` below.
   *   4. On any other error, the machine transitions to `failed`
   *      and the surface shows the message.
   *
   * The function is also self-contained so the retry path (after
   * an `allow` decision) calls it recursively from the `resolving`
   * branch of the modal handler.
   */
  async function runExportFlow(): Promise<void> {
    const live = connection()
    const designSpec = spec().spec
    if (!live || !designSpec) return
    // DA-UI-03 — double-click idempotency. A second click while the
    // machine is mid-flight is a no-op (the button is also visually
    // disabled in the spec editor, but the guard here is the
    // authoritative one).
    if (!canStartApproval(approvalState())) return
    if (exportAbort) exportAbort.abort()
    exportAbort = new AbortController()
    const signal = exportAbort.signal
    const isRetry = approvalState().kind === "retrying"
    if (isRetry) {
      setApprovalState({ type: "retry-start" })
    } else {
      setApprovalState({ type: "request-start" })
    }
    setExportState("exporting")
    setSaveMessage("")
    try {
      const render = await live.client.createArtifact(
        {
          workspaceId: live.workspaceId,
          kind: "svg",
          filename: "design-preview.svg",
          content: renderDesignSpecSvg(designSpec, { width: 1440, height: 1080 }),
          metadata: { derivedFrom: artifactId() ?? "draft", format: "image/svg+xml" },
          provenance: { sourceTool: "design-renderer", capabilityPack: "workbench-design" },
        },
        signal,
      )
      const result = await live.client.exportArtifact(
        live.workspaceId,
        render.artifact.artifactId,
        { metadata: "keep", outbox: "design" },
        signal,
      )
      if ("approvalId" in result && result.approvalId) {
        // 202 — broker gated the operation. The default TTL mirrors
        // the broker's `ttlMs` (5 min in the workbench-server
        // bootstrap); we accept whatever the server reported via
        // `expiresAt` if it ever adds one. Today
        // `AcceptedOperation` carries no `expiresAt`, so we
        // synthesize it from the documented default.
        const expiresAt = Date.now() + 5 * 60_000
        setApprovalState({ type: "request-approval-required", approvalId: result.approvalId, capability: "artifact.export", resource: render.artifact.artifactId, expiresAt })
        clearApprovalTimer()
        approvalExpireTimer = setTimeout(() => setApprovalState({ type: "expire" }), Math.max(0, expiresAt - Date.now()))
        // P6-2 — approval ≠ error: the spec editor's button still
        // shows the "submitted" state; the modal is the surface the
        // user acts on.
        setExportState("exported")
        setSaveMessage(t("design.status.exportSubmitted", { approvalId: result.approvalId }))
        return
      }
      if ("exported" in result) {
        setApprovalState({ type: "request-succeeded" })
        setExportState("exported")
        setSaveMessage(t("design.status.svgExported", { path: result.exported.relativePath }))
        return
      }
      throw new Error("export returned an unrecognised envelope")
    } catch (error) {
      if (signal.aborted) {
        // Navigation away from the Design surface — the onCleanup
        // hook already cancelled the machine; the aborted promise
        // is a no-op here, not a failure.
        return
      }
      setApprovalState({ type: "request-failed", error: error instanceof Error ? error.message : "design render export failed" })
      setExportState("error")
      setSaveMessage(error instanceof Error ? error.message : "design render export failed")
    }
  }

  /** Drop the expiry timer, wherever the machine leaves `approval-required`. */
  function clearApprovalTimer(): void {
    if (approvalExpireTimer) {
      clearTimeout(approvalExpireTimer)
      approvalExpireTimer = undefined
    }
  }

  // DA-UI-02 / DA-UI-03 — allow, deny, cancel, re-request and the
  // navigation teardown. They live in `design-approval.ts` with the client
  // injected: this file cannot be loaded by `bun:test` (Solid's `use` is
  // client-only), so anything written here can only ever be checked by a
  // regex over its own source — which is how an expiry shipped with no
  // reachable control and a request left pending on the broker.
  const approvalOps = createApprovalOperations({
    client: () => connection()?.client,
    state: approvalState,
    dispatch: setApprovalState,
    clearTimer: clearApprovalTimer,
    restart: runExportFlow,
    report: (outcome) => {
      setExportState(outcome.exportState)
      setSaveMessage(outcome.message)
    },
    text: (key, params) => tDesignApproval(language.locale(), key, params),
  })

  // DA-UI-03 — navigation cleanup. The Design surface unmounts when the
  // user switches mode or closes the workspace. Both paths must withdraw
  // any pending approval: aborting the local fetch does not tell the
  // broker, so the request would sit there until its TTL ran out and the
  // next attempt would race it.
  onCleanup(() => {
    if (exportAbort) {
      exportAbort.abort()
      exportAbort = undefined
    }
    approvalOps.detach()
  })

  /**
   * Phase 7 — manual, production-grade artifact generation, no agent
   * required. `runExportFlow` above already proves the spec renders to
   * a real, persisted SVG artifact; this reuses the same render call but,
   * instead of sending it to the outbox, opens it in the workshop through
   * the exact `stream` pipeline a real agent's `<artifact>` block would use
   * (P4-2's target shape, applied directly — there's no markdown to parse,
   * so the parser/adapter step is skipped, not reimplemented). The result
   * is a real `DesignArtifactTab` showing a real, server-persisted artifact:
   * this is the "generate a real artifact" affordance the design decided on
   * for the case where no agent emits `<artifact>` tags yet.
   */
  async function openSpecInWorkshop(): Promise<void> {
    const current = connection()
    const designSpec = spec().spec
    if (!current || !designSpec || openState() === "opening") return
    setOpenState("opening")
    setSaveMessage("")
    try {
      const content = renderDesignSpecSvg(designSpec, { width: 1440, height: 1080 })
      const result = await current.client.createArtifact({
        workspaceId: current.workspaceId,
        kind: "svg",
        filename: "design-preview.svg",
        content,
        metadata: { derivedFrom: artifactId() ?? "draft", format: "image/svg+xml" },
        provenance: { sourceTool: "design-workshop-preview", capabilityPack: "workbench-design" },
      })
      const id = result.artifact.artifactId
      stream.push({ type: "artifact:start", artifactId: id, filename: result.artifact.filename, kind: result.artifact.kind, sessionId: "manual" })
      stream.push({ type: "artifact:chunk", artifactId: id, chunk: content })
      stream.push({ type: "artifact:end", artifactId: id, reason: "complete" })
      setOpenState("opened")
      setSaveMessage(
        t("design.status.openedInWorkshop", { filename: result.artifact.filename, version: result.artifact.version }),
      )
    } catch (error) {
      setOpenState("error")
      setSaveMessage(error instanceof Error ? error.message : "design preview could not be opened")
    }
  }
  /**
   * Phase 9.2 — a manual edit was already persisted server-side (createArtifact,
   * called from DesignArtifactTab, which owns the connection needed for
   * that call). This just syncs entry.content with what was saved, same
   * start/chunk/end sequence as openSpecInWorkshop above — the stream is
   * the only write path DesignArtifactTab has for its own props.entry.
   */
  function onArtifactEdited(artifactId: string, filename: string, kind: string, content: string): void {
    stream.push({ type: "artifact:start", artifactId, filename, kind, sessionId: "manual-edit" })
    stream.push({ type: "artifact:chunk", artifactId, chunk: content })
    stream.push({ type: "artifact:end", artifactId, reason: "complete" })
  }

  const versionPanel = createMemo(() => createArtifactVersionPanelState(history.data?.history ?? []))
  const latestDiff = createMemo(() => {
    const versions = versionPanel().history
    return diffArtifactVersions(versions.at(-2), versions.at(-1))
  })

  // Phase 3 — `renderTabContent` resolves the body of the active tab. The
  // workshop's `kind` enum drives the routing: the spec editor lives behind
  // the "spec" tab (P3-4), the file listing will land in "file" (P-pending),
  // and the artifact preview keeps the "artifact" slot. Keeping the routing
  // in a single function makes the seam between tabs and the surface's own
  // signals (source, manifest, validation, …) obvious at a glance.
  const githubView = createMemo(() => describeGithubConnection({ status: github.data, loading: github.isLoading, error: github.error }))
  const openTerminalTab = () => setTabState(openTab(tabState, { id: "terminal", kind: "terminal", title: "Terminal", closable: true }))
  const openBrowserTab = () => setTabState(openTab(tabState, { id: "browser", kind: "browser", title: t("design.studio.workshop.browser"), closable: true }))

  function renderTabContent(tab: DesignTab): JSX.Element {
    if (tab.kind === "file") {
      return <DesignFilesTab />
    }
    if (tab.kind === "spec") {
      return <DesignSpecEditor
        source={source()}
        canWrite={!!connection() && !!spec().spec}
        onInput={updateDraft}
        draftError={draftError()}
        empty={spec().empty}
        specDiagnostics={spec().diagnostics}
        specEmpty={spec().empty ? t("workbench.design.specEmpty") : (spec().diagnostics[0]?.message ?? t("workbench.design.specEmpty"))}
        validationLoading={validation.isLoading}
        validationError={validation.error}
        validationValid={validation.data?.valid === true}
        validationDenied={validation.data?.capabilities.denied ?? []}
        previews={preview().previews}
        saveState={saveState()}
        saveMessage={saveMessage()}
        onSave={() => void saveDesignVersion()}
        exportState={exportState()}
        onExport={() => void runExportFlow()}
        openState={openState()}
        onOpenInWorkshop={() => void openSpecInWorkshop()}
        versionPanel={versionPanel()}
        latestDiff={latestDiff()}
        manifestError={manifest.error}
        manifestLoading={manifest.isLoading}
        catalogs={manifest.data?.designSystems ?? []}
        onAddTokenComment={addTokenComment}
      />
    }
    if (tab.kind === "artifact") {
      return <DesignArtifactTab
        entry={stream.state().byId.get(tab.id)}
        connectionError={stream.renderState().connectionError}
        viewport={viewport()}
        zoom={zoom()}
        toolbarMode={toolbarMode()}
        snapshot={snapshotController.snapshot()}
        selectMode={selectMode()}
        onViewport={setViewport}
        onZoom={setZoom}
        onToolbarMode={setToolbarMode}
        onSnapshot={requestSnapshot}
        onSelectMode={setSelectMode}
        onSelectTarget={onArtifactSelectTarget}
        onSnapshotReady={setCapture}
        commentState={commentState()}
        onCommentChange={updateCommentState}
        commentTarget={commentTarget()}
        onSendCommentBatch={(prompt) => void sendRefinePrompt(prompt, "commentaires")}
        onSendCommentOne={(prompt) => void sendRefinePrompt(prompt, "commentaire")}
        onAttachComment={composer.available ? (comment) => composer.attach(comment, commentTarget()?.entryFile ?? stream.state().byId.get(tab.id)?.filename ?? tab.title) : undefined}
        attachedCommentIds={composer.attached()}
        highlightedCommentId={highlightedCommentId()}
        onPinClick={(id) => setHighlightedCommentId(id)}
        commentPersistError={commentPersistError()}
        commentPanelOpen={commentPanelOpen()}
        onToggleCommentPanel={() => setCommentPanelOpen((value) => !value)}
        copyState={snapshotController.copyState()}
        onCopySnapshot={() => void copySnapshot()}
        onArtifactEdited={onArtifactEdited}
      />
    }
    if (tab.kind === "terminal") return <TerminalPanel />
    if (tab.kind === "browser") return <DesignBrowserTab />
    if (tab.kind === "canvas") {
      return (
        <DesignCanvasTab
          id={tab.id}
          catalogs={manifest.data?.designSystems ?? []}
          workshop={
            <DesignWorkshopMenu
              tabs={tabState.tabs}
              githubLabel={githubConnectionLabel(githubView(), t)}
              onActivate={(id) => setTabState("activeId", id)}
              onOpenTerminal={openTerminalTab}
              onOpenBrowser={openBrowserTab}
            />
          }
        />
      )
    }
    return <div data-design-workspace-tab-empty={tab.id} />
  }

  return (
    <main data-v110="mode-main" data-component="workbench-mode-main" class="min-w-0 min-h-0 flex-1 flex">
      <section data-v110="surface-card" data-component="workbench-design-surface" class="min-w-0 min-h-0 flex-1 flex flex-col">
        <div class="size-full min-h-0 overflow-hidden" data-workbench-surface="design" data-parity="design.surface">
      {/* WorkbenchThread + DesignSplit's own "assistant" column used to own
          this mode's chat (2026-09-22 and earlier). Design now mounts under
          SessionRoute like every other mode (session.tsx), which already
          renders the one shared chat pane to its left -- DesignSplit's
          assistant/atelier switch is redundant with that outer shell (and,
          on mobile, actually conflicts with it: two different "which pane
          is visible" mechanisms stacked on top of each other). Dropped the
          split; this surface is now just its workspace content, full width,
          matching Work/Automate's session.tsx-mounted shape.
          Composer-embedded comment chips, design-system context chips, and
          WorkbenchThread's own file upload are NOT ported to the shared
          composer in this pass -- the core capabilities they wrapped stay:
          comments still attach to refine prompts via the artifact panel's
          own Send buttons (onSendCommentBatch/onSendCommentOne below,
          unchanged), and the shared composer already has generic file
          attachment (prompt-input.tsx's attachFile). Flagged as a follow-up
          (mcp__ccd_session__spawn_task) rather than silently dropped or
          rebuilt inline: making ContextItem (context/prompt.tsx) support a
          second variant beyond "file" is a real, separate feature, not a
          chat-unification detail. */}
      <div class="flex h-full min-h-0 flex-col">
        <div class="shrink-0 px-3 py-1">
          <ConnectionBanner dataAttr="design-connection" dataRetryAttr="design-retry" />
        </div>
        <DesignWorkspace
          state={tabState}
          setState={setTabState}
          renderContent={renderTabContent}
          github={githubView()}
          onOpenTerminal={openTerminalTab}
          onOpenBrowser={openBrowserTab}
          onOpenCanvas={() => setTabState(openTab(tabState, { id: "canvas", kind: "canvas", title: "Canvas", closable: true }))}
        />
      </div>
      {/* DA-UI-02 — the approval modal. Visible only when the machine
          is in `approval-required` or `resolving`; the modal owns its
          own Allow/Deny/Cancel buttons and reads the machine for the
          approval id, capability and deadline. The expiration warning
          (DA-UI-03) is rendered non-modally inside the same component
          when `state.expired` is true. */}
      <ApprovalModal
        state={approvalState()}
        onAllow={() => void approvalOps.resolve("allow")}
        onDeny={() => void approvalOps.resolve("deny")}
        onCancel={() => void approvalOps.cancel()}
        onRerequest={() => void approvalOps.rerequest()}
      />
        </div>
      </section>
    </main>
  )
}
