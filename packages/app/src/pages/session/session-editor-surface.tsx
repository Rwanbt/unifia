/* SPDX-License-Identifier: MIT */

import { For, Show } from "solid-js"
import { IconButton } from "@unifia/ui/icon-button"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useSessionLayout } from "@/pages/session/session-layout"
import { FileTabContent } from "@/pages/session/file-tabs"

const filename = (path: string | undefined) => {
  if (!path) return "Untitled"
  const normalized = path.replaceAll("\\", "/")
  return normalized.slice(normalized.lastIndexOf("/") + 1) || normalized
}

export function SessionEditorSurface() {
  const file = useFile()
  const language = useLanguage()
  const { tabs } = useSessionLayout()

  const active = () => tabs().active()
  const close = (tab: string) => tabs().close(tab)

  return (
    <main data-v110="mode-main" data-component="session-editor-main" class="min-w-0 min-h-0 flex-1 flex">
      <section data-v110="surface-card" data-component="session-editor-surface" class="min-w-0 min-h-0 flex-1 flex flex-col">
        <header data-v110="code-tabs" class="flex h-9 shrink-0 items-center overflow-x-auto border-b border-border-weaker-base bg-background-stronger px-1">
          <Show when={tabs().all().length > 0} fallback={<span class="px-3 text-11-regular text-text-weak">{language.t("common.editor")}</span>}>
            <For each={tabs().all()}>
              {(tab) => {
                const path = () => file.pathFromTab(tab)
                return (
                  <div class="flex h-7 shrink-0 items-center border-r border-border-weaker-base" data-active={active() === tab ? "true" : "false"}>
                    <button
                      type="button"
                      class="h-full max-w-44 truncate px-3 text-left text-11-regular text-text-weak data-[active=true]:bg-background-base data-[active=true]:text-text-base"
                      onClick={() => tabs().setActive(tab)}
                    >
                      {filename(path())}
                    </button>
                    <IconButton
                      icon="close"
                      variant="ghost"
                      size="small"
                      class="mr-1 size-5 text-text-weaker hover:text-text-base"
                      aria-label={language.t("common.close")}
                      onClick={() => close(tab)}
                    />
                  </div>
                )
              }}
            </For>
          </Show>
        </header>
        <div data-v110="editor-surface-content" class="min-h-0 flex-1 overflow-hidden bg-background-base">
          <Show when={active()} fallback={<div class="flex size-full items-center justify-center text-12-regular text-text-weak">{language.t("common.noFileOpen")}</div>}>
            {(tab) => <FileTabContent tab={tab()} override />}
          </Show>
        </div>
      </section>
    </main>
  )
}
