/* SPDX-License-Identifier: MIT */

import { createMemo, For, Show } from "solid-js"
import { Icon } from "@unifia/ui/icon"
import { IconButton } from "@unifia/ui/icon-button"
import { useCommand } from "@/context/command"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLspDiagnostics } from "@/context/lsp-diagnostics"
import { usePermission } from "@/context/permission"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
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

// Maquette's status bar shows a per-file language name. No language
// detector is exposed anywhere else in the app (Shiki resolves its own
// grammar internally, not as a reusable helper), so this is a small local
// map covering the languages this monorepo actually contains -- real and
// deterministic from the extension, same category as the breadcrumb
// substitution above, not a guess.
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  rs: "Rust",
  py: "Python",
  go: "Go",
  json: "JSON",
  md: "Markdown",
  css: "CSS",
  html: "HTML",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
  sh: "Shell",
  sql: "SQL",
}
const languageName = (path: string | undefined) => {
  if (!path) return undefined
  const ext = path.split(/[/\\]/).pop()?.split(".").pop()?.toLowerCase()
  return ext ? LANGUAGE_BY_EXTENSION[ext] : undefined
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

// Maquette's `.v57-statusbar`. Shipped: branch, LSP problem counts,
// language, agent status. Deliberately NOT shipped: sync ahead/behind
// (only a one-shot OS notification exists, `vcs.branch.behind` in
// context/notification.tsx -- no persisted, reactive ahead/behind count to
// read), an LSP-connected indicator (no such signal exists), encoding/line
// ending (nothing detects these per file), and cursor position (no
// cursor-tracking hook exists). Each gap is a real missing feature, not
// skipped for convenience -- see the codebar's own comment for the same
// discipline applied to AI completion/Preview.
const EditorStatusbar = (props: { path: string | undefined }) => {
  const language = useLanguage()
  const sync = useSync()
  const diagnostics = useLspDiagnostics()
  const { params } = useSessionLayout()

  const branch = () => sync.data.vcs?.branch
  const problems = createMemo(() => {
    let errors = 0
    let warnings = 0
    for (const file of diagnostics.files()) {
      errors += diagnostics.errors(file)
      warnings += diagnostics.warnings(file)
    }
    return { errors, warnings }
  })
  const busy = () => {
    const sessionID = params.id
    if (!sessionID) return false
    const status = sync.data.session_status[sessionID]
    if (status && status.type !== "idle") return true
    return (sync.data.message[sessionID] ?? []).some(
      (item) => item.role === "assistant" && typeof item.time.completed !== "number",
    )
  }

  return (
    <div data-v110="code-statusbar" class="flex h-6 shrink-0 items-center gap-3 border-t border-border-weaker-base bg-background-stronger px-2 text-10-regular text-text-weak">
      <Show when={branch()}>
        <span class="flex items-center gap-1 truncate">
          <Icon name="branch" size="small" class="size-3.5" aria-hidden="true" />
          {branch()}
        </span>
      </Show>
      <Show when={problems().errors > 0 || problems().warnings > 0}>
        <span>
          ×{problems().errors} !{problems().warnings}
        </span>
      </Show>
      <Show when={languageName(props.path)}>
        <span>{languageName(props.path)}</span>
      </Show>
      <div class="flex-1" />
      <span class="flex items-center gap-1.5">
        <span
          class="size-1.5 shrink-0 rounded-full"
          classList={{ "bg-icon-success-base": !busy(), "bg-icon-warning-base": busy() }}
        />
        {busy() ? language.t("editor.statusbar.agentWorking") : language.t("editor.statusbar.agentIdle")}
      </span>
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
        <Show when={active()}>
          {(tab) => <EditorStatusbar path={file.pathFromTab(tab())} />}
        </Show>
      </section>
    </main>
  )
}
