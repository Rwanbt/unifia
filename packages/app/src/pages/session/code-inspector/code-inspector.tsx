/* SPDX-License-Identifier: MIT */

// The Code inspector (ADR-049): the reference's .v57-inspector-nav over one
// tool at a time. The Inspector tab shows it in Code mode instead of the
// card inspector of the other modes.

import { For, Match, Switch, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { SourceControl } from "@/components/source-control"
import { CodeContext } from "./context"
import { CodeHistory } from "./history"
import { CodeOverview } from "./overview"
import { CodeSearch } from "./search"
import { CodeSymbols } from "./symbols"

export const CODE_TOOLS = ["overview", "symbols", "search", "review", "git", "context", "history"] as const
export type CodeTool = (typeof CODE_TOOLS)[number]

/** The head title after "Code · " (reference: Git reads "Source Control"). */
export const codeToolTitleKey = (tool: CodeTool) =>
  tool === "overview" ? "inspector.tab.inspector" : `inspector.code.title.${tool}`

export function CodeInspector(props: {
  tool: CodeTool
  onTool: (tool: CodeTool) => void
  sessionId: string | undefined
  changedFiles: number
  activeFile: string | undefined
  review: () => JSX.Element
  open: (path: string, line?: number) => void
  restore: (messageID: string) => void
  reverting: boolean
}): JSX.Element {
  const language = useLanguage()
  return (
    <div data-code-inspector={props.tool}>
      <nav data-code-nav aria-label={language.t("inspector.tab.inspector")}>
        <For each={CODE_TOOLS}>
          {(tool) => (
            <button type="button" aria-pressed={props.tool === tool} data-code-tool={tool} onClick={() => props.onTool(tool)}>
              {language.t(`inspector.code.tool.${tool}`)}
            </button>
          )}
        </For>
      </nav>
      <Switch>
        <Match when={props.tool === "overview"}>
          <CodeOverview changedFiles={props.changedFiles} />
        </Match>
        <Match when={props.tool === "symbols"}>
          <CodeSymbols file={props.activeFile} open={props.open} />
        </Match>
        <Match when={props.tool === "search"}>
          <CodeSearch open={props.open} />
        </Match>
        <Match when={props.tool === "review"}>
          <div data-code-review>{props.review()}</div>
        </Match>
        <Match when={props.tool === "git"}>
          <SourceControl onOpenFile={(path) => props.open(path)} />
        </Match>
        <Match when={props.tool === "context"}>
          <CodeContext sessionId={props.sessionId} changedFiles={props.changedFiles} />
        </Match>
        <Match when={props.tool === "history"}>
          <CodeHistory sessionId={props.sessionId} restore={props.restore} busy={props.reverting} />
        </Match>
      </Switch>
    </div>
  )
}
