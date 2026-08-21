/* SPDX-License-Identifier: MIT */

import { Show, createEffect, createSignal, onCleanup, type JSX } from "solid-js"
import { ArtifactPreview } from "@/pages/workbench/artifact-preview"
import { CommentPanel } from "@/pages/workbench/comment-panel"
import { deriveExportFilename } from "@/pages/workbench/design-artifact-export"
import { DesignToolbar, type DesignToolbarMode, type DesignToolbarSnapshotState } from "@/pages/workbench/design-toolbar"
import type { StreamedArtifact } from "@/pages/workbench/use-artifact-stream"
import {
  addStroke,
  clearStrokes,
  commentPins,
  createIndexedDbAnnotationStore,
  EMPTY_ANNOTATION_STATE,
  openComments,
  undoStroke,
  type AnnotationState,
  type AnnotationStroke,
  type CommentState,
  type CommentTargetRect,
} from "@unifia/workbench-shell"
import type { ViewportId } from "@unifia/artifact-render"

/**
 * Phase 4 — Onglet artifact : remplace `StreamedArtifactPanel`.
 *
 * Avant la phase 4, ce panneau vivait à côté de `DesignWorkspace` et
 * possédait son propre état (viewport, zoom, mode, snapshot, sélection).
 * Le `DesignWorkspace` était alors *remplacé* par ce panneau quand un
 * stream était actif (P3-1 strict) — l'atelier disparaissait pendant un
 * flux, ce qui cassait la règle d'or d'Open Design : la conversation
 * produit un artefact qui s'ouvre dans l'atelier, sans le remplacer.
 *
 * Phase 4 inverse : l'atelier reste monté en permanence. Quand un
 * `artifact:start` arrive (P4-3), un onglet `kind: "artifact"` est ouvert
 * et `renderTabContent` route vers ce composant. L'état du toolbar (P3-5)
 * est promu dans `DesignSurface` pour survivre à un changement d'onglet
 * puis un retour, et pour qu'une seule instance existe par surface.
 *
 * Le panneau d'en-tête (statut streaming / complete / error) reste ici :
 * c'est l'info de cycle de vie de l'artefact, pas une décoration
 * d'interface générale.
 *
 * Extrait de `design-surface.tsx` (2026-08-21) : ce fichier grossissait
 * au-delà du seuil d'alerte de 800 LOC (CLAUDE.md) au fur et à mesure des
 * phases successives sur ce composant (P19/P20, 8.1, 8.2, 8.3, 9.5, …) —
 * `DesignArtifactTab` était déjà une frontière propre (props entièrement
 * typées, aucune dépendance sur les autres closures de `DesignSurface`),
 * donc l'extraction n'a rien changé de comportemental, juste redonné de
 * la marge avant les phases suivantes (9.1 annoter, 9.2 modifier, 9.3
 * présenter, 9.4 partager) qui touchent toutes ce même onglet.
 */
