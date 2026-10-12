/* SPDX-License-Identifier: MIT */
import { createResource, Show, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"

function createProjectUpdate(runID: Accessor<string | undefined>) {
  const sdk = useSDK()
  const [state, setState] = createStore({ busy: false, failed: false })
  const [latest, { mutate }] = createResource(runID, async (runID) => {
    setState("failed", false)
    try {
      const response = await sdk.client.team.latestProjectUpdate({ runID })
      if (response.error) throw response.error
      return { data: response.data, failed: false }
    } catch {
      return { data: null, failed: true }
    }
  })
  const snapshot = () => {
    const value = latest()?.data
    return value?.update.runId === runID() ? value : undefined
  }
  async function generate() {
    const requestedRun = runID()
    if (!requestedRun || state.busy) return
    setState({ busy: true, failed: false })
    try {
      const response = await sdk.client.team.generateProjectUpdate({ runID: requestedRun })
      if (response.error) throw response.error
      if (runID() === requestedRun) mutate({ data: response.data, failed: false })
    } catch {
      if (runID() === requestedRun) setState("failed", true)
    } finally {
      setState("busy", false)
    }
  }
  return {
    snapshot,
    generate,
    busy: () => state.busy,
    loading: () => latest.loading,
    failed: () => !!runID() && (state.failed || (!latest.loading && latest()?.failed)),
  }
}

export function WorkProjectUpdateCard(props: { runID?: string }) {
  const language = useLanguage()
  const update = createProjectUpdate(() => props.runID)
  return (
    <section data-v110="work-card" data-span="" data-work-project-update="">
      <div data-v110="work-card-head">
        <b>{language.t("workbench.work.cockpit.update")}</b>
        <div class="flex-1" />
        <button
          type="button"
          data-v110="work-btn"
          data-work-generate-update=""
          disabled={!props.runID || update.busy() || update.loading()}
          onClick={() => void update.generate()}
        >
          {language.t(update.busy() ? "common.loading" : "workbench.work.cockpit.generateUpdate")}
        </button>
      </div>
      <div data-v110="work-card-body" data-update="" aria-live="polite">
        <Show when={update.snapshot()} fallback={<p>{language.t("workbench.work.cockpit.updateEmpty")}</p>}>
          {(value) => (
            <>
              <p data-work-update-event={value().eventId}>
                {language.t("workbench.work.cockpit.updateSnapshot", {
                  completed: value().update.tasks.completed,
                  total: value().update.tasks.total,
                  running: value().update.tasks.running,
                  blocked: value().update.tasks.blocked,
                  reviews: value().update.reviews.changesRequested,
                })}
              </p>
              <time dateTime={value().update.observedAt}>{value().update.observedAt}</time>
            </>
          )}
        </Show>
        <Show when={update.failed()}>
          <p role="alert">{language.t("common.requestFailed")}</p>
        </Show>
      </div>
    </section>
  )
}
