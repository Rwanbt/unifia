import { createMemo, createSignal, onMount, type Component } from "solid-js"
import { Popover } from "@unifia/ui/popover"
import { Button } from "@unifia/ui/button"
import { List } from "@unifia/ui/list"
import { showToast } from "@unifia/ui/toast"
import { useLanguage } from "@/context/language"
import type { useLocal } from "@/context/local"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { normalizeTeamSelection, planTeamToggle, teamModelKey, type TeamSelection } from "@/context/team-selection"

type LocalContext = ReturnType<typeof useLocal>
type SelectableModel = { providerID: string; modelID: string; name: string; providerName: string }

// WHY: sentinel category, not a display string — the visible label goes through
// language.t() so it never collides with a provider actually named "Favorites".
// WHY the escape rather than a literal NUL: a raw NUL byte here made git classify
// this file as binary, so its diffs showed as "0 insertions" and were invisible in
// review. Same string value, textual file.
const FAVORITES_GROUP = "\0favorites"

export const TeamModelSelector: Component<{ local: LocalContext }> = (props) => {
  const language = useLanguage()
  const providers = useProviders()
  const [selected, setSelected] = createSignal<TeamSelection["models"]>([])
  const [open, setOpen] = createSignal(false)
  const [saving, setSaving] = createSignal(false)

  const available = createMemo<SelectableModel[]>(() => {
    const connected = new Set(providers.connected().map((provider) => provider.id))
    return props.local.model
      .list()
      .filter((item) => connected.has(item.provider.id))
      .filter((item) => props.local.model.visible({ providerID: item.provider.id, modelID: item.id }))
      .map((item) => ({ providerID: item.provider.id, modelID: item.id, name: item.name, providerName: item.provider.name }))
  })

  onMount(async () => {
    try {
      const existing = props.local.team.current() ?? (await props.local.team.load())
      // Mirrors DebateModelSelector's onMount: drop entries whose provider/model
      // is no longer connected instead of carrying them into local state. A
      // stale entry here would inflate the badge count past what's actually
      // checkable in the list below, and validateTeamSelection now only
      // requires 2 valid entries, not that every saved entry still connects.
      const keys = new Set(available().map((item) => teamModelKey(item)))
      setSelected((normalizeTeamSelection(existing)?.models ?? []).filter((model) => keys.has(teamModelKey(model))))
    } catch (error) {
      showToast({
        title: language.t("team.selection.failed"),
        description: error instanceof Error ? error.message : String(error),
      })
    }
  })

  const toggle = async (model: SelectableModel) => {
    if (saving()) return
    const plan = planTeamToggle(selected(), { providerID: model.providerID, modelID: model.modelID })

    if (plan.action === "reject") {
      showToast({
        title: language.t("team.selection.invalid"),
        description: language.t(plan.reason === "minimum" ? "team.selection.minimum" : "team.selection.maximum"),
      })
      return
    }

    // A selection below the minimum is staged, never sent: the server would answer 400 and
    // `selected()` would stay put, making the first pick of an empty selection unrecoverable.
    if (plan.action === "stage") {
      setSelected(plan.models)
      return
    }

    setSaving(true)
    try {
      await props.local.team.save({ models: plan.models })
      setSelected(plan.models)
    } catch (error) {
      showToast({
        title: language.t("team.selection.failed"),
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Popover open={open()} onOpenChange={setOpen} triggerAs={Button} triggerProps={{ type: "button", variant: "ghost", size: "normal", disabled: saving(), "data-action": "prompt-team-models", class: "min-w-0 max-w-[220px] text-text-base" }} trigger={<span class="truncate">{language.t("team.selection.models")}{selected().length > 0 ? " (" + selected().length + ")" : ""}</span>} modal>
      <List
        class="w-full h-[min(520px,60vh)]"
        // WHY no autofocus: this popover opens inside a modal on a phone, where
        // focusing the search immediately raises the keyboard, shrinks the
        // viewport and clips the surrounding start-run form. The user can tap
        // the search field when they actually want to filter.
        search={{ placeholder: language.t("team.selection.search"), autofocus: false }}
        emptyMessage={`${language.t("team.selection.empty")} · ${language.t("settings.providers.connected.empty")}`}
        items={available}
        scrollbar
        key={teamModelKey}
        filterKeys={["name", "providerName", "providerID", "modelID"]}
        sortBy={(a, b) => a.name.localeCompare(b.name)}
        groupBy={(item) => (props.local.model.favorite(item) ? FAVORITES_GROUP : item.providerName)}
        groupHeader={(group) => (
          <span class="px-2 pt-2 pb-1 text-12-medium text-text-muted">
            {group.category === FAVORITES_GROUP ? language.t("team.selection.favorites") : group.category}
          </span>
        )}
        sortGroupsBy={(a, b) => {
          if (a.category === FAVORITES_GROUP) return -1
          if (b.category === FAVORITES_GROUP) return 1
          // WHY: same provider ordering as the standard picker (dialog-select-model.tsx),
          // so Team lists providers in the order users already know from chat/plan/build.
          const aProvider = a.items[0].providerID
          const bProvider = b.items[0].providerID
          const aPopular = popularProviders.includes(aProvider)
          const bPopular = popularProviders.includes(bProvider)
          if (aPopular && !bPopular) return -1
          if (!aPopular && bPopular) return 1
          if (aPopular && bPopular) return popularProviders.indexOf(aProvider) - popularProviders.indexOf(bProvider)
          return a.category.localeCompare(b.category)
        }}
        onSelect={(item) => { if (item && !saving()) void toggle(item) }}
      >
        {(item) => <span role="checkbox" aria-checked={selected().some((model) => teamModelKey(model) === teamModelKey(item))} class="truncate">{selected().some((model) => teamModelKey(model) === teamModelKey(item)) ? "✓ " : "  "}{item.name}</span>}
      </List>
    </Popover>
  )
}
