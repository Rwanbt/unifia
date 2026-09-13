/* SPDX-License-Identifier: MIT */

import type { ArtifactDocument } from "@/pages/session/use-artifact-loader"

/**
 * Vague 4 P1-5 (ADR-037) — read-only Workbench artifact viewer.
 *
 * Renders the artifact document resolved via the `?artifact=...` query
 * param. The host (session.tsx) still owns the signals from
 * `useArtifactLoader`; this file only reshapes the JSX block so the
 * orchestrator stays compact.
 *
 * Contract: the caller MUST wrap this in `<Show when={artifactDocument() || artifactError()}>`.
 * The wrapper assumes at least one of the two is defined; rendering both
 * `undefined` would produce an empty `<section>` (still safe, just ugly).
 *
 * Why no inner `<Show>`: the caller already owns the "is there anything
 * to show" decision. Adding a second one would double the reactive
 * tracking for the same condition.
 */
export interface SessionArtifactViewerSectionProps {
  artifactDocument: () => ArtifactDocument | undefined
  artifactError: () => string | undefined
}

export function SessionArtifactViewerSection(props: SessionArtifactViewerSectionProps) {
  const error = () => props.artifactError()
  const document = () => props.artifactDocument()
  return (
    <section
      class="mx-4 mt-2 max-h-72 overflow-auto rounded-lg border border-border-base bg-background-stronger p-3"
      data-code-artifact-viewer
    >
      <div class="flex items-center justify-between gap-3 text-12-medium">
        <span>{document()?.filename ?? "Artifact"}</span>
        <span class="text-text-weak">Workbench artifact · read-only</span>
      </div>
      {error() ? (
        <p class="mt-3 text-12-regular text-text-danger">{error()}</p>
      ) : (
        <pre class="mt-3 whitespace-pre-wrap font-mono text-12-regular text-text-weak">
          {document()?.content}
        </pre>
      )}
    </section>
  )
}
