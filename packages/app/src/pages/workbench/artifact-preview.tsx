/* SPDX-License-Identifier: MIT */

import { For, Match, Show, Switch, createEffect, createSignal, onCleanup, type JSX } from "solid-js"
import {
  buildSrcdoc,
  htmlNeedsFocusGuard,
  htmlNeedsStorageShim,
  shouldUrlLoad,
  type RenderDecision,
  type SrcdocOptions,
} from "@unifia/artifact-render"
import { useLanguage } from "@/context/language"
import { useWorkspaceWorkbench } from "@/context/workbench/provider"
import { workbenchQueryKey } from "@/context/workbench/query-keys"
import { createQuery } from "@tanstack/solid-query"
import {
  ALLOWED_MESSAGE_TYPES,
  ALLOWED_SENT_TYPES,
  PREVIEW_SANDBOX,
} from "@/pages/workbench/artifact-preview-protocol"

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
  const [lastMessage, setLastMessage] = createSignal<{ type: string; data: unknown } | undefined>()
  createEffect(() => {
    function onMessage(event: MessageEvent): void {
      if (typeof event.data !== "object" || event.data === null) return
      const data = event.data as { type?: unknown; [key: string]: unknown }
      if (typeof data.type !== "string") return
      if (!ALLOWED_MESSAGE_TYPES.has(data.type)) return
      setLastMessage({ type: data.type, data })
    }
    window.addEventListener("message", onMessage)
    onCleanup(() => window.removeEventListener("message", onMessage))
  })

  // Send `unifia:ready` once the iframe has actually mounted, so the
  // host can synchronise with the artifact's reported state. This
  // mirrors the v1 catalogue in ADR-1037.
  let frame: HTMLIFrameElement | undefined
  function onMount(element: HTMLIFrameElement): void {
    frame = element
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

  return (
    <div class="flex h-full min-h-0 flex-col" data-design-preview-mount data-design-preview-render-mode={renderMode()}>
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
          <iframe
            ref={onMount}
            sandbox={PREVIEW_SANDBOX}
            srcdoc={srcdoc()}
            data-design-preview="html"
            title={t("design.preview.title")}
            class="size-full border-0"
          />
        </Show>
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
