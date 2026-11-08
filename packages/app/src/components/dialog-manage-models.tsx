import { Dialog } from "@unifia/ui/dialog"
import { List } from "@unifia/ui/list"
import { Switch } from "@unifia/ui/switch"
import { Tooltip } from "@unifia/ui/tooltip"
import { Button } from "@unifia/ui/button"
import type { Component } from "solid-js"
import type { useLocal } from "@/context/local"
import { compareProviders } from "./model-picker-order"
import { LocalAIEntry } from "./local-ai-entry"
import { useLanguage } from "@/context/language"
import { useDialog } from "@unifia/ui/context/dialog"
// DialogSelectProvider loaded on-demand (keeps manage-models chunk slim).

type ModelState = ReturnType<typeof useLocal>["model"]

export const DialogManageModels: Component<{ model: ModelState }> = (props) => {
  const local = { model: props.model }
  const language = useLanguage()
  const dialog = useDialog()

  const handleConnectProvider = () => {
    void import("./dialog-select-provider").then((m) => {
      dialog.show(() => <m.DialogSelectProvider />)
    })
  }
  const providerList = (providerID: string) => local.model.list().filter((x) => x.provider.id === providerID)
  const providerVisible = (providerID: string) =>
    providerList(providerID).every((x) => local.model.visible({ modelID: x.id, providerID: x.provider.id }))
  const setProviderVisibility = (providerID: string, checked: boolean) => {
    providerList(providerID).forEach((x) => {
      local.model.setVisibility({ modelID: x.id, providerID: x.provider.id }, checked)
    })
  }

  return (
    <Dialog
      title={language.t("dialog.model.manage")}
      description={language.t("dialog.model.manage.description")}
      action={
        <Button class="h-7 -my-1 text-14-medium" icon="plus-small" tabIndex={-1} onClick={handleConnectProvider}>
          {language.t("command.provider.connect")}
        </Button>
      }
    >
      <div class="px-3 pb-2">
        <LocalAIEntry model={local.model} />
      </div>
      <List
        search={{ placeholder: language.t("dialog.model.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("dialog.model.empty")}
        key={(x) => `${x?.provider?.id}:${x?.id}`}
        items={local.model.list()}
        filterKeys={["provider.name", "name", "id"]}
        sortBy={(a, b) => a.name.localeCompare(b.name)}
        groupBy={(x) => x.provider.id}
        groupHeader={(group) => {
          const provider = group.items[0].provider
          return (
            <>
              <span>{provider.name}</span>
              <Tooltip
                placement="top"
                value={language.t("dialog.model.manage.provider.toggle", { provider: provider.name })}
              >
                <Switch
                  class="-mr-1"
                  checked={providerVisible(provider.id)}
                  onChange={(checked) => setProviderVisibility(provider.id, checked)}
                  hideLabel
                >
                  {provider.name}
                </Switch>
              </Tooltip>
            </>
          )
        }}
        sortGroupsBy={(a, b) => compareProviders(a.items[0].provider.id, b.items[0].provider.id)}
        onSelect={(x) => {
          if (!x) return
          const key = { modelID: x.id, providerID: x.provider.id }
          local.model.setVisibility(key, !local.model.visible(key))
        }}
      >
        {(i) => (
          <div class="w-full flex items-center justify-between gap-x-3">
            <span>{i.name}</span>
            <div onClick={(e) => e.stopPropagation()}>
              <Switch
                checked={!!local.model.visible({ modelID: i.id, providerID: i.provider.id })}
                onChange={(checked) => {
                  local.model.setVisibility({ modelID: i.id, providerID: i.provider.id }, checked)
                }}
              />
            </div>
          </div>
        )}
      </List>
    </Dialog>
  )
}
