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
