/* SPDX-License-Identifier: MIT */

import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js"
import {
  buildSrcdoc,
  htmlNeedsFocusGuard,
  htmlNeedsStorageShim,
  shouldUrlLoad,
  DEFAULT_VIEWPORT,
  DEFAULT_ZOOM,
  SNAPSHOT_TIMEOUT_MS,
  effectiveScale,
  findViewport,
  type RenderDecision,
  type SrcdocOptions,
  type ViewportId,
} from "@unifia/artifact-render"
import { useLanguage } from "@/context/language"
import { useWorkspaceWorkbench } from "@/context/workbench/provider"
import { workbenchQueryKey } from "@/context/workbench/query-keys"
import { createQuery } from "@tanstack/solid-query"
import {
  ALLOWED_MESSAGE_TYPES,
  ALLOWED_SENT_TYPES,
  PREVIEW_SANDBOX,
  parsePreviewMessage,
  type PreviewRect,
} from "@/pages/workbench/artifact-preview-protocol"
import type { DesignToolbarMode } from "@/pages/workbench/design-toolbar"

/**
 * Re-export of the protocol catalogue so other files in this folder
 * (e.g. a future `picker.ts` or `snapshot.ts`) can compose without
 * re-declaring the union. The constants themselves live in
 * `artifact-preview-protocol.ts` so the test suite can import them
 * in isolation without resolving `@unifia/artifact-render`.
 */
export { ALLOWED_MESSAGE_TYPES, ALLOWED_SENT_TYPES, PREVIEW_SANDBOX }

