/* SPDX-License-Identifier: MIT */

// Symbols -- reference "{file} · Outline" and "LSP · {symbol}". The outline
// is the active file's document symbols. Definition and References call the
// server's LSP routes; Rename and Call hierarchy have no panel flow yet and
// stay greyed (ADR-049).

import { createResource, createSignal, For, Show, type JSX } from "solid-js"
import { getFilename } from "@unifia/util/path"
import { useSDK } from "@/context/sdk"
import { canonical } from "@/context/file/canonical"
import { useLanguage } from "@/context/language"
import { flattenDocumentSymbols, type LspDocumentSymbol, type SymbolEntry } from "@/utils/lsp-symbols"
import { Actions, Card, Empty, Row, Soon } from "./parts"

const FUNCTION_KINDS = new Set([6, 9, 12])

const glyph = (entry: SymbolEntry) => (FUNCTION_KINDS.has(entry.kind) ? "ƒ" : entry.kindLabel.charAt(0))

const PENDING_LSP_ACTIONS = ["rename", "calls"] as const

type LspLocation = { uri: string; range: { start: { line: number; character: number } } }

/** A location as the panel opens it: project-relative path and one-based line. */
export function locationTarget(location: LspLocation, root: string): { path: string; line: number } {
  return { path: canonical(location.uri, root), line: location.range.start.line + 1 }
}

export function CodeSymbols(props: { file: string | undefined; open: (path: string, line: number) => void }): JSX.Element {
  const sdk = useSDK()
  const language = useLanguage()
  const [selected, setSelected] = createSignal<SymbolEntry>()
  const [references, setReferences] = createSignal<{ path: string; line: number }[]>()
  const [lookupFailed, setLookupFailed] = createSignal(false)

  // The LSP routes resolve a project-relative path against the project (#679).
  const position = (file: string, entry: SymbolEntry) => ({
    file,
    line: entry.line,
    character: entry.character,
  })
  const goToDefinition = async (file: string, entry: SymbolEntry) => {
    setLookupFailed(false)
    const result = await sdk.client.lsp.definition(position(file, entry)).catch(() => undefined)
    const first = (result?.data ?? [])[0] as LspLocation | undefined
    if (!first) return setLookupFailed(true)
    const target = locationTarget(first, sdk.directory)
    props.open(target.path, target.line)
  }
  const findReferences = async (file: string, entry: SymbolEntry) => {
    setLookupFailed(false)
    const result = await sdk.client.lsp.references(position(file, entry)).catch(() => undefined)
    const found = ((result?.data ?? []) as LspLocation[]).map((location) => locationTarget(location, sdk.directory))
    setReferences(found)
  }
  const [symbols] = createResource(
    () => props.file,
    (file) =>
      sdk.client.lsp
        .documentSymbol({ file })
        .then((result) => flattenDocumentSymbols((result.data ?? []) as LspDocumentSymbol[])),
  )

  return (
    <Show when={props.file} fallback={<Empty>{language.t("inspector.code.symbols.noFile")}</Empty>}>
      {(file) => (
        <>
          <Card title={language.t("inspector.code.symbols.outline", { file: getFilename(file()) })}>
            <Show
              when={(symbols.state === "ready" ? symbols() : []).length > 0}
              fallback={<Empty>{language.t(symbols.loading ? "common.loading" : "inspector.code.symbols.none")}</Empty>}
            >
              <For each={(symbols.state === "ready" ? symbols() : [])}>
                {(entry) => (
                  <Row
                    glyph={glyph(entry)}
                    label={entry.name}
                    strong
                    meta={String(entry.line + 1)}
                    onClick={() => {
                      setSelected(entry)
                      setReferences(undefined)
                      setLookupFailed(false)
                      props.open(file(), entry.line + 1)
                    }}
                  />
                )}
              </For>
            </Show>
          </Card>
          <Show when={selected()}>
            {(entry) => (
              <Card title={`LSP · ${entry().name}`}>
                <Actions>
                  <button type="button" data-code-lsp-action="definition" onClick={() => void goToDefinition(file(), entry())}>
                    {language.t("inspector.code.symbols.action.definition")}
                  </button>
                  <button type="button" data-code-lsp-action="references" onClick={() => void findReferences(file(), entry())}>
                    {language.t("inspector.code.symbols.action.references")}
                  </button>
                  <For each={PENDING_LSP_ACTIONS}>
                    {(action) => (
                      <Soon
                        label={language.t(`inspector.code.symbols.action.${action}`)}
                        hint={language.t("inspector.code.soon")}
                      />
                    )}
                  </For>
                </Actions>
                <Show when={lookupFailed()}>
                  <Empty>{language.t("inspector.code.search.none")}</Empty>
                </Show>
                <Show when={references()}>
                  {(found) => (
                    <Show when={found().length > 0} fallback={<Empty>{language.t("inspector.code.search.none")}</Empty>}>
                      <For each={found()}>
                        {(hit) => (
                          <Row
                            glyph="→"
                            label={`${getFilename(hit.path)}:${hit.line}`}
                            onClick={() => props.open(hit.path, hit.line)}
                          />
                        )}
                      </For>
                    </Show>
                  )}
                </Show>
              </Card>
            )}
          </Show>
        </>
      )}
    </Show>
  )
}