export function DesignArtifactTab(props: {
  /** L'entry du moteur de streaming. `undefined` si l'artefact n'a jamais reçu d'event. */
  entry: StreamedArtifact | undefined
  /** Erreur de connexion globale (SSE coupé). */
  connectionError: string | undefined
  /** P3-5 — état du toolbar remonté. */
  viewport: ViewportId
  zoom: number
  toolbarMode: DesignToolbarMode
  snapshot: DesignToolbarSnapshotState
  selectMode: boolean
  onViewport: (id: ViewportId) => void
  onZoom: (zoom: number) => void
  onToolbarMode: (mode: DesignToolbarMode) => void
  onSnapshot: () => void
  onSelectMode: (value: boolean) => void
  /** P18 → P19 — remontée d'un pick vers le panneau de commentaires. */
  onSelectTarget: (elementId: string, artifactId: string, entryFile: string, rect: CommentTargetRect) => void
  /** P3-5 / P17 — l'iframe remonte sa fonction de capture au parent. */
  onSnapshotReady: (request: () => Promise<{ dataUrl: string; w: number; h: number }>) => void
  /** P19 + P20 — état plat des commentaires, partagé entre tous les onglets artefact. */
  commentState: CommentState
  onCommentChange: (state: CommentState) => void
  /** P18 → P19 — dernier élément piqué ; `undefined` tant qu'aucun pick n'a eu lieu. */
  commentTarget: { elementId: string; artifactId: string; entryFile: string; rect?: CommentTargetRect } | undefined
  onSendCommentBatch: (prompt: string) => void
  onSendCommentOne: (prompt: string) => void
  /** Phase 8.1 — id du commentaire à faire défiler en vue quand une épingle est cliquée. */
  highlightedCommentId: string | undefined
  onPinClick: (id: string) => void
  /** Phase 8.2 — erreur de chargement/sauvegarde IndexedDB, `undefined` tant que rien n'a échoué. */
  commentPersistError: string | undefined
  /** Phase 8.3/9.6 — visibilité du panneau de commentaires, badge de comptage dans le toolbar. */
  commentPanelOpen: boolean
  onToggleCommentPanel: () => void
  copyState: "idle" | "copying" | "copied" | "error"
  onCopySnapshot: () => void
}): JSX.Element {
  // Phase 9.5 — export HTML/PDF. Local state (not hoisted to DesignSurface
  // like viewport/zoom/mode): this is transient feedback for a just-clicked
  // button, not a sticky preference that needs to survive a tab switch —
  // unlike those, there's no reason a re-visited tab should still show
  // "exported!" from a click made minutes ago on a different artifact.
  const [artifactExportState, setArtifactExportState] = createSignal<{ kind: "idle" | "exporting" | "exported" | "error"; error?: string }>({ kind: "idle" })

  // Phase 9.1 — outil Annoter (dessin libre). Local like the export state
  // above and for the same reason: `DesignArtifactTab` remounts fresh on
  // every tab switch (unlike the P3-5 toolbar state, hoisted to
  // DesignSurface specifically because it needs to survive that), so the
  // porte ("changer d'onglet, revenir — le trait est toujours là") is met
  // by reloading from IndexedDB on mount, not by in-memory persistence —
  // same posture as 8.2's comment store, just keyed by artifactId instead
  // of workspaceId since a stroke only means something against one
  // artifact's rendered content.
  const annotationStore = createIndexedDbAnnotationStore()
  const [annotateMode, setAnnotateMode] = createSignal(false)
  const [annotationState, setAnnotationState] = createSignal<AnnotationState>(EMPTY_ANNOTATION_STATE)
  const [annotationPersistError, setAnnotationPersistError] = createSignal<string>()
  let annotationLoadEpoch = 0
  let annotationSaveTimer: ReturnType<typeof setTimeout> | undefined
  createEffect(() => {
    const artifactId = props.entry?.artifactId
    if (!artifactId) return
    const epoch = ++annotationLoadEpoch
    void annotationStore
      .load(artifactId)
      .then((state) => {
        if (epoch !== annotationLoadEpoch) return
        setAnnotationState(state ?? EMPTY_ANNOTATION_STATE)
      })
      .catch((error) => setAnnotationPersistError(error instanceof Error ? error.message : "annotations could not be loaded"))
  })
  onCleanup(() => {
    if (annotationSaveTimer) clearTimeout(annotationSaveTimer)
  })
  function persistAnnotationState(state: AnnotationState): void {
    const artifactId = props.entry?.artifactId
    if (!artifactId) return
    if (annotationSaveTimer) clearTimeout(annotationSaveTimer)
    annotationSaveTimer = setTimeout(() => {
      void annotationStore.save(artifactId, state).catch((error) => {
        setAnnotationPersistError(error instanceof Error ? error.message : "annotations could not be saved")
      })
    }, 250)
  }
  function onAnnotationStroke(stroke: AnnotationStroke): void {
    const next = addStroke(annotationState(), stroke)
    setAnnotationState(next)
    persistAnnotationState(next)
  }

  function exportArtifactHtml(): void {
    const content = props.entry?.content
    if (!content) return
    setArtifactExportState({ kind: "exporting" })
    try {
      const blob = new Blob([content], { type: "text/html;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = deriveExportFilename(props.entry?.filename, "html")
      link.click()
      URL.revokeObjectURL(url)
      setArtifactExportState({ kind: "exported" })
    } catch (error) {
      setArtifactExportState({ kind: "error", error: error instanceof Error ? error.message : "html export failed" })
    }
  }

  /**
   * No server-side headless renderer exists yet for HTML→PDF (verified —
   * neither packages/unifia nor workbench-server wire one; @unifia/browser-runtime
   * has Playwright as a real dependency but only for browser-automation
   * sessions, not a stateless PDF render, and nothing consumes it
   * server-side today). Adding that capability (route, server dependency,
   * capability gate, a Chromium download) is a real follow-up, not this
   * button's blocker — the porte for this phase only requires the HTML
   * export to work. The browser's own native print-to-PDF, triggered on a
   * fresh window holding the artifact's content, is a complete, working
   * PDF export today: high-fidelity (it's the same rendering engine), no
   * new dependency, no new server surface.
   */
  function exportArtifactPdf(): void {
    const content = props.entry?.content
    if (!content) return
    setArtifactExportState({ kind: "exporting" })
    const printWindow = window.open("", "_blank", "noopener")
    if (!printWindow) {
      setArtifactExportState({ kind: "error", error: "popup blocked — allow popups to export as PDF" })
      return
    }
    printWindow.document.open()
    printWindow.document.write(content)
    printWindow.document.close()
    printWindow.onload = () => {
      printWindow.print()
      setArtifactExportState({ kind: "exported" })
    }
  }

  return (
    <div
      class="flex h-full min-h-0 flex-col gap-3"
      data-design-artifact-tab={props.entry?.artifactId ?? "missing"}
      data-design-artifact-complete={props.entry?.complete ? "true" : "false"}
      data-design-artifact-error={props.entry?.error ? "true" : "false"}
    >
      <Show when={props.entry}>
        {(entry) => (
          <div
            class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-base bg-background-stronger px-3 py-2"
            data-design-artifact-header
          >
            <div class="flex items-center gap-2">
              <span class="text-12-medium">{entry().filename}</span>
              <span class="text-12-regular text-text-weak">·</span>
              <span class="text-12-regular text-text-weak">{entry().kind}</span>
              <Show when={!entry().complete}>
                <span class="text-12-regular text-text-weak" data-design-artifact-status="streaming">streaming…</span>
              </Show>
              <Show when={entry().complete}>
                <span class="text-12-regular text-text-weak" data-design-artifact-status="complete">complet · {entry().content.length} caractères</span>
              </Show>
              <Show when={entry().error}>
                <span class="text-12-regular text-text-danger" data-design-artifact-error-msg>{entry().error}</span>
              </Show>
            </div>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="rounded border px-2 py-1 text-12-regular"
                classList={{
                  "border-border-focus text-text-base": props.selectMode,
                  "border-border-base text-text-weak": !props.selectMode,
                }}
                data-design-select-mode={props.selectMode ? "on" : "off"}
                aria-pressed={props.selectMode}
                onClick={() => props.onSelectMode(!props.selectMode)}
                title="Arme le pont de sélection : survole pour surligner, clique pour cibler un élément"
              >
                {props.selectMode ? "Sélection active…" : "Sélectionner un élément"}
              </button>
              <button
                type="button"
                class="rounded border px-2 py-1 text-12-regular"
                classList={{
                  "border-border-focus text-text-base": annotateMode(),
                  "border-border-base text-text-weak": !annotateMode(),
                }}
                data-design-annotate-mode={annotateMode() ? "on" : "off"}
                aria-pressed={annotateMode()}
                onClick={() => setAnnotateMode((value) => !value)}
                title="Dessine librement par-dessus le rendu"
              >
                {annotateMode() ? "Annotation active…" : "Annoter"}
              </button>
              <Show when={annotateMode() && annotationState().strokes.length > 0}>
                <button
                  type="button"
                  class="rounded border border-border-base px-2 py-1 text-12-regular text-text-weak"
                  data-design-annotate-undo
                  onClick={() => {
                    const next = undoStroke(annotationState())
                    setAnnotationState(next)
                    persistAnnotationState(next)
                  }}
                >
                  Annuler le trait
                </button>
                <button
                  type="button"
                  class="rounded border border-border-base px-2 py-1 text-12-regular text-text-weak"
                  data-design-annotate-clear
                  onClick={() => {
                    const next = clearStrokes(annotationState())
                    setAnnotationState(next)
                    persistAnnotationState(next)
                  }}
                >
                  Effacer
                </button>
              </Show>
            </div>
          </div>
        )}
      </Show>
      <Show when={annotationPersistError()}>
        <p class="rounded border border-border-danger bg-background-stronger px-3 py-2 text-12-regular text-text-danger" role="alert" data-design-annotation-persist-error>
          {annotationPersistError()}
        </p>
      </Show>
      <DesignToolbar
        viewport={props.viewport}
        zoom={props.zoom}
        mode={props.toolbarMode}
        hasSource={(props.entry?.content.length ?? 0) > 0}
        snapshot={props.snapshot}
        onViewport={props.onViewport}
        onZoom={props.onZoom}
        onMode={props.onToolbarMode}
        onSnapshot={props.onSnapshot}
        commentCount={openComments(props.commentState).length}
        commentPanelOpen={props.commentPanelOpen}
        onToggleCommentPanel={props.onToggleCommentPanel}
        copyState={props.copyState}
        onCopySnapshot={props.onCopySnapshot}
        onExportHtml={exportArtifactHtml}
        onExportPdf={exportArtifactPdf}
        exportState={artifactExportState()}
      />
      <Show when={props.connectionError}>
        <p class="rounded border border-border-danger bg-background-stronger px-3 py-2 text-12-regular text-text-danger" data-design-artifact-connection-error role="alert">
          Connexion perdue — l'aperçu reste figé sur le dernier état reçu. {props.connectionError}
        </p>
      </Show>
      <div class="flex h-full min-h-0 flex-1 gap-3">
        <div class="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border-base" data-design-artifact-mount>
          <ArtifactPreview
            artifactId={props.entry?.artifactId ?? ""}
            workspaceId=""
            source={props.entry?.content}
            mode={props.toolbarMode}
            viewport={props.viewport}
            zoom={props.zoom}
            selectMode={props.selectMode}
            onSelectTarget={(elementId, rect) => {
              if (!props.entry) return
              props.onSelectTarget(elementId, props.entry.artifactId, props.entry.filename, rect)
              // Un pick vaut confirmation : on désarme pour que le rendu
              // redevienne cliquable normalement.
              props.onSelectMode(false)
            }}
            onSnapshotReady={props.onSnapshotReady}
            pins={commentPins(props.commentState).map((pin, index) => ({ ...pin, label: String(index + 1) }))}
            onPinClick={props.onPinClick}
            annotate={annotateMode()}
            annotationStrokes={annotationState().strokes}
            onAnnotationStroke={onAnnotationStroke}
          />
        </div>
        <Show when={props.commentPanelOpen ? props.entry : undefined}>
          {(entry) => (
            <div class="w-72 shrink-0 overflow-y-auto rounded-lg border border-border-base bg-background-stronger p-3" data-design-comment-sidebar>
              <Show when={props.commentPersistError}>
                <p class="mb-2 text-12-regular text-text-danger" role="alert" data-design-comment-persist-error>
                  {props.commentPersistError}
                </p>
              </Show>
              <CommentPanel
                artifactId={props.commentTarget?.artifactId ?? entry().artifactId}
                state={props.commentState}
                entryFile={props.commentTarget?.entryFile ?? entry().filename}
                targetElementId={props.commentTarget?.elementId}
                targetRect={props.commentTarget?.rect}
                highlightedCommentId={props.highlightedCommentId}
                onChange={props.onCommentChange}
                onSendBatch={props.onSendCommentBatch}
                onSendOne={props.onSendCommentOne}
              />
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}