export function ArtifactPreview(props: {
  artifactId: string
  workspaceId: string
  /** Optional inline source. When provided, takes priority over the server fetch. */
  source?: string
  /** Forwarded to buildSrcdoc — storage shim and focus guard are on by default. */
  srcdocOptions?: SrcdocOptions
  /** P16 — mode "preview" (iframe) ou "source" (texte readonly). */
  mode?: DesignToolbarMode
  /** P16 — viewport pour la mise à l'échelle du container iframe. */
  viewport?: ViewportId
  /** P16 — multiplicateur zoom utilisateur en % (50/75/100/125/150/200). */
  zoom?: number
  /**
   * P18 — quand vrai, le pont de sélection est injecté et armé : survol
   * surligné, clic renvoie l'élément. Les éléments structurels sans
   * identité reçoivent un `data-unifia-id` calculé (annotate), sinon un
   * HTML importé n'offrirait aucune cible cliquable.
   */
  selectMode?: boolean
  /** P18 — appelé quand l'utilisateur pique un élément dans le rendu. */
  onSelectTarget?: (elementId: string, rect: PreviewRect) => void
  /**
   * P17 — reçoit la fonction de capture une fois l'iframe montée. Le parent
   * la garde et l'appelle depuis sa barre d'outils ; elle résout avec le
   * dataUrl ou rejette avec le motif exact renvoyé par le pont (jamais une
   * image vide silencieuse).
   */
  onSnapshotReady?: (request: () => Promise<{ dataUrl: string; w: number; h: number }>) => void
}): JSX.Element {
  const language = useLanguage()
  const t = language.t
  const workbench = useWorkspaceWorkbench()
  const connection = workbench.connection

  // Fetch the raw artifact bytes from the server when no inline source is
  // provided. The server route is added in P10; this is the first
  // consumer. Failures surface as the visible error state below rather
  // than as a silent blank iframe.
  const inlineProvided = () => props.source !== undefined
  const rawQuery = createQuery(() => ({
    queryKey: workbenchQueryKey(connection(), "artifact-raw", { artifactId: props.artifactId, workspaceId: props.workspaceId }),
    enabled: !!connection() && !inlineProvided(),
    queryFn: async () => {
      const current = connection()
      if (!current) throw new Error("workbench connection lost")
      const response = await current.client.readArtifactRaw(props.workspaceId, props.artifactId, props.artifactId)
      const buf = await response.arrayBuffer()
      return new TextDecoder().decode(new Uint8Array(buf))
    },
  }))

  const source = (): string | undefined => {
    if (props.source !== undefined) return props.source
    if (rawQuery.data) return rawQuery.data
    return undefined
  }

  // The iframe's srcDoc. We rebuild it whenever the source changes so
  // edits to the source (in a future P13+ draft editor) re-mount the
  // iframe with the new content. The buildSrcdoc call is pure.
  //
  // P15 — Rechargement à chaud : dans le mode streaming, `source` est
  // rafraîchi toutes les ~100 ms (debounce du controller). Chaque
  // rebuild ré-instancie l'iframe, ce qui **perd la position de
  // défilement**. C'est accepté en v1 (runbook P15 §« Spécification
  // exacte » alinéa 5) — on ne tente PAS de préserver le scroll
  // par une astuce (postMessage vers l'iframe, MutationObserver, etc.) ;
  // la persistance du scroll est hors scope v1.
  //
  // The P12 heuristics decide whether the storage shim and the focus
  // guard must be injected. We delegate to the pure functions in
  // `@unifia/artifact-render` so the rules are testable in isolation
  // and identical to the documented spec. An explicit `props.srcdocOptions`
  // from the caller still wins (so a parent can force the shim off
  // for an artifact that explicitly does not need it).
  const srcdoc = (): string => {
    const body = source() ?? ""
    const heuristicOptions: SrcdocOptions = {
      storageShim: htmlNeedsStorageShim(body),
      focusGuard: htmlNeedsFocusGuard(body),
      // P17/P18 — le pont snapshot est toujours injecté : le lier à une
      // option forcerait une reconstruction du srcDoc à chaque capture,
      // donc un clignotement visible. Le pont de sélection et
      // l'auto-annotation suivent le mode, parce qu'ils ajoutent des
      // écouteurs et des attributs au document rendu.
      snapshotBridge: true,
      selectionBridge: props.selectMode === true,
      annotate: props.selectMode === true,
    }
    return buildSrcdoc(body, { ...heuristicOptions, ...props.srcdocOptions })
  }

  // The P12 decision function. The component is currently srcDoc-only
  // (the artifact body is fetched in this component and passed to
  // `buildSrcdoc`); the decision is exposed as a data attribute so
  // future P13+ work can switch to URL loading and so the dev console
  // can see why a given artifact went one way or the other.
  const renderDecision = (): RenderDecision => {
    const body = source() ?? ""
    return {
      mode: "preview",
      // The bridge layer is needed whenever the source asks for a
      // shim or a focus guard. If a future P15+ injects additional
      // bridges (selection, snapshot, etc.), the OR will be extended.
      needsBridge: htmlNeedsStorageShim(body) || htmlNeedsFocusGuard(body),
      forceInline: false,
    }
  }
  const renderMode = (): "url" | "srcDoc" => (shouldUrlLoad(renderDecision()) ? "url" : "srcDoc")

  // Bridge: window message listener. We mount it once per artifact
  // preview instance and tear it down on cleanup. Messages whose type
  // is not in ALLOWED_MESSAGE_TYPES are dropped silently (no logging
  // of the payload).
  // Déclaré ici et non plus bas : les effets de sélection et de capture
  // ci-dessous le référencent au setup, et une déclaration plus tardive
  // les ferait tomber dans la zone morte temporelle du `let`.
  let frame: HTMLIFrameElement | undefined
  const [lastMessage, setLastMessage] = createSignal<{ type: string; data: unknown } | undefined>()
  // P17 — captures en vol, indexées par id. Une capture qui ne revient pas
  // dans le délai est rejetée explicitement plutôt que laissée pendante.
  const pending = new Map<string, { resolve: (r: { dataUrl: string; w: number; h: number }) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  function settle(id: string): { resolve: (r: { dataUrl: string; w: number; h: number }) => void; reject: (e: Error) => void } | undefined {
    const entry = pending.get(id)
    if (!entry) return undefined
    clearTimeout(entry.timer)
    pending.delete(id)
    return entry
  }
  createEffect(() => {
    function onMessage(event: MessageEvent): void {
      const message = parsePreviewMessage(event.data)
      if (!message) return
      setLastMessage({ type: message.type, data: message })
      if (message.type === "unifia:select-target") {
        props.onSelectTarget?.(message.elementId, message.rect)
        return
      }
      if (message.type === "unifia:snapshot-result") {
        settle(message.id)?.resolve({ dataUrl: message.dataUrl, w: message.w, h: message.h })
        return
      }
      if (message.type === "unifia:snapshot-error") {
        settle(message.id)?.reject(new Error(message.error))
      }
    }
    window.addEventListener("message", onMessage)
    onCleanup(() => {
      window.removeEventListener("message", onMessage)
      for (const [, entry] of pending) {
        clearTimeout(entry.timer)
        entry.reject(new Error("preview-unmounted"))
      }
      pending.clear()
    })
  })

  let snapshotCounter = 0
  function requestSnapshot(): Promise<{ dataUrl: string; w: number; h: number }> {
    const target = frame?.contentWindow
    if (!target) return Promise.reject(new Error("no-frame"))
    const id = `snap-${++snapshotCounter}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error("timeout"))
      }, SNAPSHOT_TIMEOUT_MS)
      pending.set(id, { resolve, reject, timer })
      try {
        target.postMessage({ type: "unifia:snapshot", id, full: false }, "*")
      } catch {
        settle(id)
        reject(new Error("post-failed"))
      }
    })
  }

  // P18 — (dés)armer le pont à chaque bascule. Le srcDoc est reconstruit
  // quand `selectMode` change (il pilote l'injection), et le pont boote
  // déjà armé ; ce postMessage couvre le cas où le mode change sans que
  // le document soit reconstruit.
  createEffect(() => {
    const enabled = props.selectMode === true
    const target = frame?.contentWindow
    if (!target) return
    try {
      target.postMessage({ type: "unifia:select-mode", enabled, tool: "picker" }, "*")
    } catch {
      // L'iframe peut être en cours de swap de srcDoc ; le boot armé du
      // pont prend le relais. Silencieux par contrat (ADR-1037 §3).
    }
  })

  // Send `unifia:ready` once the iframe has actually mounted, so the
  // host can synchronise with the artifact's reported state. This
  // mirrors the v1 catalogue in ADR-1037.
  function onMount(element: HTMLIFrameElement): void {
    frame = element
    props.onSnapshotReady?.(requestSnapshot)
    queueMicrotask(() => {
      try {
        if (frame && frame.contentWindow) {
          frame.contentWindow.postMessage({ type: "unifia:ready" }, "*")
        }
      } catch {
        // contentWindow can be null right after the iframe swaps the
        // srcDoc; the next mount cycle will retry. We deliberately do
        // not log — the spec says dropped messages are silent.
      }
    })
  }

  // P16 — mode "preview" (par défaut) ou "source" ; viewport pour la mise
  // à l'échelle du container iframe ; zoom utilisateur.
  const currentMode = (): DesignToolbarMode => props.mode ?? "preview"
  const currentViewport = (): ViewportId => props.viewport ?? DEFAULT_VIEWPORT
  const currentZoom = (): number => props.zoom ?? DEFAULT_ZOOM
  const preset = createMemo(() => findViewport(currentViewport()))
  // Canvas size observed via ResizeObserver on the container wrapper.
  const [canvas, setCanvas] = createSignal({ width: 0, height: 0 })
  let container: HTMLDivElement | undefined
  function onContainerMount(element: HTMLDivElement): void {
    container = element
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      setCanvas({ width, height })
    })
    ro.observe(element)
    onCleanup(() => ro.disconnect())
  }
  const scale = createMemo(() => effectiveScale(currentViewport(), canvas().width, canvas().height, currentZoom()))

  return (
    <div
      class="flex h-full min-h-0 flex-col"
      data-design-preview-mount
      data-design-preview-render-mode={renderMode()}
      data-design-preview-mode={currentMode()}
      data-design-preview-viewport={currentViewport()}
      data-design-preview-zoom={currentZoom()}
    >
      <Show when={currentMode() === "source"} fallback={
        <Show
          when={!rawQuery.error || inlineProvided()}
          fallback={
            <PreviewError
              title={t("design.preview.errorTitle")}
              message={
                rawQuery.error instanceof Error
                  ? rawQuery.error.message
                  : t("design.preview.errorRead")
              }
            />
          }
        >
          <Show
            when={source() !== undefined && source() !== ""}
            fallback={<PreviewError title={t("design.preview.empty")} message={t("design.preview.emptyHint")} />}
          >
            <div
              ref={onContainerMount}
              class="relative size-full overflow-auto"
              data-design-preview-canvas={JSON.stringify(canvas)}
              data-design-preview-scale={scale()}
            >
              <div
                class="origin-top-center"
                style={{
                  width: `${preset().width}px`,
                  height: `${preset().height}px`,
                  transform: `scale(${scale()})`,
                }}
                data-design-preview-frame
              >
                <iframe
                  ref={onMount}
                  sandbox={PREVIEW_SANDBOX}
                  srcdoc={srcdoc()}
                  data-design-preview="html"
                  title={t("design.preview.title")}
                  class="size-full border-0"
                />
              </div>
            </div>
          </Show>
        </Show>
      }>
        <div
          ref={onContainerMount}
          class="size-full overflow-auto"
          data-design-preview-source
        >
          <pre class="size-full whitespace-pre-wrap break-words p-4 font-mono text-12-regular text-text-base" data-design-preview-source-text>
            <Show when={source() !== undefined && source() !== ""} fallback={t("workbench.design.toolbar.sourceEmpty")}>
              {source()}
            </Show>
          </pre>
        </div>
      </Show>
      <Show when={lastMessage()}>
        {(message) => (
          <div
            class="pointer-events-none absolute right-2 top-2 max-w-xs truncate rounded bg-background-stronger px-2 py-1 text-12-regular text-text-weak shadow"
            data-design-preview-last-message={message().type}
            aria-live="polite"
          >
            {t("design.preview.lastMessage", { type: message().type })}
          </div>
        )}
      </Show>
    </div>
  )
}

function PreviewError(props: { title: string; message: string }): JSX.Element {
  return (
    <div
      class="flex h-full min-h-0 flex-col items-center justify-center gap-2 p-6 text-center"
      data-design-preview-error
      role="alert"
    >
      <p class="text-14-medium text-text-danger">{props.title}</p>
      <p class="max-w-prose text-12-regular text-text-weak">{props.message}</p>
    </div>
  )
}

// Suppress an unused-import warning for the `Switch` and `Match` imports
// (they are not used in this slice; the iframe rendering is single-branch).
// We keep them imported so the future P15+ branches (select mode, snapshot
// mode) can switch on the iframe's intent without a new import.
void For
void Switch
void Match
