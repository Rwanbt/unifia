/* SPDX-License-Identifier: MIT */

import { createSignal, For, Show, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import type { DesignCommand } from "../model/commands"
import type { DesignDocumentV1, DesignNodeId } from "../model/schema"
import { DesignLayersPanel } from "./layers-panel"
import { tStudioTools } from "@/i18n/design-studio-tools"
import { designPages, FORMAT_PRESETS, type FormatPresetId } from "./studio-actions"
import type { DesignStudioAction } from "./studio-controller"
import type { DesignToolPanelMode } from "./studio-tool-panel"
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
 * ("Outils design"). Every control drives the canonical document or the
 * studio; the twelve that ADR-085 left "unavailable" are implemented since
 * the owner's directive of 2026-11-03 (ADR-085 amendment).
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
  activePanel?: DesignToolPanelMode
  onAction: (action: DesignStudioAction) => void
  onFormat: (preset: FormatPresetId) => void
  onNewPage: () => void
  onShowPage: (id: DesignNodeId | undefined) => void
  onRenamePage: (id: DesignNodeId, name: string) => void
  onDuplicatePage: (id: DesignNodeId) => void
  onDeletePage: (id: DesignNodeId) => void
}): JSX.Element {
  const language = useLanguage()
  const t = language.t
  const [tab, setTab] = createSignal<"structure" | "system">("structure")
  const tr = (key: Parameters<typeof tStudioTools>[1]) => tStudioTools(language.locale(), key)
  const [formatOpen, setFormatOpen] = createSignal(false)
  const [pageMenu, setPageMenu] = createSignal<DesignNodeId>()
  const [renaming, setRenaming] = createSignal<DesignNodeId>()
  const pages = () => designPages(props.document)

  /** A studio action button: panels show as pressed while open. */
  const Action = (item: { icon: StudioIconName; label: string; action: DesignStudioAction; pressed?: boolean }) => (
    <button
      type="button"
      data-design-studio-tool={item.icon}
      aria-pressed={item.pressed}
      title={item.label}
      aria-label={item.label}
      onClick={() => props.onAction(item.action)}
    >
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
          <div data-design-studio-format>
            <button
              type="button"
              data-design-studio-tool="format"
              aria-haspopup="menu"
              aria-expanded={formatOpen()}
              title={t("design.studio.format")}
              aria-label={t("design.studio.format")}
              onClick={() => setFormatOpen((value) => !value)}
            >
              <StudioIcon name="desktop" />
              <i data-design-studio-caret>⌄</i>
            </button>
            <Show when={formatOpen()}>
              <div role="menu" data-design-studio-format-menu aria-label={tr("format.title")}>
                <For each={FORMAT_PRESETS}>
                  {(preset) => (
                    <button
                      type="button"
                      role="menuitem"
                      data-design-studio-format-preset={preset.id}
                      onClick={() => {
                        setFormatOpen(false)
                        props.onFormat(preset.id)
                      }}
                    >
                      {tr(`format.${preset.id}`)}
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>
        <div data-design-studio-row="2">
          <Action icon="capture" label={t("design.studio.capture")} action="capture" />
          <Action icon="inspect" label={t("design.studio.inspect")} action="inspect" pressed={props.activePanel === "inspect"} />
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
          <button
            type="button"
            data-design-studio-tool="annotate"
            data-design-tool="annotate"
            aria-pressed={props.tool === "annotate"}
            title={t("design.studio.annotate")}
            aria-label={t("design.studio.annotate")}
            onClick={() => props.onTool(props.tool === "annotate" ? "select" : "annotate")}
          >
            <StudioIcon name="annotate" />
          </button>
          <Action icon="modify" label={t("design.studio.modify")} action="modify" pressed={props.activePanel === "modify"} />
          <Action icon="vector" label={t("design.studio.vector")} action="vector" />
        </div>
        <div data-design-studio-row="3">
          <Action icon="history" label={t("design.studio.history")} action="history" pressed={props.activePanel === "history"} />
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
          <Action icon="share" label={t("design.studio.share")} action="share" />
          <Action icon="audit" label={t("design.studio.audit")} action="audit" pressed={props.activePanel === "audit"} />
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
          <Show
            when={pages().length > 0}
            fallback={
              <div data-design-studio-page data-active="">
                <span>▧</span>
                <button type="button" data-design-studio-page-show onClick={() => props.onShowPage(undefined)}>
                  {props.document.name}
                </button>
              </div>
            }
          >
            <For each={pages()}>
              {(page) => (
                <div data-design-studio-page={page.id} data-active={props.selection.includes(page.id) ? "" : undefined}>
                  <span>▧</span>
                  <Show
                    when={renaming() === page.id}
                    fallback={
                      <button type="button" data-design-studio-page-show onClick={() => props.onShowPage(page.id)}>
                        {page.name}
                      </button>
                    }
                  >
                    <input
                      data-design-studio-page-rename-input
                      value={page.name}
                      aria-label={tr("page.rename")}
                      ref={(element) => queueMicrotask(() => element.select())}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur()
                        if (event.key === "Escape") setRenaming(undefined)
                      }}
                      onBlur={(event) => {
                        if (renaming() === page.id) props.onRenamePage(page.id, event.currentTarget.value)
                        setRenaming(undefined)
                      }}
                    />
                  </Show>
                  <button
                    type="button"
                    data-design-studio-page-actions={page.id}
                    aria-haspopup="menu"
                    aria-expanded={pageMenu() === page.id}
                    title={tr("page.actions")}
                    aria-label={tr("page.actions")}
                    onClick={() => setPageMenu((current) => (current === page.id ? undefined : page.id))}
                  >
                    •••
                  </button>
                  <Show when={pageMenu() === page.id}>
                    <div role="menu" data-design-studio-page-menu>
                      <button type="button" role="menuitem" data-design-studio-page-rename onClick={() => { setPageMenu(undefined); setRenaming(page.id) }}>
                        {tr("page.rename")}
                      </button>
                      <button type="button" role="menuitem" data-design-studio-page-duplicate onClick={() => { setPageMenu(undefined); props.onDuplicatePage(page.id) }}>
                        {tr("page.duplicate")}
                      </button>
                      <button type="button" role="menuitem" data-design-studio-page-delete onClick={() => { setPageMenu(undefined); props.onDeletePage(page.id) }}>
                        {tr("page.delete")}
                      </button>
                    </div>
                  </Show>
                </div>
              )}
            </For>
            <button type="button" data-design-studio-page-show data-design-studio-page-all onClick={() => props.onShowPage(undefined)}>
              {tr("page.canvas")}
            </button>
          </Show>
          <button type="button" data-design-studio-page-add onClick={() => props.onNewPage()}>
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
