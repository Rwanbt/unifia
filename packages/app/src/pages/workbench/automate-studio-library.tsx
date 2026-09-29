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

/**
 * Families that run with the empty config the studio gives a library node
 * (probed against the real engine): the control families are refused at
 * start, `tool.*` fail without a config and `trigger.schedule` never fires.
 * The studio has no config editor yet, so every other entry stays "soon".
 */
export const RUNNABLE_LIBRARY_FAMILIES: ReadonlySet<string> = new Set(["trigger.manual", "human.approval", "wait"])

export const isRunnableLibraryFamily = (family: string): boolean => RUNNABLE_LIBRARY_FAMILIES.has(family)

export type AutomateStudioLibraryProps = {
  readonly categories: readonly { readonly category: string; readonly entries: readonly LibraryEntry[] }[]
  readonly onAdd?: (entry: LibraryEntry) => void
  /** Collapses the library column (desktop) or closes the Nodes sheet (phones). */
  readonly onCollapse?: () => void
}

/**
 * Node library of the flow studio (`.a60-lib`, ADR-086): a searchable list
 * of the runtime's node families, drawn as the reference's two-column grid
 * of cards. Families the studio cannot configure yet are greyed "soon".
 */
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
    <aside data-automate-studio-library>
      <header data-automate-studio-library-head>
        <b>{t("automate.studio.library.title")}</b>
        <span class="sr-only" data-automate-studio-library-count>
          {t("workbench.automate.library.familyCount", { count: totalCount() })}
        </span>
        <Show when={props.onCollapse}>
          <button
            type="button"
            data-automate-studio-library-collapse
            title={t("automate.studio.library.collapse")}
            aria-label={t("automate.studio.library.collapse")}
            onClick={() => props.onCollapse?.()}
          >
            ◂
          </button>
        </Show>
      </header>
      <label data-automate-studio-library-search-field>
        <span aria-hidden="true">⌕</span>
        <input
          type="search"
          placeholder={t("automate.studio.library.search")}
          value={filter()}
          onInput={(event) => setFilter(event.currentTarget.value)}
          aria-label={t("workbench.automate.library.searchLabel")}
          data-automate-studio-library-search
        />
      </label>
      <div data-automate-studio-library-scroll>
        <Show
          when={filteredCategories().length > 0}
          fallback={<p data-automate-studio-library-empty>{t("workbench.automate.library.empty")}</p>}
        >
          <For each={filteredCategories()}>
            {(group) => (
              <section data-automate-studio-library-group={group.category}>
                <h3>{group.category}</h3>
                <div data-automate-studio-library-grid>
                  <For each={group.entries}>
                    {(entry) => (
                      <button
                        type="button"
                        onClick={() => {
                          if (isRunnableLibraryFamily(entry.family)) props.onAdd?.(entry)
                        }}
                        data-automate-studio-library-entry={entry.family}
                        data-soon={isRunnableLibraryFamily(entry.family) ? undefined : "true"}
                        aria-disabled={isRunnableLibraryFamily(entry.family) ? undefined : "true"}
                        title={isRunnableLibraryFamily(entry.family) ? entry.description : t("common.comingSoon")}
                        aria-label={t("workbench.automate.library.addEntry", { label: entry.label })}
                      >
                        <b>{entry.label}</b>
                        <small>{entry.family}</small>
                      </button>
                    )}
                  </For>
                </div>
              </section>
            )}
          </For>
        </Show>
      </div>
    </aside>
  )
}

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
