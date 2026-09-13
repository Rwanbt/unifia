/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Studio library — the left-side pane of the Automate studio.
 *
 * Phase 8 slice 5: lists the 15 `NodeFamily` types from the
 * canonical `NodeFamilySchema`, grouped by category. Clicking a
 * family commits a new `WorkflowStepSummary` to the parent's
 * `extraNodes` array via the `onAdd` callback. The canvas reads
 * `extraNodes` and renders them after the legacy workflow steps.
 *
 * The library does NOT own the extra-node list — that lives in the
 * Automate surface (parent-controlled, same shape as `positions`
 * and `edges` in slices 3 and 4). Persistence is slice 8.7's job;
 * for now user-added nodes live in component state on the surface.
 *
 * Empty state: when the search filter excludes every family, the
 * list collapses to a "no matches" hint. The category headers stay
 * visible as anchors so the user can clear the filter easily.
 */
import { For, Show, createMemo, createSignal, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"

export type LibraryEntry = {
  readonly family: string
  readonly label: string
  readonly description: string
}

export type AutomateStudioLibraryProps = {
  /** Library entries grouped by category. Ordered for the renderer. */
  readonly categories: readonly { readonly category: string; readonly entries: readonly LibraryEntry[] }[]
  /** Fires when the user clicks a family entry. The parent is expected to mirror the new node via `extraNodes`. */
  readonly onAdd?: (entry: LibraryEntry) => void
}

export function AutomateStudioLibrary(props: AutomateStudioLibraryProps): JSX.Element {
  const language = useLanguage()
  const t = language.t
  const [filter, setFilter] = createSignal("")
  const filteredCategories = createMemo(() => {
    const needle = filter().trim().toLowerCase()
    if (!needle) return props.categories
    return props.categories
      .map((group) => ({
        category: group.category,
        entries: group.entries.filter(
          (entry) => entry.label.toLowerCase().includes(needle) || entry.family.toLowerCase().includes(needle),
        ),
      }))
      .filter((group) => group.entries.length > 0)
  })
  const totalCount = createMemo(() =>
    filteredCategories().reduce((sum, group) => sum + group.entries.length, 0),
  )
  return (
    <aside
      class="flex h-full flex-col rounded-lg border border-border-base bg-background-stronger"
      data-automate-studio-library
    >
      <header class="flex flex-col gap-2 border-b border-border-base px-3 py-2">
        <div class="flex items-center justify-between">
          <h2 class="text-12-medium">{t("workbench.automate.library.title")}</h2>
          <span class="text-11-regular text-text-weak" data-automate-studio-library-count>
            {t("workbench.automate.library.familyCount", { count: totalCount() })}
          </span>
        </div>
        <input
          type="search"
          class="w-full rounded border border-border-base bg-background-base px-2 py-1 text-12-regular"
          placeholder={t("workbench.automate.library.searchPlaceholder")}
          value={filter()}
          onInput={(event) => setFilter(event.currentTarget.value)}
          aria-label={t("workbench.automate.library.searchLabel")}
          data-automate-studio-library-search
        />
      </header>
      <div class="flex-1 overflow-auto p-2">
        <Show
          when={filteredCategories().length > 0}
          fallback={
            <p class="px-2 py-4 text-center text-12-regular text-text-weak" data-automate-studio-library-empty>
              {t("workbench.automate.library.empty")}
            </p>
          }
        >
          <For each={filteredCategories()}>
            {(group) => (
              <section class="mb-3 last:mb-0" data-automate-studio-library-group={group.category}>
                <h3 class="px-1 pb-1 pt-2 text-11-regular uppercase tracking-wide text-text-weak">
                  {group.category}
                </h3>
                <ul class="space-y-1">
                  <For each={group.entries}>
                    {(entry) => (
                      <li>
                        <button
                          type="button"
                          class="flex w-full flex-col items-start rounded border border-border-base bg-background-base px-2 py-1.5 text-left text-12-regular hover:bg-background-stronger focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-base"
                          onClick={() => props.onAdd?.(entry)}
                          data-automate-studio-library-entry={entry.family}
                          aria-label={t("workbench.automate.library.addEntry", { label: entry.label })}
                        >
                          <span class="font-medium text-text-strong">{entry.label}</span>
                          <span class="text-11-regular text-text-weak">{entry.description}</span>
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </section>
            )}
          </For>
        </Show>
      </div>
      <footer class="border-t border-border-base px-3 py-2 text-11-regular text-text-weak">
        {t("workbench.automate.library.footerHint")}
      </footer>
    </aside>
  )
}

/**
 * Default library entries grouped by category, derived from the
 * canonical `NodeFamilySchema` enum (15 families). The descriptions
 * are short, user-facing summaries — not the full contract spec,
 * which lives in `packages/contracts/src/workflow-ir.ts`. The
 * library stays as close to the source enum as possible: when a
 * new family is added to the schema, slice 8.7's migration will
 * surface it here too.
 */
export const DEFAULT_LIBRARY_CATEGORIES: readonly {
  readonly category: string
  readonly entries: readonly LibraryEntry[]
}[] = [
  {
    category: "Triggers",
    entries: [
      { family: "trigger.manual", label: "Manual trigger", description: "Start the workflow on user action." },
      { family: "trigger.schedule", label: "Schedule trigger", description: "Start on a cron or interval." },
    ],
  },
  {
    category: "Control flow",
    entries: [
      { family: "control.if", label: "If / else", description: "Branch on a boolean expression." },
      { family: "control.switch", label: "Switch", description: "Multi-way branch on a value." },
      { family: "control.parallel", label: "Parallel", description: "Run child branches concurrently." },
      { family: "control.merge", label: "Merge", description: "Combine parallel branch outputs." },
      { family: "control.map", label: "Map", description: "Apply a child branch to each item." },
      { family: "control.repeat", label: "Repeat", description: "Loop a fixed number of times." },
      { family: "control.while", label: "While", description: "Loop while a predicate holds." },
      { family: "control.child", label: "Child workflow", description: "Invoke another workflow by id." },
    ],
  },
  {
    category: "Tools",
    entries: [
      { family: "tool.http", label: "HTTP request", description: "Call an external HTTP endpoint." },
      { family: "tool.transform", label: "Transform", description: "Apply a JS expression to the payload." },
    ],
  },
  {
    category: "Human",
    entries: [
      { family: "human.approval", label: "Human approval", description: "Pause until a human approves." },
    ],
  },
  {
    category: "Misc",
    entries: [
      { family: "wait", label: "Wait", description: "Pause execution for a duration." },
    ],
  },
]
