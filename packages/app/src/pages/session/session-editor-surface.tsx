/* SPDX-License-Identifier: MIT */

import { For, Show } from "solid-js"
import { IconButton } from "@unifia/ui/icon-button"
import { useCommand } from "@/context/command"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { usePermission } from "@/context/permission"
import { useSDK } from "@/context/sdk"
import { useSessionLayout } from "@/pages/session/session-layout"
import { FileTabContent } from "@/pages/session/file-tabs"

const filename = (path: string | undefined) => {
  if (!path) return "Untitled"
  const normalized = path.replaceAll("\\", "/")
  return normalized.slice(normalized.lastIndexOf("/") + 1) || normalized
}

// Maquette's breadcrumb is "filename › symbol under cursor" -- the app has
// no cursor-position symbol tracking, so this substitutes the real, always-
// available equivalent: "parent folder › filename".
const breadcrumb = (path: string | undefined) => {
  if (!path) return { parent: undefined, name: "Untitled" }
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "")
  const slash = normalized.lastIndexOf("/")
  if (slash < 0) return { parent: undefined, name: normalized }
  const name = normalized.slice(slash + 1)
  const parentSlash = normalized.lastIndexOf("/", slash - 1)
  const parent = normalized.slice(parentSlash + 1, slash)
  return { parent: parent || undefined, name }
}

// Maquette's `.v57-codebar`: breadcrumb, a Permission chip and Symbols/
// Split/Commands buttons. "AI completion" and "Preview" are left out on
// purpose -- neither has a backing feature in this app (no inline-
// completion engine, no generic per-file preview mode), and a button that
// does nothing would be worse than no button.
const EditorCodebar = (props: { path: string | undefined }) => {
  const language = useLanguage()
  const command = useCommand()
  const permission = usePermission()
  const sdk = useSDK()
  const { params, view } = useSessionLayout()

  const crumb = () => breadcrumb(props.path)
  const auto = () => {
    const sessionID = params.id
    const mode = sessionID ? permission.isAutoAccepting(sessionID, sdk.directory) : permission.isAutoAcceptingDirectory(sdk.directory)
    return !!mode
  }
  const toggleAuto = () => {
    if (!params.id) return
    command.trigger("permissions.autoaccept")
  }
  const splitActive = () => view().workspace.current() === "split"

  return (
    <div data-v110="code-codebar" class="flex h-8 shrink-0 items-center gap-1 border-b border-border-weaker-base bg-background-stronger px-2">
      <div class="flex min-w-0 items-center gap-1 text-11-regular text-text-weak">
        <Show when={crumb().parent}>
          <span class="truncate">{crumb().parent}</span>
          <span class="shrink-0 text-text-weaker">›</span>
        </Show>
        <span class="truncate font-medium text-text-base">{crumb().name}</span>
      </div>
      <div class="flex-1" />
      <button
        type="button"
        class="shrink-0 rounded-full border border-border-weak-base px-2 py-0.5 text-9-medium text-text-weak hover:text-text-base"
        onClick={toggleAuto}
        aria-pressed={auto()}
      >
        {auto() ? language.t("editor.codebar.permission.auto") : language.t("editor.codebar.permission.manual")}
      </button>
      <IconButton
        icon="magnifying-glass-menu"
        variant="ghost"
        size="small"
        aria-label={language.t("editor.codebar.symbols")}
        onClick={() => command.trigger("editor.symbols")}
      />
      <IconButton
        icon="split"
        variant={splitActive() ? "secondary" : "ghost"}
        size="small"
        aria-label={language.t("editor.codebar.split")}
        aria-pressed={splitActive()}
        onClick={() => view().workspace.set(splitActive() ? "chat" : "split")}
      />
      <IconButton
        icon="keyboard"
        variant="ghost"
        size="small"
        aria-label={language.t("editor.codebar.commands")}
        onClick={() => command.show()}
      />
    </div>
  )
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
        <Show when={active()}>
          {(tab) => <EditorCodebar path={file.pathFromTab(tab())} />}
        </Show>
        <div data-v110="editor-surface-content" class="min-h-0 flex-1 overflow-hidden bg-background-base">
          <Show when={active()} fallback={<div class="flex size-full items-center justify-center text-12-regular text-text-weak">{language.t("common.noFileOpen")}</div>}>
            {(tab) => <FileTabContent tab={tab()} override />}
          </Show>
        </div>
      </section>
    </main>
  )
}
