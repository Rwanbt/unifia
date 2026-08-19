/* SPDX-License-Identifier: MIT */

import { Show, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { useWorkspaceWorkbench } from "@/context/workbench/provider"

export function ConnectionBanner(props: { dataAttr: "workbench-connection" | "design-connection" | "automate-connection"; dataRetryAttr: "workbench-retry" | "design-retry" | "automate-retry" }): JSX.Element {
  const language = useLanguage()
  const workbench = useWorkspaceWorkbench()
  const t = language.t
  const connection = workbench.connection
  const phase = () => connection()?.instanceId ? "connected" : workbench.error() ? "failed" : workbench.loading() ? "connecting" : "unavailable"
  const phaseText = () => {
    switch (phase()) {
      case "connected": return t("workbench.connection.connected", { instanceId: connection()!.instanceId })
      case "connecting": return t("workbench.connection.connecting")
      case "failed": return t("workbench.connection.failed")
      default: return t("workbench.connection.unavailable")
    }
  }
  // The lifecycle already captured why the bridge refused; until now the
  // banner replaced it with one fixed sentence, so the only actionable part
  // of the failure never reached the person able to act on it. The text is a
  // runtime message from the transport, not a translatable string — same
  // treatment as the manifest error rendered by the Design surface.
  const failureDetail = () => {
    const reason = workbench.error()
    if (!reason) return undefined
    const message = reason instanceof Error ? reason.message : String(reason)
    return message.trim() || undefined
  }
  return (
    <>
      <p
        data-workbench-connection={props.dataAttr === "workbench-connection" ? phase() : undefined}
        data-design-connection={props.dataAttr === "design-connection" ? phase() : undefined}
        data-automate-connection={props.dataAttr === "automate-connection" ? phase() : undefined}
        class="text-12-regular text-text-weak"
      >
        {phaseText()}
      </p>
      <Show when={failureDetail()}>
        {(detail) => (
          <p
            data-workbench-connection-detail={props.dataAttr}
            class="text-12-regular text-text-danger"
            role="alert"
          >
            {detail()}
          </p>
        )}
      </Show>
      <Show when={workbench.error()}>
        <button
          type="button"
          data-workbench-retry={props.dataRetryAttr === "workbench-retry" ? "" : undefined}
          data-design-retry={props.dataRetryAttr === "design-retry" ? "" : undefined}
          data-automate-retry={props.dataRetryAttr === "automate-retry" ? "" : undefined}
          class="rounded border border-border-base px-3 py-2 text-12-medium"
          aria-label={t("workbench.connection.retryHint")}
          onClick={() => workbench.retryConnection()}
        >
          {t("workbench.connection.retry")}
        </button>
      </Show>
    </>
  )
}
