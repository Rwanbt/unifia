/* SPDX-License-Identifier: MIT */

// Search -- reference toolbar (query + regex toggle) and Text / Symbol /
// Related modes. Text runs ripgrep (`find.text`), Symbol the workspace symbol
// index (`find.symbols`); Related has no backend and stays greyed (ADR-049).

import { createResource, createSignal, For, Show, type JSX } from "solid-js"
import { getFilename } from "@unifia/util/path"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import { relativePath } from "./format"
import { Actions, Empty, Soon } from "./parts"

type Mode = "text" | "symbol"
type Hit = { id: string; path: string; line: number; label: string }

type TextMatch = { path: { text: string }; line_number: number; lines: { text: string } }
type WorkspaceSymbol = { name: string; location: { uri: string; range: { start: { line: number } } } }

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export function CodeSearch(props: { open: (path: string, line: number) => void }): JSX.Element {
  const sdk = useSDK()
  const language = useLanguage()
  const [draft, setDraft] = createSignal("")
  const [regex, setRegex] = createSignal(false)
  const [mode, setMode] = createSignal<Mode>("text")
  const [query, setQuery] = createSignal<{ text: string; mode: Mode; regex: boolean }>()

  const [hits] = createResource(query, async (input): Promise<Hit[]> => {
    if (input.mode === "symbol") {
      const result = await sdk.client.find.symbols({ query: input.text })
      return ((result.data ?? []) as WorkspaceSymbol[]).map((symbol, index) => {
        const path = relativePath(symbol.location.uri, sdk.directory)
        return { id: `${index}`, path, line: symbol.location.range.start.line + 1, label: `${symbol.name} · ${getFilename(path)}` }
      })
    }
    const pattern = input.regex ? input.text : escapeRegex(input.text)
    const result = await sdk.client.find.text({ pattern })
    return ((result.data ?? []) as TextMatch[]).map((match, index) => ({
      id: `${index}`,
      path: match.path.text.replaceAll("\\", "/"),
      line: match.line_number,
      label: match.lines.text.trim(),
    }))
  })

  const run = (next = mode()) => {
    setMode(next)
    const text = draft().trim()
    if (text) setQuery({ text, mode: next, regex: regex() })
  }

  return (
    <>
      <div data-code-toolbar>
        <input
          value={draft()}
          placeholder={language.t("inspector.code.search.placeholder")}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") run()
          }}
        />
        <button type="button" aria-pressed={regex()} title="Regex" onClick={() => setRegex(!regex())}>
          .*
        </button>
      </div>
      <Actions>
        <button type="button" data-primary={mode() === "text" ? "" : undefined} onClick={() => run("text")}>
          {language.t("inspector.code.search.text")}
        </button>
        <button type="button" data-primary={mode() === "symbol" ? "" : undefined} onClick={() => run("symbol")}>
          {language.t("inspector.code.search.symbol")}
        </button>
        <Soon label={language.t("inspector.code.search.related")} hint={language.t("inspector.code.soon")} />
      </Actions>
      <div data-code-results>
        <Show when={query()}>
          <Show when={!hits.loading} fallback={<Empty>{language.t("common.loading")}</Empty>}>
            <Show when={(hits() ?? []).length > 0} fallback={<Empty>{language.t("inspector.code.search.none")}</Empty>}>
              <For each={hits()}>
                {(hit) => (
                  <button type="button" data-code-hit onClick={() => props.open(hit.path, hit.line)}>
                    <b>
                      {getFilename(hit.path)}:{hit.line}
                    </b>
                    <span>{hit.label}</span>
                  </button>
                )}
              </For>
            </Show>
          </Show>
        </Show>
      </div>
    </>
  )
}
