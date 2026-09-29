import { useFilteredList } from "@unifia/ui/hooks"
import { ProviderIcon } from "@unifia/ui/provider-icon"
import { Switch } from "@unifia/ui/switch"
import { type Component, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { popularProviders } from "@/hooks/use-providers"
import { SettingsPage } from "./settings-page"

type ModelItem = ReturnType<ReturnType<typeof useModels>["list"]>[number]

export const SettingsModels: Component = () => {
  const language = useLanguage()
  const models = useModels()

  const list = useFilteredList<ModelItem>({
    items: (_filter) => models.list(),
    key: (x) => `${x.provider.id}:${x.id}`,
    filterKeys: ["provider.name", "name", "id"],
    sortBy: (a, b) => a.name.localeCompare(b.name),
    groupBy: (x) => x.provider.id,
    sortGroupsBy: (a, b) => {
      const aIndex = popularProviders.indexOf(a.category)
      const bIndex = popularProviders.indexOf(b.category)
      const aPopular = aIndex >= 0
      const bPopular = bIndex >= 0

      if (aPopular && !bPopular) return -1
      if (!aPopular && bPopular) return 1
      if (aPopular && bPopular) return aIndex - bIndex

      const aName = a.items[0].provider.name
      const bName = b.items[0].provider.name
      return aName.localeCompare(bName)
    },
  })

  return (
    <SettingsPage
      sticky
      title={language.t("settings.models.title")}
      actions={
        <input
          type="search"
          data-slot="settings-search-field"
          data-compact
          value={list.filter()}
          onInput={(event) => list.onInput(event.currentTarget.value)}
          placeholder={language.t("settings.models.search.placeholder")}
          aria-label={language.t("settings.models.search.placeholder")}
          spellcheck={false}
          autocomplete="off"
        />
      }
      intro={{
        icon: "✦",
        title: language.t("settings.providers.intro.title"),
        text: language.t("settings.models.intro.text"),
      }}
    >
      <Show
        when={!list.grouped.loading}
        fallback={
          <p data-slot="settings-empty">{`${language.t("common.loading")}${language.t("common.loading.ellipsis")}`}</p>
        }
      >
        <Show
          when={list.flat().length > 0}
          fallback={
            <p data-slot="settings-empty">
              {language.t("dialog.model.empty")}
              <Show when={list.filter()}>
                {" "}
                <b>"{list.filter()}"</b>
              </Show>
            </p>
          }
        >
          {/* The reference's .model-provider: a head (logo, name, count) over a
              ruled grid of name, favourite star and visibility switch. */}
          <For each={list.grouped.latest}>
            {(group) => (
              <section data-slot="model-provider">
                <div data-slot="model-provider-head">
                  <span data-slot="provider-logo" data-small>
                    <ProviderIcon id={group.category} class="icon-strong-base" />
                  </span>
                  <b>{group.items[0].provider.name}</b>
                  <span>{language.t("settings.models.count", { count: group.items.length })}</span>
                </div>
                <div data-slot="model-grid">
                  <For each={group.items}>
                    {(item) => {
                      const key = { providerID: item.provider.id, modelID: item.id }
                      return (
                        <div data-slot="model-row">
                          <span>{item.name}</span>
                          <button
                            type="button"
                            data-slot="model-pin"
                            aria-pressed={models.favorite(key)}
                            aria-label={language.t("settings.models.favorite", { model: item.name })}
                            onClick={() => models.setFavorite(key, !models.favorite(key))}
                          >
                            {models.favorite(key) ? "★" : "☆"}
                          </button>
                          <Switch
                            checked={models.visible(key)}
                            onChange={(checked) => models.setVisibility(key, checked)}
                            hideLabel
                          >
                            {item.name}
                          </Switch>
                        </div>
                      )
                    }}
                  </For>
                </div>
              </section>
            )}
          </For>
        </Show>
      </Show>
    </SettingsPage>
  )
}
