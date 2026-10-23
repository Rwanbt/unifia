/* SPDX-License-Identifier: MIT */
// FORK: ADR-097 toolchains and ADR-098 containers, on the phone. Only shown in settings-compute.tsx on Android.
// Every action goes through the generated SDK client and shows the server's reason when it refuses.
import { createResource, createSignal, For, Show, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@unifia/ui/button"
import { TextField } from "@unifia/ui/text-field"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { SettingsList } from "./settings-list"
import { SettingsRow } from "./settings-row"
import { errorMessage, splitPackageNames } from "./settings-dev-environment-model"

type Outcome = { error?: unknown }

// The SDK answers with { data, error } and throws only when the request never leaves the phone, so both
// shapes end here as one visible message.
function useOperation(refetch: () => void) {
  const [state, setState] = createStore({ busy: false, error: "" })
  const run = async (work: () => Promise<Outcome>): Promise<boolean> => {
    if (state.busy) return false
    setState({ busy: true, error: "" })
    const outcome = await work().catch((error: unknown) => ({ error }))
    setState({ busy: false, error: outcome.error === undefined ? "" : errorMessage(outcome.error) })
    refetch()
    return outcome.error === undefined
  }
  return { state, run }
}

function OperationError(props: { message: string }) {
  return (
    <Show when={props.message}>
      <p class="text-12-regular text-text-critical-base">{props.message}</p>
    </Show>
  )
}

function ToolchainPanel() {
  const language = useLanguage()
  const sdk = useSDK()
  const [packages, { refetch }] = createResource(async () => {
    const result = await sdk.client.toolchain.list()
    if (result.error) throw result.error
    return result.data ?? []
  })
  const operation = useOperation(() => refetch())
  const [draft, setDraft] = createSignal("")

  const install = async () => {
    const names = splitPackageNames(draft())
    if (names.length === 0) return
    if (await operation.run(() => sdk.client.toolchain.install({ packages: names }))) setDraft("")
  }

  return (
    <div class="flex flex-col gap-2">
      <span class="text-13-medium text-text-base">{language.t("settings.fork.devEnvironment.packagesTitle")}</span>
      <Show when={!packages.loading} fallback={<span class="text-12-regular text-text-weaker">{language.t("settings.fork.devEnvironment.busy")}</span>}>
        <Show
          when={(packages() ?? []).length > 0}
          fallback={<span class="text-12-regular text-text-weaker">{language.t("settings.fork.devEnvironment.packagesEmpty")}</span>}
        >
          <For each={packages()}>
            {(pkg) => (
              <div class="flex items-center justify-between gap-2">
                <span class="text-13-regular text-text-base">
                  {pkg.name} {pkg.version}
                </span>
                <div class="flex items-center gap-2">
                  <span class="text-12-regular text-text-weaker">
                    {language.t(pkg.explicit ? "settings.fork.devEnvironment.explicitBadge" : "settings.fork.devEnvironment.dependencyBadge")}
                  </span>
                  <Show when={pkg.explicit}>
                    <Button
                      size="small"
                      disabled={operation.state.busy}
                      onClick={() => operation.run(() => sdk.client.toolchain.remove({ packages: [pkg.name] }))}
                    >
                      {language.t("settings.fork.devEnvironment.remove")}
                    </Button>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </Show>
      </Show>
      <div class="flex items-center gap-2">
        <TextField
          placeholder={language.t("settings.fork.devEnvironment.installPlaceholder")}
          value={draft()}
          disabled={operation.state.busy}
          onChange={setDraft}
        />
        <Button size="small" disabled={operation.state.busy || draft().trim().length === 0} onClick={install}>
          {language.t("settings.fork.devEnvironment.install")}
        </Button>
      </div>
      <div class="flex items-center gap-2">
        <Button size="small" disabled={operation.state.busy} onClick={() => operation.run(() => sdk.client.toolchain.update())}>
          {language.t("settings.fork.devEnvironment.update")}
        </Button>
        <Button size="small" disabled={operation.state.busy} onClick={() => operation.run(() => sdk.client.toolchain.rollback())}>
          {language.t("settings.fork.devEnvironment.rollback")}
        </Button>
      </div>
      <OperationError message={operation.state.error} />
    </div>
  )
}

function ContainerPanel() {
  const language = useLanguage()
  const sdk = useSDK()
  const [images, { refetch }] = createResource(async () => {
    const result = await sdk.client.container.images()
    if (result.error) throw result.error
    return result.data ?? []
  })
  const operation = useOperation(() => refetch())
  const [draft, setDraft] = createSignal("")

  const pull = async () => {
    const reference = draft().trim()
    if (reference.length === 0) return
    if (await operation.run(() => sdk.client.container.pull({ reference }))) setDraft("")
  }

  return (
    <div class="flex flex-col gap-2">
      <span class="text-13-medium text-text-base">{language.t("settings.fork.devEnvironment.imagesTitle")}</span>
      <Show
        when={(images() ?? []).length > 0}
        fallback={<span class="text-12-regular text-text-weaker">{language.t("settings.fork.devEnvironment.imagesEmpty")}</span>}
      >
        <For each={images()}>
          {(image) => (
            <div class="flex items-center justify-between gap-2">
              <span class="text-13-regular text-text-base break-all">{image.name}</span>
              <Button
                size="small"
                disabled={operation.state.busy}
                onClick={() => operation.run(() => sdk.client.container.rmi({ reference: image.name }))}
              >
                {language.t("settings.fork.devEnvironment.remove")}
              </Button>
            </div>
          )}
        </For>
      </Show>
      <div class="flex items-center gap-2">
        <TextField
          placeholder={language.t("settings.fork.devEnvironment.pullPlaceholder")}
          value={draft()}
          disabled={operation.state.busy}
          onChange={setDraft}
        />
        <Button size="small" disabled={operation.state.busy || draft().trim().length === 0} onClick={pull}>
          {language.t("settings.fork.devEnvironment.pull")}
        </Button>
      </div>
      <OperationError message={operation.state.error} />
    </div>
  )
}

export const SettingsDevEnvironment: Component = () => {
  const language = useLanguage()
  return (
    <SettingsList>
      <SettingsRow
        title={language.t("settings.fork.devEnvironment.title")}
        description={language.t("settings.fork.devEnvironment.description")}
      >
        <div class="flex flex-col gap-4 w-full">
          <ToolchainPanel />
          <ContainerPanel />
        </div>
      </SettingsRow>
    </SettingsList>
  )
}
