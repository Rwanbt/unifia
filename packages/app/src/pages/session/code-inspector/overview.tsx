/* SPDX-License-Identifier: MIT */

// Overview -- reference "Code workspace", "Detected tasks", "AI completion".
// Language servers and problems are live; tests and task detection have no
// backend yet and stay greyed (ADR-049).

import { createResource, For, Show, type JSX } from "solid-js"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import { useLspDiagnostics } from "@/context/lsp-diagnostics"
import { Card, Row } from "./parts"

type LspServer = { id: string; name: string; status: "connected" | "error" }

const TASKS = [
  { key: "check", command: "check" },
  { key: "test", command: "test" },
  { key: "run", command: "run" },
  { key: "lint", command: "lint" },
] as const

export function CodeOverview(props: { changedFiles: number }): JSX.Element {
  const sdk = useSDK()
  const language = useLanguage()
  const diagnostics = useLspDiagnostics()
  const [servers] = createResource(
    () => sdk.directory,
    () => sdk.client.lsp.status().then((result) => (result.data ?? []) as LspServer[]),
  )
  const soon = () => language.t("inspector.code.soon")

  return (
    <>
      <Card title={language.t("inspector.code.overview.workspace")}>
        <Show
          when={(servers() ?? []).length > 0}
          fallback={<Row glyph="◎" label={language.t("inspector.code.overview.noServer")} />}
        >
          <For each={servers()}>
            {(server) => (
              <Row
                glyph="◎"
                label={server.name}
                strong
                meta={language.t(server.status === "connected" ? "inspector.code.overview.connected" : "inspector.code.overview.error")}
              />
            )}
          </For>
        </Show>
        <Row glyph="×" label={language.t("inspector.code.overview.problems")} meta={String(diagnostics.total())} />
        <Row glyph="T" label={language.t("inspector.code.overview.tests")} meta="—" />
        <Row
          glyph="⑂"
          label={language.t("inspector.code.tool.git")}
          meta={language.t("inspector.code.overview.changed", { count: props.changedFiles })}
        />
      </Card>
      <Card title={language.t("inspector.code.overview.tasks")}>
        <div data-code-tasks>
          <For each={TASKS}>
            {(task) => (
              <button type="button" disabled title={soon()} data-soon>
                <b>{language.t(`inspector.code.overview.task.${task.key}`)}</b>
                <small>{task.command}</small>
              </button>
            )}
          </For>
        </div>
      </Card>
      <Card title={language.t("inspector.code.overview.completion")}>
        <p>{language.t("inspector.code.overview.completionHint")}</p>
      </Card>
    </>
  )
}

