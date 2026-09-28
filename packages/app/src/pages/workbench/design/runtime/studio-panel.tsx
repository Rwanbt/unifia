/* SPDX-License-Identifier: MIT */

import { createSignal, For, Show, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import type { DesignCommand } from "../model/commands"
import type { DesignDocumentV1, DesignNodeId } from "../model/schema"
import { DesignLayersPanel } from "./layers-panel"
import { StudioIcon, type StudioIconName } from "./studio-icons"
import type { DesignTool } from "./tools"

export type DesignStudioView = "preview" | "source"

/** A design-system catalogue as the workspace manifest declares it. */
export type DesignStudioCatalog = {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly tokens: { readonly colors: Readonly<Record<string, string>> }
}

/** Colour swatches shown per catalogue row in the Design System tab. */
const CATALOG_SWATCHES = 6

/**
 * Left panel of the Design studio, the reference's `#designLayers`
 * ("Outils design"). Every enabled control drives the canonical document or
 * the studio; the ones with no engine in the app stay visible, disabled and
 * labelled "coming soon" instead of pretending (ADR-085).
 */
export function DesignStudioPanel(props: {
  document: DesignDocumentV1
  selection: readonly DesignNodeId[]
  onSelect: (id: DesignNodeId) => void
  onCommand: (command: DesignCommand) => void
  tool: DesignTool
  onTool: (tool: DesignTool) => void
  view: DesignStudioView
  onView: (view: DesignStudioView) => void
  commentsOpen: boolean
  commentCount: number
  onToggleComments: () => void
  onRefresh: () => void
  onExport: () => void
  onCollapse: () => void
  catalogs: readonly DesignStudioCatalog[]
  workshop?: JSX.Element
}): JSX.Element {
  const language = useLanguage()
  const t = language.t
  const [tab, setTab] = createSignal<"structure" | "system">("structure")
  const soon = (label: string) => t("design.studio.soon", { label })

  const Pending = (item: { icon: StudioIconName; label: string }) => (
    <button type="button" data-design-studio-tool={item.icon} aria-disabled="true" title={soon(item.label)} aria-label={soon(item.label)}>
      <StudioIcon name={item.icon} />
    </button>
  )

  return (
    <>
      <button
        type="button"
        data-design-studio-collapse
        title={t("design.studio.panel.collapse")}
        aria-label={t("design.studio.panel.collapse")}
        onClick={() => props.onCollapse()}
      >
        <StudioIcon name="collapse" />
      </button>
      <div data-design-studio-head>
        <b>{t("design.studio.panel.title")}</b>
        <span>{t("design.studio.panel.subtitle")}</span>
        {props.workshop}
      </div>
      <div data-design-studio-actions>
        <div data-design-studio-row="1">
          <button
            type="button"
            data-design-studio-tool="refresh"
            title={t("design.studio.refresh")}
            aria-label={t("design.studio.refresh")}
            onClick={() => props.onRefresh()}
          >
            <StudioIcon name="refresh" />
          </button>
          <div data-design-studio-view-switch role="radiogroup" aria-label={t("design.studio.view.label")}>
            <For each={["preview", "source"] as const}>
              {(view) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={props.view === view}
                  title={t(`design.studio.view.${view}`)}
                  aria-label={t(`design.studio.view.${view}`)}
                  data-design-studio-view={view}
                  onClick={() => props.onView(view)}
                >
                  <StudioIcon name={view} />
                </button>
              )}
            </For>
          </div>
          <button
            type="button"
            data-design-studio-tool="format"
            aria-disabled="true"
            title={soon(t("design.studio.format"))}
            aria-label={soon(t("design.studio.format"))}
          >
            <StudioIcon name="desktop" />
            <i data-design-studio-caret>⌄</i>
          </button>
        </div>
        <div data-design-studio-row="2">
          <Pending icon="capture" label={t("design.studio.capture")} />
          <Pending icon="inspect" label={t("design.studio.inspect")} />
          <button
            type="button"
            data-design-tool="comment"
            aria-pressed={props.tool === "comment"}
            title={t("design.studio.comment")}
            aria-label={t("design.studio.comment")}
            onClick={() => props.onTool(props.tool === "comment" ? "select" : "comment")}
          >
            <StudioIcon name="comment" />
          </button>
          <Pending icon="annotate" label={t("design.studio.annotate")} />
          <Pending icon="modify" label={t("design.studio.modify")} />
          <Pending icon="vector" label={t("design.studio.vector")} />
        </div>
        <div data-design-studio-row="3">
          <Pending icon="history" label={t("design.studio.history")} />
          <button
            type="button"
            data-design-studio-tool="comments"
            aria-pressed={props.commentsOpen}
            title={t("design.studio.comments")}
            aria-label={t("design.studio.comments")}
            onClick={() => props.onToggleComments()}
          >
            <StudioIcon name="comments" />
            <Show when={props.commentCount > 0}>
              <i data-design-studio-count>{props.commentCount}</i>
            </Show>
          </button>
          <button
            type="button"
            data-design-studio-tool="export"
            title={t("design.studio.export")}
            aria-label={t("design.studio.export")}
            onClick={() => props.onExport()}
          >
            <StudioIcon name="export" />
          </button>
          <Pending icon="share" label={t("design.studio.share")} />
          <Pending icon="audit" label={t("design.studio.audit")} />
        </div>
      </div>
      <div data-design-studio-tabs role="tablist">
        <For each={["structure", "system"] as const}>
          {(entry) => (
            <button
              type="button"
              role="tab"
              aria-selected={tab() === entry}
              data-design-studio-tab={entry}
              onClick={() => setTab(entry)}
            >
              {t(`design.studio.tab.${entry}`)}
            </button>
          )}
        </For>
      </div>
      <Show
        when={tab() === "structure"}
        fallback={
          <div data-design-studio-system>
            <Show when={props.catalogs.length > 0} fallback={<p data-design-studio-empty>{t("design.studio.system.empty")}</p>}>
              <For each={props.catalogs}>
                {(catalog) => (
                  <div data-design-studio-catalog={catalog.id}>
                    <span>
                      {catalog.name} · {catalog.version}
                    </span>
                    <span data-design-studio-swatches>
                      <For each={Object.values(catalog.tokens.colors).slice(0, CATALOG_SWATCHES)}>
                        {(color) => <i style={{ background: color }} />}
                      </For>
                    </span>
                  </div>
                )}
              </For>
            </Show>
          </div>
        }
      >
        <div data-design-studio-create>
          <button type="button" onClick={() => props.onTool("rectangle")}>
            <span>＋</span>
            {t("design.studio.create")}
          </button>
        </div>
        <div data-design-studio-label>{t("design.studio.pages")}</div>
        <div data-design-studio-pages>
          <div data-design-studio-page data-active="">
            <span>▧</span>
            <span>{props.document.name}</span>
            <button type="button" aria-disabled="true" title={soon(t("design.studio.pageActions"))} aria-label={soon(t("design.studio.pageActions"))}>
              •••
            </button>
          </div>
          <button type="button" data-design-studio-page-add aria-disabled="true" title={soon(t("design.studio.newPage"))}>
            + {t("design.studio.newPage")}
          </button>
        </div>
        <div data-design-studio-label>{t("design.studio.layers")}</div>
        <DesignLayersPanel
          document={props.document}
          selection={props.selection}
          onSelect={props.onSelect}
          onCommand={props.onCommand}
        />
      </Show>
    </>
  )
}
