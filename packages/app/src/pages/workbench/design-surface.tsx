/* SPDX-License-Identifier: MIT */

import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { createQuery } from "@tanstack/solid-query"
import { useLanguage } from "@/context/language"
import { useMode } from "@/context/mode"
import { useSync } from "@/context/sync"
import { useWorkspaceWorkbench } from "@/context/workbench/provider"
import { workbenchQueryKey } from "@/context/workbench/query-keys"
import { createWorkbenchSession } from "@/pages/workbench/workbench-session"
import { WorkbenchThread } from "@/pages/workbench/workbench-thread"
import { DesignSplit } from "@/pages/workbench/design-split"
import { DesignWorkspace, seedDesignTabState } from "@/pages/workbench/design-workspace"
import { DesignFilesTab } from "@/pages/workbench/design-files-tab"
import { DesignArtifactTab } from "@/pages/workbench/design-artifact-tab"
import { DEFAULT_TOOLBAR_MODE, type DesignToolbarSnapshotState, type DesignToolbarMode } from "@/pages/workbench/design-toolbar"
import { createArtifactParser } from "@unifia/artifact-render"
import { DEFAULT_VIEWPORT, DEFAULT_ZOOM, VIEWPORT_IDS, type ViewportId } from "@unifia/artifact-render"
import { createArtifactStreamController } from "@/pages/workbench/use-artifact-stream"
import { adaptRenderArtifactEvents } from "@/pages/workbench/artifact-event-adapter"
import { extractMessageText } from "@/pages/workbench/workbench-thread-shared"
import { toggleAttachedCommentId } from "@/pages/workbench/thread-comment-attach"
import {
  createDesignPreviewPanelState,
  createDesignSpecPanelState,
  renderDesignSpecSvg,
  createArtifactVersionPanelState,
  diffArtifactVersions,
  createIndexedDbDesignDraftStore,
  createIndexedDbCommentStore,
  DesignDraftConflictError,
  EMPTY_COMMENT_STATE,
  type CommentState,
  type CommentTargetRect,
} from "@unifia/workbench-shell"
import { openTab, type DesignTab } from "@/pages/workbench/design-tabs"

