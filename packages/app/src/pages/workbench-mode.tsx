import { For, Show, createMemo, createSignal } from "solid-js"
import { useMode } from "@/context/mode"
import {
  createDesignPreviewPanelState,
  createDesignSpecPanelState,
  createMobileNavigationModel,
  WORK_V1_FUNCTIONS,
  type WorkFunction,
} from "@unifia/workbench-shell"

const SAMPLE_SPEC = JSON.stringify(
  {
    id: "unifia-workbench-preview",
    version: "1.0.0",
    target: "design",
    title: "Unifia Workbench",
    tokens: { colors: { primary: "#19212b", foreground: "#f5f7fa" }, spacing: { gutter: 32, stack: 24 } },
    rules: [
      { id: "work", statement: "Documents and traces stay scoped to the active workspace" },
      { id: "design", statement: "Validated specs render as inert responsive SVG previews" },
    ],
  },
  null,
  2,
)

const labelFor = (operation: WorkFunction) => operation.replaceAll("-", " ")

function WorkSurface() {
  const [activeOperation, setActiveOperation] = createSignal<WorkFunction>("documents")
  const navigation = createMemo(() =>
    createMobileNavigationModel({ viewportWidth: window.innerWidth, documents: 0, designPreviews: 3, active: activeOperation() }),
  )

  return (
    <section class="size-full overflow-auto p-6 md:p-10" data-workbench-surface="work">
      <div class="mx-auto max-w-5xl space-y-8">
        <header class="space-y-2">
          <p class="text-12-medium uppercase tracking-wide text-text-weak">Work</p>
          <h1 class="text-24-medium">Workspace operations</h1>
          <p class="max-w-2xl text-14-regular text-text-weak">Read-only workspace surfaces are derived from the shared Work registry and keep their scope explicit.</p>
        </header>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-workbench-navigation={navigation().layout}>
          <For each={WORK_V1_FUNCTIONS}>
            {(operation) => (
              <button
                type="button"
                class="w-full rounded-lg border border-border-base bg-background-stronger p-4 text-left transition-colors hover:bg-background-strong"
                classList={{ "border-border-focus": activeOperation() === operation }}
                data-workbench-operation={operation}
                aria-pressed={activeOperation() === operation}
                onClick={() => setActiveOperation(operation)}
              >
                <div class="flex items-center justify-between gap-3">
                  <h2 class="text-14-medium capitalize">{labelFor(operation)}</h2>
                  <Show when={activeOperation() === operation}>
                    <span class="text-12-medium text-text-success">Active</span>
                  </Show>
                </div>
                <p class="mt-2 text-12-regular text-text-weak">
                  {operation === "documents" ? `${navigation().workCount} documents` : operation === "export" ? "Approval required" : "Scoped to this workspace"}
                </p>
              </button>
            )}
          </For>
        </div>
        <div class="rounded-lg border border-border-base bg-background-stronger p-5" data-workbench-selected-operation={activeOperation()}>
          <p class="text-12-medium uppercase tracking-wide text-text-weak">Selected operation</p>
          <h2 class="mt-2 text-18-medium capitalize">{labelFor(activeOperation())}</h2>
          <p class="mt-2 text-14-regular text-text-weak">This surface keeps the operation scoped to the active workspace and routes writes through the existing approval boundary.</p>
        </div>
      </div>
    </section>
  )
}

function DesignSurface() {
  const [source, setSource] = createSignal(SAMPLE_SPEC)
  const spec = createMemo(() => createDesignSpecPanelState({ kind: "inline", value: source() }))
  const preview = createMemo(() => createDesignPreviewPanelState(spec()))

  return (
    <section class="size-full overflow-auto p-6 md:p-10" data-workbench-surface="design">
      <div class="mx-auto max-w-6xl space-y-8">
        <header class="space-y-2">
          <p class="text-12-medium uppercase tracking-wide text-text-weak">Design</p>
          <h1 class="text-24-medium">Validated responsive preview</h1>
          <p class="max-w-2xl text-14-regular text-text-weak">The preview is produced only after spec validation and is loaded as an inert image source.</p>
        </header>
        <label class="block space-y-2" for="workbench-design-spec">
          <span class="text-14-medium">Design spec</span>
          <textarea
            id="workbench-design-spec"
            class="min-h-48 w-full rounded-lg border border-border-base bg-background-stronger p-4 font-mono text-12-regular text-text-base"
            value={source()}
            onInput={(event) => setSource(event.currentTarget.value)}
            spellcheck={false}
          />
        </label>
        <Show when={spec().diagnostics.length > 0}>
          <aside class="rounded-lg border border-border-danger bg-background-stronger p-4" data-workbench-diagnostics>
            <h2 class="text-14-medium text-text-danger">Spec diagnostics</h2>
            <For each={spec().diagnostics}>
              {(diagnostic) => <p class="mt-2 text-12-regular text-text-weak">Line {diagnostic.line}, column {diagnostic.column}: {diagnostic.message}</p>}
            </For>
          </aside>
        </Show>
        <Show when={preview().previews.length > 0} fallback={<p class="text-14-regular text-text-danger">{spec().diagnostics[0]?.message}</p>}>
          <div class="grid gap-5 md:grid-cols-3" data-workbench-preview-count={preview().previews.length}>
            <For each={preview().previews}>
              {(item) => (
                <figure class="overflow-hidden rounded-lg border border-border-base bg-background-stronger p-3">
                  <img class="w-full rounded-md" src={item.src} width={item.width} alt={`${item.label} preview`} />
                  <figcaption class="mt-3 text-12-medium capitalize text-text-weak">{item.label} · {item.width}px</figcaption>
                </figure>
              )}
            </For>
          </div>
        </Show>
      </div>
    </section>
  )
}

export default function WorkbenchMode() {
  const mode = useMode()
  return (
    <main class="size-full min-h-0 bg-background-base" data-workbench-mode={mode.active()}>
      <Show when={mode.active() === "work"}>
        <WorkSurface />
      </Show>
      <Show when={mode.active() === "design"}>
        <DesignSurface />
      </Show>
      <Show when={mode.active() === "automate"}>
        <section class="size-full flex items-center justify-center p-8" data-workbench-surface="automate">
          <div class="max-w-lg space-y-3 text-center">
            <p class="text-12-medium uppercase tracking-wide text-text-weak">Automate</p>
            <h1 class="text-24-medium">Automation controls</h1>
            <p class="text-14-regular text-text-weak">Automation remains scoped to explicit approvals and the existing Unifia runtime.</p>
          </div>
        </section>
      </Show>
    </main>
  )
}
