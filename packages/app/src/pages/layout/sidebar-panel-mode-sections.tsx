/* SPDX-License-Identifier: MIT */

/**
 * ModeSections — the mode-specific disclosures below "Projects" in the
 * context panel (sidebar-panel.tsx).
 *
 * Maquette's `.v68-context-root[data-mode]` appends different sections per
 * shell mode (extracted live via `window.UnifiaDemo.enter(mode)` + a DOM
 * dump: Code -> "Code Scope"; Work -> "Work"+"Agents"; Design ->
 * "Pages"+"Design System"; Automate -> "Workflows"+"Runs"; Browser ->
 * "Project Links"+"Library"; Memory -> "Memory"). Each mode's section(s)
 * land in their own follow-up commit; this file is the dispatcher plus
 * whichever sections have shipped so far.
 */
import { createResource, createSignal, For, Match, Switch } from "solid-js"
import { Collapsible } from "@unifia/ui/collapsible"
import { Icon } from "@unifia/ui/icon"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useMode } from "@/context/mode"
import { useSDK } from "@/context/sdk"

const SectionHeader = (props: { title: string; count: number; open: boolean }) => (
  <>
    <Icon name={props.open ? "chevron-down" : "chevron-right"} size="small" class="shrink-0 text-icon-base" />
    <span class="text-11-medium text-text-weaker uppercase tracking-wide">{props.title}</span>
    <span class="ml-auto shrink-0 text-10-regular text-text-weaker">{props.count}</span>
  </>
)

// Maquette's "Code Scope" lists fixed demo areas of one fictional plugin
// project (UI/DSP/Plugin runtime/Tests). Those don't exist generically, so
// this scopes to the real, available equivalent: "Entire workspace" plus
// the project's actual top-level directories, each a real jump into the
// Explorer tab. Fetched directly via the SDK client (sdk.client.file.list,
// the same call context/file.tsx's tree store wraps) rather than useFile(),
// because FileProvider is session-scoped (app.tsx's SessionProviders) and
// this panel renders outside any session route (e.g. the home screen).
const CodeScopeSection = () => {
  const language = useLanguage()
  const layout = useLayout()
  const sdk = useSDK()
  const [open, setOpen] = createSignal(true)

  const [folders] = createResource(
    () => sdk.directory,
    () => sdk.client.file.list({ path: "" }).then((x) => (x.data ?? []).filter((node) => node.type === "directory")),
  )
  const count = () => (folders()?.length ?? 0) + 1

  // A specific folder isn't revealed/expanded in the Explorer tree from
  // here (that needs useFile(), unavailable at this session-independent
  // scope -- see the comment above); opening the tab is still a real,
  // working action, just without the extra reveal step.
  const openExplorer = () => {
    layout.inspector.setTab("explorer")
    layout.inspector.open()
  }

  return (
    <Collapsible open={open()} onOpenChange={setOpen} class="shrink-0">
      <Collapsible.Trigger class="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left hover:bg-surface-raised-base-hover">
        <SectionHeader title={language.t("sidebar.codeScope.title")} count={count()} open={open()} />
      </Collapsible.Trigger>
      <Collapsible.Content>
        <div class="flex flex-col gap-0.5 pl-1 pt-1">
          <button
            type="button"
            class="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-13-regular text-text-base hover:bg-surface-raised-base-hover"
            onClick={() => openExplorer()}
          >
            <Icon name="scope" size="small" class="shrink-0 text-icon-base" />
            <span class="truncate">{language.t("sidebar.codeScope.entireWorkspace")}</span>
          </button>
          <For each={folders() ?? []}>
            {(node) => (
              <button
                type="button"
                class="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-13-regular text-text-base hover:bg-surface-raised-base-hover"
                onClick={openExplorer}
              >
                <Icon name="folder" size="small" class="shrink-0 text-icon-base" />
                <span class="truncate">{node.name}</span>
              </button>
            )}
          </For>
        </div>
      </Collapsible.Content>
    </Collapsible>
  )
}

export function ModeSections() {
  const mode = useMode()
  return (
    <Switch>
      <Match when={mode.active() === "code"}>
        <CodeScopeSection />
      </Match>
    </Switch>
  )
}