export function DesignSurface(): JSX.Element {
  const language = useLanguage()
  const t = language.t
  const mode = useMode()
  const sync = useSync()
  const workbench = useWorkspaceWorkbench()
  const connection = workbench.connection
  createEffect(() => { void workbench.ensureConnected().catch(() => undefined) })
  const manifest = createQuery(() => ({ queryKey: workbenchQueryKey(connection(), "design-systems"), enabled: !!connection(), queryFn: () => connection()!.client.listDesignSystems(connection()!.workspaceId) }))
  const [source, setSource] = createSignal("")
  const [draftRevision, setDraftRevision] = createSignal<number | undefined>()
  const [draftError, setDraftError] = createSignal<string>()
  const [artifactId, setArtifactId] = createSignal<string>()
  const [saveState, setSaveState] = createSignal<"idle" | "saving" | "saved" | "error">("idle")
  const [saveMessage, setSaveMessage] = createSignal("")
  const [exportState, setExportState] = createSignal<"idle" | "exporting" | "exported" | "error">("idle")
  const [openState, setOpenState] = createSignal<"idle" | "opening" | "opened" | "error">("idle")
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
  const stream = createArtifactStreamController({ debounceMs: 100 })
  const [streamPersisted, setStreamPersisted] = createSignal<ReadonlySet<string>>(new Set())

  // Phase 4 — ouverture automatique d'un onglet artifact à chaque
  // `artifact:start`. Le Set local mémorise les ids déjà introduits : si
  // l'utilisateur ferme un onglet artifact puis qu'un nouveau chunk arrive
  // pour le même id, on ne le rouvre pas (l'utilisateur a exprimé un
  // choix de navigation explicite). Côté Phase 4, l'agent n'est pas
  // encore branché ; le câblage réel passe par `adaptRenderArtifactEvent`
  // quand l'adaptateur sera consommé par le controller.
  const seenArtifactIds = new Set<string>()
  // P3-5 — état du toolbar remonté au niveau de la surface. L'onglet
  // artifact rend `ArtifactPreview` ; le `DesignToolbar` qui le surplombe
  // est piloté ici pour que les sélections (viewport, zoom, mode, snapshot,
  // sélection) survivent à un changement d'onglet puis un retour, et pour
  // qu'une seule instance d'état existe par surface (et non par panneau
  // éphémère, comme avant P3-5).
  const [viewport, setViewport] = createSignal<ViewportId>(DEFAULT_VIEWPORT)
  const [zoom, setZoom] = createSignal<number>(DEFAULT_ZOOM)
  const [toolbarMode, setToolbarMode] = createSignal<DesignToolbarMode>(DEFAULT_TOOLBAR_MODE)
  const [snapshot, setSnapshot] = createSignal<DesignToolbarSnapshotState>({ kind: "idle" })
  const [selectMode, setSelectMode] = createSignal(false)
  // P3-5 / P17 — la fonction de capture vit dans l'iframe (postMessage
  // same-origin impossible depuis l'hôte). `ArtifactPreview` la remonte
  // via `onSnapshotReady` à chaque montage d'iframe ; on la garde ici
  // pour qu'un seul `requestSnapshot` (ci-dessous) puisse la déclencher
  // depuis le toolbar remonté. Une seule instance visible à la fois, donc
  // un seul `capture` survit à un changement d'onglet.
  let capture: (() => Promise<{ dataUrl: string; w: number; h: number }>) | undefined
  function requestSnapshot(): void {
    if (snapshot().kind === "capturing") return
    if (!capture) {
      setSnapshot({ kind: "error", error: "preview-not-mounted" })
      return
    }
    setSnapshot({ kind: "capturing" })
    void capture()
      .then((result) => setSnapshot({ kind: "ready", dataUrl: result.dataUrl, w: result.w, h: result.h }))
      // Un refus du pont (empty-render, timeout…) remonte tel quel : mieux
      // vaut un échec nommé qu'un PNG uniforme livré en silence.
      .catch((error: unknown) => setSnapshot({ kind: "error", error: error instanceof Error ? error.message : "snapshot-failed" }))
  }

  // Phase 8.3/9.6 — visibilité du panneau de commentaires, remontée au
  // même niveau que le reste du toolbar (P3-5) pour survivre à un
  // changement d'onglet. Ouvert par défaut : c'est le comportement
  // observable avant cette phase (le panneau était toujours affiché).
  const [commentPanelOpen, setCommentPanelOpen] = createSignal(true)

  // Phase 9.6 — copie la dernière capture dans le presse-papiers, en plus
  // du téléchargement déjà câblé. `ClipboardItem` attend un `Blob`, pas le
  // `dataUrl` que le pont snapshot renvoie — `fetch(dataUrl)` est le
  // moyen le plus direct de refaire cette conversion sans réimplémenter
  // un décodeur base64 (un `data:` URI est un fetch same-document valide).
  const [copyState, setCopyState] = createSignal<"idle" | "copying" | "copied" | "error">("idle")
  async function copySnapshot(): Promise<void> {
    const current = snapshot()
    if (current.kind !== "ready" || copyState() === "copying") return
    setCopyState("copying")
    try {
      const blob = await (await fetch(current.dataUrl)).blob()
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
      setCopyState("copied")
      setTimeout(() => setCopyState((state) => (state === "copied" ? "idle" : state)), 2_000)
    } catch {
      setCopyState("error")
    }
  }

  // P19 + P20 — Panneau de commentaires, rebranché. `CommentState` est un
  // registre plat (chaque `DesignComment` porte son propre `artifactId`),
  // donc un seul signal suffit pour tous les onglets artefact — pas besoin
  // d'un state par onglet. `commentTarget` mémorise le dernier élément
  // piqué (P18) tant qu'aucun autre pick ne le remplace ; il survit à un
  // changement d'onglet volontairement (revenir sur l'artefact retrouve
  // la cible en cours).
  const [commentState, setCommentState] = createSignal<CommentState>(EMPTY_COMMENT_STATE)
  const [commentTarget, setCommentTarget] = createSignal<{ elementId: string; artifactId: string; entryFile: string; rect?: CommentTargetRect }>()
  // Phase 10.3 — "Commenter la conversation" ; deliberately NOT a field on
  // `CommentState` (see `thread-comment-attach.ts`'s doc comment): this is
  // an ephemeral "will ride along with my next message" selection, not a
  // persisted property of the comment, so it lives in its own signal and
  // is never written to `commentStore` below.
  const [attachedCommentIds, setAttachedCommentIds] = createSignal<ReadonlySet<string>>(new Set())
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

  // P4-3 — chaque `artifact:start` du moteur de streaming ouvre (ou active)
  // un onglet `kind: "artifact"`. L'effet lit `stream.state()` (signal) et
  // itère sur les ids connus ; le Set local garantit qu'on n'ouvre pas
  // deux fois le même onglet et qu'on n'écrase pas la navigation explicite
  // de l'utilisateur (un onglet fermé n'est pas rouvert par un chunk
  // ultérieur). Le tracking fin de Solid gère la dépendance sur la
  // référence du `byId` (la Map est reconstruite à chaque event).
  createEffect(() => {
    const byId = stream.state().byId
    for (const [id, entry] of byId.entries()) {
      if (seenArtifactIds.has(id)) continue
      seenArtifactIds.add(id)
      setTabState(openTab(tabState, {
        id,
        kind: "artifact",
        title: entry.filename,
        closable: true,
      }))
    }
  })

  // Phase 7 — P4-1 closed: the real producer. `WorkbenchThread` shows the
  // same session this effect reads (`mode.sessionId()`); nothing here
  // creates a session or duplicates `sync.session.sync` — the thread already
  // keeps it warm. Every assistant message is fed, incrementally, through
  // its own `createArtifactParser()` instance (one per message id, so two
  // concurrent messages never share buffer state); the parser only sees the
  // *new* slice of text since last run (`fed` tracks how much of the
  // message has already been parsed — `feed()` is a streaming API, calling
  // it with the full text again on every render would re-emit every event).
  // `adaptRenderArtifactEvents` reuses the P4-2 adapter to translate into
  // the shape `stream` expects. If the agent behind "build" ever answers
  // with an `<artifact>` block, it renders here with no further wiring. If
  // it never does, this effect simply never yields an event — a silent
  // no-op, not a failure.
  const messageParsers = new Map<string, { parser: ReturnType<typeof createArtifactParser>; fed: number }>()
  let parsedSessionId: string | undefined
  createEffect(() => {
    const sessionId = mode.sessionId()
    if (sessionId !== parsedSessionId) {
      // A session switch starts every message's parse state over — a
      // message id from a previous conversation is never revisited.
      messageParsers.clear()
      parsedSessionId = sessionId
    }
    if (!sessionId) return
    const messages = sync.data.message[sessionId] ?? []
    for (const message of messages) {
      if (message.role !== "assistant") continue
      const text = extractMessageText(sync.data.part[message.id])
      if (!text) continue
      let tracked = messageParsers.get(message.id)
      if (!tracked) {
        tracked = { parser: createArtifactParser(), fed: 0 }
        messageParsers.set(message.id, tracked)
      }
      if (text.length <= tracked.fed) continue
      const delta = text.slice(tracked.fed)
      tracked.fed = text.length
      for (const event of adaptRenderArtifactEvents(tracked.parser.feed(delta))) stream.push(event)
    }
  })

  // P18 → P19 — callback de pick d'élément dans l'artefact : mémorise la
  // cible pour que `CommentPanel` sache sur quel `data-unifia-id` le
  // prochain "Ajouter" doit s'attacher. Phase 8.1 : le rect du pick est
  // capturé ici aussi, pour que le commentaire créé porte une épingle.
  function onArtifactSelectTarget(elementId: string, artifactId: string, entryFile: string, rect: CommentTargetRect): void {
    setCommentTarget({ elementId, artifactId, entryFile, rect })
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
  const refineSession = createWorkbenchSession({ title: () => t("workbench.chat.design") })
  async function sendRefinePrompt(prompt: string, label: string): Promise<void> {
    setSaveMessage(`Envoi ${label}…`)
    try {
      await refineSession.prompt(prompt)
      setSaveMessage(`Prompt ${label} envoyé (${prompt.length} caractères)`)
    } catch (error) {
      setSaveMessage(`Envoi échoué : ${error instanceof Error ? error.message : String(error)}`)
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
          setSaveMessage(`Artefact ${result.artifact.filename} persisté (v${result.artifact.version})`)
        })
        .catch((error) => {
          setSaveMessage(`Persistance échouée : ${error instanceof Error ? error.message : String(error)}`)
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
  const validation = createQuery(() => ({
    queryKey: workbenchQueryKey(connection(), "spec-validation", { source: source() }),
    enabled: !!connection() && source().trim().length > 0 && spec().diagnostics.length === 0,
    staleTime: 5_000,
    queryFn: () => connection()!.client.validateSpec(connection()!.workspaceId, source()),
  }))
  const history = createQuery(() => ({
    queryKey: workbenchQueryKey(connection(), "design-history", { artifactId: artifactId() ?? "" }),
    enabled: !!connection() && !!artifactId(),
    queryFn: () => connection()!.client.artifactHistory(connection()!.workspaceId, artifactId()!),
  }))
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
      setSaveMessage(`Version ${result.artifact.version} enregistrée`)
      await history.refetch()
    } catch (error) {
      setSaveState("error")
      setSaveMessage(error instanceof Error ? error.message : "design version could not be saved")
    }
  }
  async function exportDesignRender(): Promise<void> {
    const current = connection()
    const designSpec = spec().spec
    if (!current || !designSpec || exportState() === "exporting") return
    setExportState("exporting")
    setSaveMessage("")
    try {
      const render = await current.client.createArtifact({
        workspaceId: current.workspaceId,
        kind: "svg",
        filename: "design-preview.svg",
        content: renderDesignSpecSvg(designSpec, { width: 1440, height: 1080 }),
        metadata: { derivedFrom: artifactId() ?? "draft", format: "image/svg+xml" },
        provenance: { sourceTool: "design-renderer", capabilityPack: "workbench-design" },
      })
      const result = await current.client.exportArtifact(current.workspaceId, render.artifact.artifactId, { metadata: "keep", outbox: "design" })
      // P6-2 — approbation ≠ erreur. Le chemin gouverné (qui exige une
      // approbation) retourne un `approvalId` et non un `exported` : du
      // point de vue de l'utilisateur qui a déclenché l'action, l'export
      // a été soumis avec succès ; le bandeau rouge était une fausse
      // alerte. On utilise `exported` (même état que le chemin nominal)
      // et on garde le message détaillé pour distinguer les deux cas
      // dans le bandeau de feedback.
      if ("approvalId" in result && result.approvalId) {
        setExportState("exported")
        setSaveMessage(`Export soumis à approbation : ${result.approvalId}`)
      } else if ("exported" in result) {
        setExportState("exported")
        setSaveMessage(`SVG exporté : ${result.exported.relativePath}`)
      }
    } catch (error) {
      setExportState("error")
      setSaveMessage(error instanceof Error ? error.message : "design render export failed")
    }
  }
  /**
   * Phase 7 — manual, production-grade artifact generation, no agent
   * required. `exportDesignRender` above already proves the spec renders to
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
      setSaveMessage(`Ouvert dans l'atelier : ${result.artifact.filename} (v${result.artifact.version})`)
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
  function renderTabContent(tab: DesignTab): JSX.Element {
    if (tab.kind === "file") {
      return <DesignFilesTab />
    }
    if (tab.kind === "spec") {
      return <DesignSpecEditor
        source={source()}
        onInput={updateDraft}
        draftError={draftError()}
        specDiagnostics={spec().diagnostics}
        specEmpty={spec().diagnostics[0]?.message ?? t("workbench.design.specEmpty")}
        validationLoading={validation.isLoading}
        validationError={validation.error}
        validationValid={validation.data?.valid === true}
        validationDenied={validation.data?.capabilities.denied ?? []}
        previews={preview().previews}
        saveState={saveState()}
        saveMessage={saveMessage()}
        onSave={() => void saveDesignVersion()}
        exportState={exportState()}
        onExport={() => void exportDesignRender()}
        openState={openState()}
        onOpenInWorkshop={() => void openSpecInWorkshop()}
        versionPanel={versionPanel()}
        latestDiff={latestDiff()}
        manifestError={manifest.error}
        manifestLoading={manifest.isLoading}
        catalogs={manifest.data?.designSystems ?? []}
      />
    }
    if (tab.kind === "artifact") {
      return <DesignArtifactTab
        entry={stream.state().byId.get(tab.id)}
        connectionError={stream.renderState().connectionError}
        viewport={viewport()}
        zoom={zoom()}
        toolbarMode={toolbarMode()}
        snapshot={snapshot()}
        selectMode={selectMode()}
        onViewport={setViewport}
        onZoom={setZoom}
        onToolbarMode={setToolbarMode}
        onSnapshot={requestSnapshot}
        onSelectMode={setSelectMode}
        onSelectTarget={onArtifactSelectTarget}
        onSnapshotReady={(request) => {
          capture = request
        }}
        commentState={commentState()}
        onCommentChange={updateCommentState}
        commentTarget={commentTarget()}
        onSendCommentBatch={(prompt) => void sendRefinePrompt(prompt, "commentaires")}
        onSendCommentOne={(prompt) => void sendRefinePrompt(prompt, "commentaire")}
        highlightedCommentId={highlightedCommentId()}
        onPinClick={(id) => setHighlightedCommentId(id)}
        commentPersistError={commentPersistError()}
        commentPanelOpen={commentPanelOpen()}
        onToggleCommentPanel={() => setCommentPanelOpen((value) => !value)}
        copyState={copyState()}
        onCopySnapshot={() => void copySnapshot()}
        onArtifactEdited={onArtifactEdited}
      />
    }
    return <div data-design-workspace-tab-empty={tab.id} />
  }

  return (
    <section class="size-full" data-workbench-surface="design">
      <DesignSplit
        chat={
          <WorkbenchThread
            mode="design"
            prompt={t("workbench.design.chatPrompt")}
            description={t("workbench.design.description")}
            connection={{ dataAttr: "design-connection", dataRetryAttr: "design-retry" }}
            comments={{
              state: commentState(),
              attachedIds: attachedCommentIds(),
              onToggleAttach: (commentId) => setAttachedCommentIds((ids) => toggleAttachedCommentId(ids, commentId)),
              onClearAttached: () => setAttachedCommentIds(new Set()),
              resolveEntryFile: (artifactId) => stream.state().byId.get(artifactId)?.filename,
            }}
          />
        }
        workspace={
          <div class="flex h-full min-h-0 flex-col">
            <DesignWorkspace state={tabState} setState={setTabState} renderContent={renderTabContent} />
          </div>
        }
      />
    </section>
  )
}

// Phase 3 → Phase 7 — the "Fichiers" tab was a placeholder proving only that
// a non-closable tab survives `closeTab` (P3-3). It's now `DesignFilesTab`
// from `design-files-tab.tsx`, imported above: a real listing backed by
// `listFiles(workspaceId, ".")`, the same client call Automate already used
// (`automate-surface.tsx`) — no new server surface, no duplicated query.

type DesignCatalogSummary = {
  id: string
  name: string
  version: string
  source: string
}

/**
 * Phase 3 — Onglet "Spec" : l'éditeur de spec historique migré tel quel
 * (catalog, design context, textarea, diagnostics, validation, viewports,
 * versioning, history). On n'a rien réécrit : le contenu existait, on
 * l'a juste déplacé d'un slot inline vers un sous-composant adressable
 * par le workshop via `kind: "spec"`. La migration donne une cible de
 * tests (le sous-composant est importable, le slot inline ne l'était pas).
 */
function DesignSpecEditor(props: {
  source: string
  onInput: (value: string) => void
  draftError: string | undefined
  specDiagnostics: readonly { line: number; column: number; message: string }[]
  specEmpty: string
  validationLoading: boolean
  validationError: unknown
  validationValid: boolean
  validationDenied: readonly string[]
  previews: readonly unknown[]
  saveState: "idle" | "saving" | "saved" | "error"
  saveMessage: string
  onSave: () => void
  exportState: "idle" | "exporting" | "exported" | "error"
  onExport: () => void
  openState: "idle" | "opening" | "opened" | "error"
  onOpenInWorkshop: () => void
  versionPanel: {
    history: readonly unknown[]
    provenance?: Record<string, string>
  }
  latestDiff: { changed: readonly string[]; added: readonly string[]; removed: readonly string[] }
  manifestError: unknown
  manifestLoading: boolean
  catalogs: readonly DesignCatalogSummary[]
}): JSX.Element {
  const language = useLanguage()
  const t = language.t
  return (
    <div class="flex h-full min-h-0 flex-col gap-6 overflow-auto p-6" data-design-spec-editor>
      <Show when={props.manifestError}>
        <p data-design-manifest="failed" class="text-14-regular text-text-danger">{props.manifestError instanceof Error ? props.manifestError.message : String(props.manifestError)}</p>
      </Show>
      <Show when={props.catalogs.length > 0}>
        <div class="grid gap-3 md:grid-cols-2" data-design-catalog-count={props.catalogs.length}>
          <For each={props.catalogs}>
            {(catalog) => (
              <article class="rounded-lg border border-border-base bg-background-stronger p-4" data-design-catalog={catalog.id}>
                <h2 class="text-14-medium">{catalog.name} · {catalog.version}</h2>
                <p class="mt-2 text-12-regular text-text-weak">{t("workbench.design.source", { source: catalog.source })}</p>
              </article>
            )}
          </For>
        </div>
      </Show>
      <Show when={!props.manifestLoading && !props.manifestError && props.catalogs.length === 0}>
        <p data-design-manifest="empty" class="text-14-regular text-text-danger">{t("workbench.design.noManifest")}</p>
      </Show>
      {/*
        P4-4 — la ligne « design context: N chars · catalog: none » est
        retirée. C'était une étiquette statique de P22 servant à valider
        l'observabilité du câblage catalogue → preamble ; le câblage est
        désormais prouvé par l'agent lui-même (l'agent choisit le catalogue
        quand il parle, et le fil en rend le contenu). Le data-attribute
        `data-design-context-length` n'a plus de support dans le JSX.
      */}
      <label class="block space-y-2" for="workbench-design-spec">
        <span class="text-14-medium">{t("workbench.design.specLabel")}</span>
        <textarea
          id="workbench-design-spec"
          class="min-h-48 w-full rounded-lg border border-border-base bg-background-stronger p-4 font-mono text-12-regular text-text-base"
          placeholder={t("workbench.design.specPlaceholder")}
          value={props.source}
          onInput={(event) => props.onInput(event.currentTarget.value)}
          spellcheck={false}
        />
      </label>
      <Show when={props.draftError}><p data-design-draft="error" class="text-12-regular text-text-danger">{props.draftError}</p></Show>
      <Show when={props.specDiagnostics.length > 0}>
        <aside class="rounded-lg border border-border-danger bg-background-stronger p-4" data-workbench-diagnostics>
          <h2 class="text-14-medium text-text-danger">{t("workbench.design.diagnostics")}</h2>
          <For each={props.specDiagnostics}>
            {(diagnostic) => <p class="mt-2 text-12-regular text-text-weak">{t("workbench.design.diagnosticLine", { line: diagnostic.line, column: diagnostic.column, message: diagnostic.message })}</p>}
          </For>
        </aside>
      </Show>
      <Show when={props.validationLoading}>
        <p data-design-validation="loading" class="text-12-regular text-text-weak">{t("workbench.design.validating")}</p>
      </Show>
      <Show when={props.validationError}>
        <p data-design-validation="failed" class="text-14-regular text-text-danger">{props.validationError instanceof Error ? props.validationError.message : String(props.validationError)}</p>
      </Show>
      <Show when={props.validationDenied.length > 0}>
        <p data-design-validation="denied" class="text-14-regular text-text-danger">{t("workbench.design.capabilitiesDenied", { list: props.validationDenied.join(", ") })}</p>
      </Show>
      <Show when={props.validationValid && props.validationDenied.length === 0 && props.previews.length > 0} fallback={<p class="text-14-regular text-text-danger">{props.specEmpty}</p>}>
        <div class="grid gap-5 md:grid-cols-3" data-workbench-preview-count={VIEWPORT_IDS.length}>
          <For each={VIEWPORT_IDS}>
            {(id) => (
              <figure class="flex flex-col items-center gap-2 rounded-lg border border-border-base bg-background-stronger p-3">
                <span class="text-12-medium">{id}</span>
                <span class="text-12-regular text-text-weak">{t("workbench.design.previewCaption", { label: id, width: 0 })}</span>
              </figure>
            )}
          </For>
        </div>
      </Show>
      <div class="flex flex-wrap items-center gap-3" data-design-versioning>
        <button type="button" data-design-save-version class="rounded border border-border-base px-3 py-2 text-12-medium disabled:opacity-50" disabled={!props.source || props.saveState === "saving"} onClick={props.onSave}>
          {props.saveState === "saving" ? "Enregistrement…" : "Enregistrer une version"}
        </button>
        <button type="button" data-design-export-render class="rounded border border-border-base px-3 py-2 text-12-medium disabled:opacity-50" disabled={!props.source || props.exportState === "exporting"} onClick={props.onExport}>
          {props.exportState === "exporting" ? "Export…" : "Exporter le rendu SVG"}
        </button>
        <button type="button" data-design-open-workshop class="rounded border border-border-base px-3 py-2 text-12-medium disabled:opacity-50" disabled={!props.source || props.openState === "opening"} onClick={props.onOpenInWorkshop} title="Rend la spec en SVG, la persiste comme artefact, et l'ouvre dans l'onglet atelier">
          {props.openState === "opening" ? "Ouverture…" : "Ouvrir dans l'atelier"}
        </button>
        <Show when={props.saveMessage}><span data-design-save-result={props.saveState} class="text-12-regular text-text-weak">{props.saveMessage}</span></Show>
      </div>
      <Show when={props.versionPanel.history.length > 0}>
        <section class="rounded-lg border border-border-base bg-background-stronger p-4" data-design-history>
          <h2 class="text-14-medium">Historique Design</h2>
          <p class="mt-2 text-12-regular text-text-weak">{props.versionPanel.history.length} version(s) · provenance : {props.versionPanel.provenance?.sourceTool ?? "inconnue"}</p>
          <p data-design-diff class="mt-2 text-12-regular text-text-weak">Diff dernière version : {props.latestDiff.changed.join(", ") || "aucun changement structurel"}</p>
        </section>
      </Show>
    </div>
  )
}
