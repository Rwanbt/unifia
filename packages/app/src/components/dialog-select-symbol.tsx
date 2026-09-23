// Go-to-symbol palette (PLAN-EDITEUR-IDE-DEFINITIF Phase 5.4).
//
// Modal Quick Open variant scoped to the active file. Calls
// `sdk.client.lsp.documentSymbol({file})`, flattens the response into
// (name, kind, line) tuples, then displays them with the existing
// `<List>` fuzzy picker. Selecting a symbol opens the file (no-op if
// already active) and sets the viewer's `selectedLines` so pierre
// auto-scrolls to the symbol's selection range start.
//
// WHY a new modal (not reusing DialogSelectFile): the file dialog is
// project-scoped and backed by `find.files`; symbols are file-scoped and
// backed by LSP. Mixing them would tangle the search backend and the
// auto-close-then-jump UX.

import { useDialog } from "@unifia/ui/context/dialog"
import { Dialog } from "@unifia/ui/dialog"
import { List } from "@unifia/ui/list"
import { createMemo, createResource, Show, type JSXElement } from "solid-js"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { useSessionLayout } from "@/pages/session/session-layout"
import { createSessionTabs } from "@/pages/session/helpers"
import { flattenDocumentSymbols, type LspDocumentSymbol, type SymbolEntry } from "@/utils/lsp-symbols"


// FileProvider and the directory-scoped SDKProvider are session-route-scoped
// while dialogs render through <DialogOutlet /> at RouterRoot. Openers on the
// session route must inject both — the context fallbacks would resolve to a
// missing FileProvider (throw) and the empty-directory fallback SDK (wrong
// LSP root) respectively.
export function DialogSelectSymbol(props: { sdk?: ReturnType<typeof useSDK>; file?: ReturnType<typeof useFile> }) {
  const sdk = props.sdk ?? useSDK()
  const file = props.file ?? useFile()
  const language = useLanguage()
  const dialog = useDialog()
  const { tabs } = useSessionLayout()
  const layout = useLayout()

  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab: (tab) => (tab.startsWith("file://") ? file.tab(tab) : tab),
  })
  const activeFile = createMemo(() => {
    const tab = tabState.activeFileTab()
    if (!tab) return undefined
    return file.pathFromTab(tab)
  })

  const [entries] = createResource(activeFile, async (p) => {
    if (!p) return [] as SymbolEntry[]
    const res = await sdk.client.lsp.documentSymbol({ file: p })
    const data = (res.data ?? []) as LspDocumentSymbol[]
    return flattenDocumentSymbols(data)
  })

  const items = (query: string) => {
    const list = entries() ?? []
    if (!query.trim()) return list
    const needle = query.toLowerCase()
    return list.filter((entry) => entry.name.toLowerCase().includes(needle))
  }

  const handleSelect = (item: SymbolEntry | undefined) => {
    if (!item) return
    const p = activeFile()
    if (!p) return
    dialog.close()

    // Open + activate the file (no-op when already active).
    const tab = file.tab(p)
    tabs().open(tab)
    file.load(p)
    tabs().setActive(tab)
    layout.inspector.setTab("inspector")
    if (!layout.inspector.opened()) layout.inspector.open()

    // Set selection range to the symbol's start line. pierre auto-scrolls via
    // its file-find bridge when `selectedLines` changes (see pierre/file-find.ts).
    file.setSelectedLines(p, { start: item.line + 1, end: item.line + 1 })
  }

  return (
    <Dialog class="pt-3 pb-0 !max-h-[480px]" transition>
      <List
        search={{
          placeholder: language.t("palette.symbols.placeholder"),
          autofocus: true,
          hideIcon: true,
        }}
        emptyMessage={language.t("palette.symbols.empty")}
        loadingMessage={language.t("common.loading")}
        items={items}
        key={(item: SymbolEntry) => item.id}
        filterKeys={["name", "kindLabel"]}
        onSelect={handleSelect}
      >
        {(item: SymbolEntry): JSXElement => (
          <div class="w-full flex items-center justify-between gap-3 pl-1">
            <div class="flex items-center gap-2 min-w-0">
              <span class="text-12-regular text-text-weak shrink-0 w-20 truncate">
                {item.kindLabel}
              </span>
              <span class="text-14-regular text-text-strong truncate">{item.name}</span>
            </div>
            <Show when={item.detail}>
              <span class="text-12-regular text-text-weak truncate">{item.detail}</span>
            </Show>
            <span class="text-12-regular text-text-weak shrink-0 ml-auto">
              L{item.line + 1}
            </span>
          </div>
        )}
      </List>
    </Dialog>
  )
}