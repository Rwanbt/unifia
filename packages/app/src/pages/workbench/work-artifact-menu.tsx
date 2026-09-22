/* SPDX-License-Identifier: MIT */

// =============================================================================
// pages/workbench/work-artifact-menu.tsx
//
// "Open in Code" and "Export first artifact" used to live in the Work card's
// operations grid, which the v110 maquette does not have. They survive as the
// Work header's overflow menu (owner decision 2026-09-22); the export outcome
// is surfaced by the card through `message`/`state`.
// =============================================================================

import { createMemo, createSignal } from "solid-js"
import { createQuery } from "@tanstack/solid-query"
import { useNavigate } from "@solidjs/router"
import { DropdownMenu } from "@unifia/ui/dropdown-menu"
import { base64Encode } from "@unifia/util/encode"
import { useLanguage } from "@/context/language"
import { useMode } from "@/context/mode"
import { useWorkspaceWorkbench } from "@/context/workbench/provider"
import { workbenchQueryKey } from "@/context/workbench/query-keys"

export type ExportState = "idle" | "running" | "success" | "error"

export function createWorkArtifacts() {
  const language = useLanguage()
  const t = language.t
  const mode = useMode()
  const navigate = useNavigate()
  const workbench = useWorkspaceWorkbench()
  const connection = workbench.connection
  const [state, setState] = createSignal<ExportState>("idle")
  const [message, setMessage] = createSignal("")
  const queryOptions = createMemo(() => {
    const current = connection()
    return {
      queryKey: workbenchQueryKey(current, "artifacts"),
      enabled: !!current,
      queryFn: () => current!.client.listArtifacts(current!.workspaceId),
    }
  })
  const artifacts = createQuery(queryOptions)
  const first = () => artifacts.data?.artifacts[0]

  const finish = (next: ExportState, text: string) => {
    setState(next)
    setMessage(text)
  }

  async function exportFirst(): Promise<void> {
    const artifact = first()
    const current = connection()
    if (!artifact || !current || state() === "running") return
    finish("running", "")
    try {
      workbench.beginOperation()
      const result = await current.client.exportArtifact(current.workspaceId, artifact.artifactId)
      if ("approvalId" in result && result.approvalId) {
        finish("error", t("workbench.export.approvalRequired", { approvalId: result.approvalId }))
      } else if ("exported" in result) {
        finish("success", t("workbench.export.exported", { path: result.exported.relativePath }))
      } else {
        finish("error", t("workbench.export.noResult"))
      }
    } catch (error) {
      finish("error", error instanceof Error ? error.message : t("workbench.export.failed"))
    }
  }

  function openInCode(): void {
    const artifact = first()
    if (!artifact || !mode.directory()) return
    const session = mode.sessionId()
    navigate(
      `/${base64Encode(mode.directory())}/session${session ? `/${encodeURIComponent(session)}` : ""}?artifact=${encodeURIComponent(artifact.artifactId)}`,
    )
  }

  return { hasArtifact: () => !!first(), state, message, exportFirst, openInCode }
}

export function WorkArtifactMenu(props: { artifacts: ReturnType<typeof createWorkArtifacts> }) {
  const language = useLanguage()
  const t = language.t
  return (
    <DropdownMenu>
      <DropdownMenu.Trigger as="button" type="button" data-v110="work-btn" aria-label={t("workbench.work.cockpit.more")}>
        •••
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content>
          <DropdownMenu.Item
            disabled={!props.artifacts.hasArtifact()}
            onSelect={props.artifacts.openInCode}
            data-workbench-open-artifact
          >
            {t("workbench.export.openInCode")}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            disabled={!props.artifacts.hasArtifact() || props.artifacts.state() === "running"}
            onSelect={() => void props.artifacts.exportFirst()}
            data-workbench-export
          >
            {props.artifacts.state() === "running" ? t("workbench.export.exporting") : t("workbench.export.exportFirst")}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}
