/* SPDX-License-Identifier: MIT */

import { For, Show, type JSX, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useMode } from "@/context/mode"
import { useWorkspaceWorkbench } from "@/context/workbench/provider"
import { ArtifactPreview } from "@/pages/workbench/artifact-preview"
import {
  activateTab,
  closeTab,
  emptyDesignTabState,
  openTab,
  type DesignTab,
  type DesignTabState,
} from "@/pages/workbench/design-tabs"

export function DesignWorkspace(): JSX.Element {
  const language = useLanguage()
  const mode = useMode()
  const workbench = useWorkspaceWorkbench()
  const connection = workbench.connection
  const t = language.t
  const [state, setState] = createStore<DesignTabState>(emptyDesignTabState())

  const active = createMemo(() => state.tabs.find((tab) => tab.id === state.activeId))
  const isEmpty = createMemo(() => state.activeId === undefined)

  return (
    <div
      class="flex h-full min-h-0 flex-col"
      data-design-workspace={isEmpty() ? "empty" : "active"}
      data-design-workspace-tab-count={state.tabs.length}
    >
      <Show when={state.tabs.length > 0}>
        <div
          class="flex h-9 shrink-0 items-center gap-1 border-b border-border-base bg-background-stronger px-2"
          role="tablist"
          aria-label={t("design.workspace.tabsLabel")}
          data-design-workspace-tab-bar
        >
          <For each={state.tabs}>
            {(item) => (
              <button
                type="button"
                role="tab"
                aria-selected={item.id === state.activeId}
                class="flex h-7 items-center gap-2 rounded px-3 text-12-medium transition-colors"
                classList={{
                  "bg-background-base text-text-base": item.id === state.activeId,
                  "text-text-weak hover:bg-background-base": item.id !== state.activeId,
                }}
                data-design-workspace-tab={item.id}
                data-design-workspace-tab-kind={item.kind}
                onClick={() => setState("activeId", activateTab(state, item.id).activeId ?? undefined)}
              >
                <span>{item.title}</span>
                <Show when={item.closable}>
                  <button
                    type="button"
                    aria-label={t("design.workspace.closeTab", { title: item.title })}
                    class="rounded p-1 text-12-regular text-text-weak hover:bg-border-base hover:text-text-base"
                    data-design-workspace-tab-close={item.id}
                    onClick={(event) => {
                      event.stopPropagation()
                      setState(closeTab(state, item.id))
                    }}
                  >
                    ×
                  </button>
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
      <div class="flex h-full min-h-0 flex-col overflow-hidden" data-design-workspace-content>
        <Show
          when={active()}
          fallback={
            <div
              class="flex h-full min-h-0 flex-col items-center justify-center gap-2 p-6 text-center"
              data-design-workspace-empty
            >
              <p class="text-14-medium text-text-weak">{t("design.workspace.empty")}</p>
              <p class="text-12-regular text-text-weak">{t("design.workspace.emptyHint")}</p>
            </div>
          }
        >
          {(activeTab) => (
            <div
              class="flex h-full min-h-0 flex-col"
              data-design-workspace-active
              data-design-workspace-active-kind={activeTab().kind}
              data-design-workspace-active-id={activeTab().id}
            >
              <Show when={activeTab().kind === "artifact"}>
                <ArtifactPreview
                  artifactId={activeTab().id}
                  workspaceId={connection()?.workspaceId ?? ""}
                />
              </Show>
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}

/**
 * Public API to let parent components drive the tab state without exposing
 * the Solid store directly. P11+ will use this to open artifact tabs.
 */
export function createDesignWorkspaceController() {
  const [state, setState] = createStore<DesignTabState>(emptyDesignTabState())
  return {
    state,
    open(tab: DesignTab) {
      setState(openTab(state, tab))
    },
    close(id: string) {
      setState(closeTab(state, id))
    },
    activate(id: string) {
      setState(activateTab(state, id))
    },
  }
}
