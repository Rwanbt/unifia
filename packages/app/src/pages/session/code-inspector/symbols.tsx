/* SPDX-License-Identifier: MIT */

// Symbols -- reference "{file} · Outline" and "LSP · {symbol}". The outline
// is the active file's document symbols; the LSP actions have no panel wiring
// yet and stay greyed (ADR-049).

import { createResource, createSignal, For, Show, type JSX } from "solid-js"
import { getFilename } from "@unifia/util/path"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import { flattenDocumentSymbols, type LspDocumentSymbol, type SymbolEntry } from "@/utils/lsp-symbols"
import { Actions, Card, Empty, Row, Soon } from "./parts"

const FUNCTION_KINDS = new Set([6, 9, 12])

const glyph = (entry: SymbolEntry) => (FUNCTION_KINDS.has(entry.kind) ? "ƒ" : entry.kindLabel.charAt(0))

const LSP_ACTIONS = ["definition", "references", "rename", "calls"] as const

export function CodeSymbols(props: { file: string | undefined; open: (path: string, line: number) => void }): JSX.Element {
  const sdk = useSDK()
  const language = useLanguage()
  const [selected, setSelected] = createSignal<SymbolEntry>()
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
              when={(symbols() ?? []).length > 0}
              fallback={<Empty>{language.t(symbols.loading ? "common.loading" : "inspector.code.symbols.none")}</Empty>}
            >
              <For each={symbols()}>
                {(entry) => (
                  <Row
                    glyph={glyph(entry)}
                    label={entry.name}
                    strong
                    meta={String(entry.line + 1)}
                    onClick={() => {
                      setSelected(entry)
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
                  <For each={LSP_ACTIONS}>
                    {(action) => (
                      <Soon
                        label={language.t(`inspector.code.symbols.action.${action}`)}
                        hint={language.t("inspector.code.soon")}
                      />
                    )}
                  </For>
                </Actions>
              </Card>
            )}
          </Show>
        </>
      )}
    </Show>
  )
}
