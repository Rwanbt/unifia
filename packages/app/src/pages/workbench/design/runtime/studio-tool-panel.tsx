/* SPDX-License-Identifier: MIT */

import { For, Show, createMemo, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { tStudioTools, type DesignStudioToolsKey } from "@/i18n/design-studio-tools"
import type { DesignCommand } from "../model/commands"
import {
  DESIGN_TEXT_DEFAULTS,
  type DesignDocumentV1,
  type DesignNodeId,
  type DesignNodeV1,
  type DesignTextAlign,
  type TextNodeV1,
} from "../model/schema"
import { colorInputValue } from "./studio-actions"
import { auditDesignDocument, contrastRatio } from "./studio-audit"

export type DesignToolPanelMode = "inspect" | "modify" | "history" | "audit"

/**
 * Floating panel of the studio's Inspect, Modify, History and Audit actions
 * (ADR-085 amendment). Pure view: every edit leaves as a typed command, and
 * history restores go through the tab's own undo, so one source of truth.
 */
export function DesignStudioToolPanel(props: {
  mode: DesignToolPanelMode
  document: DesignDocumentV1
  selection: readonly DesignNodeId[]
  history: readonly DesignDocumentV1[]
  onCommand: (command: DesignCommand) => void
  onSelect: (ids: readonly DesignNodeId[]) => void
  onRestore: (stepsBack: number) => void
  onClose: () => void
}): JSX.Element {
  const language = useLanguage()
  const tr = (key: DesignStudioToolsKey, params?: Record<string, string | number>) => tStudioTools(language.locale(), key, params)
  return (
    <aside data-design-tool-panel={props.mode} aria-label={tr(`panel.${props.mode}`)}>
      <header>
        <b>{tr(`panel.${props.mode}`)}</b>
        <button type="button" data-design-tool-panel-close aria-label={tr("panel.close")} onClick={() => props.onClose()}>
          ×
        </button>
      </header>
      <Show when={props.mode === "inspect" || props.mode === "modify"}>
        <PropertiesView {...props} editable={props.mode === "modify"} tr={tr} />
      </Show>
      <Show when={props.mode === "history"}>
        <HistoryView history={props.history} document={props.document} onRestore={props.onRestore} tr={tr} />
      </Show>
      <Show when={props.mode === "audit"}>
        <AuditView document={props.document} onSelect={props.onSelect} tr={tr} />
      </Show>
    </aside>
  )
}

type Tr = (key: DesignStudioToolsKey, params?: Record<string, string | number>) => string

function styleOf(node: DesignNodeV1): { fill?: string; stroke?: string; strokeWidth?: number; opacity?: number } | undefined {
  if (node.type === "line") return { stroke: node.stroke, strokeWidth: node.strokeWidth }
  // By type, not by key: a freshly drawn shape has no `style` key yet but takes colours.
  if (node.type === "rectangle" || node.type === "ellipse" || node.type === "path" || node.type === "text") return node.style ?? {}
  return undefined
}

function PropertiesView(props: {
  document: DesignDocumentV1
  selection: readonly DesignNodeId[]
  editable: boolean
  onCommand: (command: DesignCommand) => void
  tr: Tr
}): JSX.Element {
  const node = createMemo(() => (props.selection.length === 1 ? props.document.nodes[props.selection[0]!] : undefined))
  const number = (value: string) => {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  const setTransform = (key: "x" | "y" | "width" | "height" | "rotation", raw: string) => {
    const current = node()
    const value = number(raw)
    if (!current || value === undefined) return
    if ((key === "width" || key === "height") && value < 0) return
    props.onCommand({ kind: "updateTransform", id: current.id, transform: { ...current.transform, [key]: value } })
  }
  const setStyle = (key: "fill" | "stroke" | "strokeWidth" | "opacity", raw: string) => {
    const current = node()
    if (!current) return
    const value = key === "fill" || key === "stroke" ? raw.trim() || undefined : number(raw)
    if (key === "opacity" && typeof value === "number" && (value < 0 || value > 1)) return
    props.onCommand({ kind: "updateStyle", id: current.id, style: { [key]: value } })
  }
  return (
    <Show
      when={node()}
      fallback={
        <p data-design-tool-panel-empty>
          {props.selection.length > 1 ? props.tr("props.many", { count: props.selection.length }) : props.tr("props.none")}
        </p>
      }
    >
      {(current) => {
        const readOnly = () => !props.editable || current().locked
        const field = (label: DesignStudioToolsKey, value: string | number | undefined, onCommit: (raw: string) => void, kind: "number" | "text" | "color" = "number") => (
          <label data-design-prop={label}>
            <span>{props.tr(label)}</span>
            <input
              type={kind === "number" ? "number" : "text"}
              inputmode={kind === "number" ? "decimal" : undefined}
              value={value ?? ""}
              readOnly={readOnly()}
              step={label === "props.opacity" ? 0.05 : 1}
              onChange={(event) => onCommit(event.currentTarget.value)}
            />
            <Show when={kind === "color"}>
              {/* The picker edits the same value as the hex field: one change, one command. */}
              <input
                type="color"
                data-design-prop-picker
                aria-label={props.tr(label)}
                value={colorInputValue(typeof value === "string" ? value : undefined)}
                disabled={readOnly()}
                onChange={(event) => onCommit(event.currentTarget.value)}
              />
            </Show>
          </label>
        )
        const style = () => styleOf(current())
        const contrast = () => {
          const text = current()
          if (text.type !== "text") return undefined
          return contrastRatio(text.style?.fill ?? "#18181b", "#ffffff")
        }
        return (
          <div data-design-tool-panel-props data-design-tool-panel-node={current().id}>
            <Show when={props.editable && current().locked}>
              <p data-design-tool-panel-locked>{props.tr("props.locked")}</p>
            </Show>
            <div data-design-prop-row>
              <span>{props.tr("props.type")}</span>
              <code>{current().type}</code>
            </div>
            {field("props.name", current().name, (raw) => props.onCommand({ kind: "updateNode", id: current().id, name: raw }), "text")}
            <div data-design-prop-grid>
              {field("props.x", round(current().transform.x), (raw) => setTransform("x", raw))}
              {field("props.y", round(current().transform.y), (raw) => setTransform("y", raw))}
              {field("props.width", round(current().transform.width), (raw) => setTransform("width", raw))}
              {field("props.height", round(current().transform.height), (raw) => setTransform("height", raw))}
              {field("props.rotation", round(current().transform.rotation), (raw) => setTransform("rotation", raw))}
            </div>
            <Show when={style()}>
              {(values) => (
                <div data-design-prop-grid>
                  <Show when={current().type !== "line"}>{field("props.fill", values().fill, (raw) => setStyle("fill", raw), "color")}</Show>
                  {field("props.stroke", values().stroke, (raw) => setStyle("stroke", raw), "color")}
                  {field("props.strokeWidth", values().strokeWidth, (raw) => setStyle("strokeWidth", raw))}
                  <Show when={current().type !== "line"}>{field("props.opacity", values().opacity ?? 1, (raw) => setStyle("opacity", raw))}</Show>
                </div>
              )}
            </Show>
            <Show when={current().type === "text" ? current() : undefined}>
              {(text) => (
                <>
                  {field("props.text", (text() as TextNodeV1).text, (raw) => props.onCommand({ kind: "updateText", id: text().id, text: raw }), "text")}
                  <TextTypography node={text() as TextNodeV1} readOnly={readOnly()} onCommand={props.onCommand} tr={props.tr} />
                  <Show when={contrast()}>
                    {(ratio) => (
                      <div data-design-prop-row data-design-prop-contrast={ratio() >= 4.5 ? "pass" : "fail"}>
                        <span>{props.tr("props.contrast")}</span>
                        <code>{ratio().toFixed(2)}:1</code>
                      </div>
                    )}
                  </Show>
                </>
              )}
            </Show>
          </div>
        )
      }}
    </Show>
  )
}

const round = (value: number) => Math.round(value * 100) / 100


/** Fonts every desktop and mobile WebView can render without loading a web font. */
export const DESIGN_TEXT_FONTS = ["Inter", "Arial", "Georgia", "Times New Roman", "Courier New", "Verdana"] as const
const TEXT_ALIGNS: readonly DesignTextAlign[] = ["left", "center", "right"]

/** Font, size and alignment of a text node; each change is one `updateTextStyle` command. */
function TextTypography(props: { node: TextNodeV1; readOnly: boolean; onCommand: (command: DesignCommand) => void; tr: Tr }): JSX.Element {
  const font = () => props.node.fontFamily ?? DESIGN_TEXT_DEFAULTS.fontFamily
  const fonts = () => (DESIGN_TEXT_FONTS.includes(font() as never) ? DESIGN_TEXT_FONTS : [font(), ...DESIGN_TEXT_FONTS])
  const setSize = (raw: string) => {
    const size = Number.parseFloat(raw)
    if (Number.isFinite(size) && size > 0) props.onCommand({ kind: "updateTextStyle", id: props.node.id, fontSize: size })
  }
  return (
    <div data-design-prop-grid data-design-text-typography>
      <label data-design-prop="props.font">
        <span>{props.tr("props.font")}</span>
        <select
          value={font()}
          disabled={props.readOnly}
          onChange={(event) => props.onCommand({ kind: "updateTextStyle", id: props.node.id, fontFamily: event.currentTarget.value })}
        >
          <For each={fonts()}>{(entry) => <option value={entry}>{entry}</option>}</For>
        </select>
      </label>
      <label data-design-prop="props.fontSize">
        <span>{props.tr("props.fontSize")}</span>
        <input
          type="number"
          inputmode="decimal"
          min={1}
          value={props.node.fontSize ?? DESIGN_TEXT_DEFAULTS.fontSize}
          readOnly={props.readOnly}
          onChange={(event) => setSize(event.currentTarget.value)}
        />
      </label>
      <div data-design-prop="props.align" role="radiogroup" aria-label={props.tr("props.align")}>
        <span>{props.tr("props.align")}</span>
        <For each={TEXT_ALIGNS}>
          {(align) => (
            <button
              type="button"
              role="radio"
              data-design-text-align={align}
              aria-checked={(props.node.align ?? DESIGN_TEXT_DEFAULTS.align) === align}
              disabled={props.readOnly}
              onClick={() => props.onCommand({ kind: "updateTextStyle", id: props.node.id, align })}
            >
              {props.tr(`align.${align}`)}
            </button>
          )}
        </For>
      </div>
    </div>
  )
}

function HistoryView(props: {
  history: readonly DesignDocumentV1[]
  document: DesignDocumentV1
  onRestore: (stepsBack: number) => void
  tr: Tr
}): JSX.Element {
  const count = (document: DesignDocumentV1) => Object.keys(document.nodes).length
  return (
    <Show when={props.history.length > 0} fallback={<p data-design-tool-panel-empty>{props.tr("history.empty")}</p>}>
      <ol data-design-history-list>
        <li data-design-history-current>
          <span>{props.tr("history.current")}</span>
          <span>{count(props.document)}</span>
        </li>
        <For each={[...props.history].reverse()}>
          {(entry, index) => (
            <li data-design-history-entry={index() + 1}>
              <span>{props.tr("history.step", { index: props.history.length - index(), count: count(entry) })}</span>
              <button type="button" data-design-history-restore={index() + 1} onClick={() => props.onRestore(index() + 1)}>
                {props.tr("history.restore")}
              </button>
            </li>
          )}
        </For>
      </ol>
    </Show>
  )
}

function AuditView(props: { document: DesignDocumentV1; onSelect: (ids: readonly DesignNodeId[]) => void; tr: Tr }): JSX.Element {
  const findings = createMemo(() => auditDesignDocument(props.document))
  return (
    <Show when={findings().length > 0} fallback={<p data-design-audit-clean>{props.tr("audit.clean")}</p>}>
      <p data-design-audit-count>{props.tr("audit.count", { count: findings().length })}</p>
      <ul data-design-audit-list>
        <For each={findings()}>
          {(finding) => (
            <li data-design-audit-finding={finding.code} data-design-audit-severity={finding.severity}>
              <button
                type="button"
                disabled={!finding.nodeId}
                onClick={() => finding.nodeId && props.onSelect([finding.nodeId])}
              >
                <span>{props.tr(`audit.${finding.code}`, { detail: finding.detail ?? "" })}</span>
                <Show when={finding.nodeId}>
                  {(id) => <code>{props.document.nodes[id()]?.name || id()}</code>}
                </Show>
              </button>
            </li>
          )}
        </For>
      </ul>
    </Show>
  )
}
