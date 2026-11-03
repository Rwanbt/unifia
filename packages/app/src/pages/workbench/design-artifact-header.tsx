/* SPDX-License-Identifier: MIT */

import { Show, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { tDesignArtifact } from "@/i18n/design-artifact"
import type { StreamedArtifact } from "@/pages/workbench/use-artifact-stream"

/**
 * Header of a Design artifact tab: identity + status, then the action row
 * (pick, annotate, edit, present, share). Split out of design-artifact-tab.tsx
 * (ADR-099); every state lives in the tab, this only renders and calls back.
 * On a phone the action row scrolls horizontally instead of wrapping.
 */
export function DesignArtifactHeader(props: {
  entry: StreamedArtifact | undefined
  selectMode: boolean
  onSelectMode: (value: boolean) => void
  annotateMode: boolean
  onToggleAnnotate: () => void
  strokeCount: number
  onUndoStroke: () => void
  onClearStrokes: () => void
  editMode: boolean
  onToggleEdit: () => void
  editSaveError: string | undefined
  onPresentInTab: () => void
  onPresentFullscreen: () => void
  onPresentNewTab: () => void
  shareKind: "idle" | "minting" | "ready" | "error"
  onShareLink: () => void
  shareError: string | undefined
}): JSX.Element {
  const language = useLanguage()
  return (
    <Show when={props.entry}>
      {(entry) => (
        <div
          class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-base bg-background-stronger px-3 py-2"
          data-design-artifact-header
        >
          <div class="flex min-w-0 flex-wrap items-center gap-x-2">
            <span class="truncate text-12-medium">{entry().filename}</span>
            <span class="text-12-regular text-text-weak">·</span>
            <span class="text-12-regular text-text-weak">{entry().kind}</span>
            <Show when={!entry().complete}>
              <span class="text-12-regular text-text-weak" data-design-artifact-status="streaming">{tDesignArtifact(language.locale(), "artifact.status.streaming")}</span>
            </Show>
            <Show when={entry().complete}>
              <span class="text-12-regular text-text-weak" data-design-artifact-status="complete">{tDesignArtifact(language.locale(), "artifact.status.complete", { count: String(entry().content.length) })}</span>
            </Show>
            <Show when={entry().error}>
              <span class="text-12-regular text-text-danger" data-design-artifact-error-msg>{entry().error}</span>
            </Show>
          </div>
          <div class="-mx-1 flex w-full min-w-0 items-center gap-2 overflow-x-auto px-1 [scrollbar-width:none] md:w-auto [&>*]:shrink-0" data-design-artifact-actions>
            <button
              type="button"
              class="flex min-h-9 items-center whitespace-nowrap rounded border px-2 text-12-regular"
              classList={{
                "border-border-focus text-text-base": props.selectMode,
                "border-border-base text-text-weak": !props.selectMode,
              }}
              data-design-select-mode={props.selectMode ? "on" : "off"}
              aria-pressed={props.selectMode}
              onClick={() => props.onSelectMode(!props.selectMode)}
              title={tDesignArtifact(language.locale(), "artifact.select.tooltip")}
            >
              {props.selectMode
                ? tDesignArtifact(language.locale(), "artifact.select.active")
                : tDesignArtifact(language.locale(), "artifact.select.idle")}
            </button>
            <button
              type="button"
              class="flex min-h-9 items-center whitespace-nowrap rounded border px-2 text-12-regular"
              classList={{
                "border-border-focus text-text-base": props.annotateMode,
                "border-border-base text-text-weak": !props.annotateMode,
              }}
              data-design-annotate-mode={props.annotateMode ? "on" : "off"}
              aria-pressed={props.annotateMode}
              onClick={() => props.onToggleAnnotate()}
              title={tDesignArtifact(language.locale(), "artifact.annotate.tooltip")}
            >
              {props.annotateMode
                ? tDesignArtifact(language.locale(), "artifact.annotate.active")
                : tDesignArtifact(language.locale(), "artifact.annotate.idle")}
            </button>
            <button
              type="button"
              class="flex min-h-9 items-center whitespace-nowrap rounded border px-2 text-12-regular"
              classList={{
                "border-border-focus text-text-base": props.editMode,
                "border-border-base text-text-weak": !props.editMode,
              }}
              data-design-edit-mode={props.editMode ? "on" : "off"}
              aria-pressed={props.editMode}
              onClick={() => props.onToggleEdit()}
              title={tDesignArtifact(language.locale(), "artifact.edit.tooltip")}
            >
              {props.editMode
                ? tDesignArtifact(language.locale(), "artifact.edit.active")
                : tDesignArtifact(language.locale(), "artifact.edit.idle")}
            </button>
            <Show when={props.editSaveError}>
              <span class="text-12-regular text-text-danger" data-design-edit-save-error>
                {props.editSaveError}
              </span>
            </Show>
            <Show when={props.annotateMode && props.strokeCount > 0}>
              <button
                type="button"
                class="flex min-h-9 items-center whitespace-nowrap rounded border border-border-base px-2 text-12-regular text-text-weak"
                data-design-annotate-undo
                onClick={() => props.onUndoStroke()}
              >
                {tDesignArtifact(language.locale(), "artifact.annotate.undo")}
              </button>
              <button
                type="button"
                class="flex min-h-9 items-center whitespace-nowrap rounded border border-border-base px-2 text-12-regular text-text-weak"
                data-design-annotate-clear
                onClick={() => props.onClearStrokes()}
              >
                {tDesignArtifact(language.locale(), "artifact.annotate.clear")}
              </button>
            </Show>
            <div class="mx-1 h-5 w-px bg-border-base" aria-hidden="true" />
            <span class="whitespace-nowrap text-12-regular text-text-weak">{tDesignArtifact(language.locale(), "artifact.present.label")}</span>
            <button
              type="button"
              class="flex min-h-9 items-center whitespace-nowrap rounded border border-border-base px-2 text-12-regular text-text-weak"
              data-design-present-in-tab
              onClick={props.onPresentInTab}
            >
              {tDesignArtifact(language.locale(), "artifact.present.inTab")}
            </button>
            <button
              type="button"
              class="flex min-h-9 items-center whitespace-nowrap rounded border border-border-base px-2 text-12-regular text-text-weak"
              data-design-present-fullscreen
              onClick={() => props.onPresentFullscreen()}
            >
              {tDesignArtifact(language.locale(), "artifact.present.fullscreen")}
            </button>
            <button
              type="button"
              class="flex min-h-9 items-center whitespace-nowrap rounded border border-border-base px-2 text-12-regular text-text-weak"
              data-design-present-new-tab
              onClick={() => props.onPresentNewTab()}
            >
              {tDesignArtifact(language.locale(), "artifact.present.newTab")}
            </button>
            <div class="mx-1 h-5 w-px bg-border-base" aria-hidden="true" />
            <button
              type="button"
              class="flex min-h-9 items-center whitespace-nowrap rounded border border-border-base px-2 text-12-regular text-text-weak disabled:opacity-50"
              disabled={props.shareKind === "minting"}
              data-design-share-link
              onClick={() => props.onShareLink()}
              title={tDesignArtifact(language.locale(), "artifact.share.tooltip")}
            >
              {props.shareKind === "minting"
                ? tDesignArtifact(language.locale(), "artifact.share.minting")
                : tDesignArtifact(language.locale(), "artifact.share.idle")}
            </button>
            <Show when={props.shareKind === "ready"}>
              <span class="text-12-regular text-text-weak" data-design-share-link-copied>
                {tDesignArtifact(language.locale(), "artifact.copied")}
              </span>
            </Show>
            <Show when={props.shareError}>
              {(error) => (
                <span class="text-12-regular text-text-danger" data-design-share-link-error>
                  {error()}
                </span>
              )}
            </Show>
          </div>
        </div>
      )}
    </Show>
  )
}
