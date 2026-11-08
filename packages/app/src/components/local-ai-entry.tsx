import { ProviderIcon } from "@unifia/ui/provider-icon"
import { useDialog } from "@unifia/ui/context/dialog"
import type { Component } from "solid-js"
import type { useLocal } from "@/context/local"
import { useLanguage } from "@/context/language"
import { hasLocalModels, LOCAL_PROVIDER_ID } from "./model-picker-order"

type ModelState = ReturnType<typeof useLocal>["model"]

/**
 * Opens local-AI model management; a model downloaded from there becomes the
 * selected model, so the user goes from the picker to a working local chat
 * without a detour through settings.
 */
export function openLocalAI(dialog: ReturnType<typeof useDialog>, model: ModelState) {
  void import("./dialog-local-llm").then((x) => {
    dialog.show(() => (
      <x.DialogLocalLLM onModelReady={(modelID) => model.set({ providerID: LOCAL_PROVIDER_ID, modelID }, { recent: true })} />
    ))
  })
}

/**
 * Always-present "Local AI" row. The server lists `local-llm` only once it has
 * a downloaded model, so this row is what makes it reachable before that.
 */
export const LocalAIEntry: Component<{ model: ModelState; onOpen?: () => void }> = (props) => {
  const language = useLanguage()
  const dialog = useDialog()

  return (
    <button
      type="button"
      data-component="local-ai-entry"
      class="w-full shrink-0 flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-13-regular hover:bg-surface-raised-base-hover focus-visible:bg-surface-raised-base-hover outline-none"
      onClick={() => {
        props.onOpen?.()
        openLocalAI(dialog, props.model)
      }}
    >
      <ProviderIcon id={LOCAL_PROVIDER_ID} class="size-4 shrink-0" />
      <span class="truncate text-text-strong">{language.t("settings.system.card.localAi")}</span>
      <span class="ml-auto shrink-0 text-12-regular text-text-muted">
        {hasLocalModels(props.model.list())
          ? language.t("dialog.model.manage")
          : language.t("settings.localLlm.download")}
      </span>
    </button>
  )
}
