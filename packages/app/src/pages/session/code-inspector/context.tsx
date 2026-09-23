/* SPDX-License-Identifier: MIT */

// Context -- reference "Context · used / limit · %" meter, "Pinned / manual"
// and "Automatic" cards. The meter reads the session's context metrics, the
// pinned list the composer's context items, the automatic list the live
// diagnostics and diff; adding sources from here stays greyed (ADR-049).

import { createMemo, For, Show, type JSX } from "solid-js"
import { getFilename } from "@unifia/util/path"
import { useLanguage } from "@/context/language"
import { useLspDiagnostics } from "@/context/lsp-diagnostics"
import { usePrompt } from "@/context/prompt"
import { useSync } from "@/context/sync"
import { useProviders } from "@/hooks/use-providers"
import { getSessionContextMetrics } from "@/components/session/session-context-metrics"
import { compactTokens } from "./format"
import { Actions, Card, Empty, Row, Soon } from "./parts"

const SOURCES = ["selection", "file", "folder", "terminal"] as const

export function CodeContext(props: { sessionId: string | undefined; changedFiles: number }): JSX.Element {
  const language = useLanguage()
  const sync = useSync()
  const providers = useProviders()
  const prompt = usePrompt()
  const diagnostics = useLspDiagnostics()

  const metrics = createMemo(() =>
    getSessionContextMetrics(props.sessionId ? (sync.data.message[props.sessionId] ?? []) : [], providers.all()).context,
  )
  const heading = createMemo(() => {
    const context = metrics()
    if (!context?.limit) return language.t("inspector.code.context.empty")
    return language.t("inspector.code.context.usage", {
      used: compactTokens(context.total),
      limit: compactTokens(context.limit),
      usage: context.usage ?? 0,
    })
  })

  return (
    <>
      <Card title={heading()}>
        <div data-code-meter>
          <i style={{ width: `${Math.min(100, metrics()?.usage ?? 0)}%` }} />
        </div>
      </Card>
      <Card title={language.t("inspector.code.context.pinned")}>
        <Show when={prompt.context.items().length > 0} fallback={<Empty>{language.t("inspector.code.context.nothingPinned")}</Empty>}>
          <For each={prompt.context.items()}>
            {(item) => (
              <div data-code-row>
                <span data-code-glyph>#</span>
                <span data-code-label>
                  <b>{getFilename(item.path)}</b>
                </span>
                <button
                  type="button"
                  data-code-remove
                  aria-label={language.t("prompt.context.removeFile")}
                  onClick={() => prompt.context.remove(item.key)}
                >
                  ×
                </button>
              </div>
            )}
          </For>
        </Show>
      </Card>
      <Card title={language.t("inspector.code.context.automatic")}>
        <Row glyph="×" label={language.t("inspector.code.context.diagnostics")} meta={String(diagnostics.total())} />
        <Row
          glyph="⑂"
          label={language.t("inspector.code.context.diff")}
          meta={language.t("inspector.code.context.files", { count: props.changedFiles })}
        />
        <Row glyph="T" label={language.t("inspector.code.context.tests")} meta="—" />
      </Card>
      <Actions>
        <For each={SOURCES}>
          {(source) => <Soon label={`＋ ${language.t(`inspector.code.context.add.${source}`)}`} hint={language.t("inspector.code.soon")} />}
        </For>
      </Actions>
    </>
  )
}
