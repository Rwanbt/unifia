import { type Component, createEffect, createResource, createSignal, onCleanup, Show } from "solid-js"
import { Button } from "@unifia/ui/button"
import { Select } from "@unifia/ui/select"
import { Switch as SwitchComponent } from "@unifia/ui/switch"
import { showToast } from "@unifia/ui/toast"
import { useSDK } from "@/context/sdk"
import { unwrap } from "@/utils/sdk-unwrap"
import { SettingsList } from "./settings-list"
import { SettingsRow } from "./settings-row"
import { SettingsPage } from "./settings-page"
import { useLanguage } from "@/context/language"
import { SettingsObservabilityPrivacy } from "./settings-observability-privacy"
import { SettingsObservabilityTimeline } from "./settings-observability-timeline"
import { SettingsObservabilityCost } from "./settings-observability-cost"
import { SettingsObservabilityExporters } from "./settings-observability-exporters"
import { SettingsObservabilityCompare, type CohortMetrics } from "./settings-observability-compare"
import { ObservabilityEventTable, traceCount } from "./settings-observability-events"

const confirmText = "DELETE"

type CompareResult = { cohorts: CohortMetrics[]; referenceIndex?: number; timeWindowMs?: number }

export const SettingsObservability: Component = () => {
  const language = useLanguage()
  const sdk = useSDK()
  const [sessionId, setSessionId] = createSignal<string>()
  const [dashboardScope, setDashboardScope] = createSignal<"project" | "all">("project")
  const [deleteScope, setDeleteScope] = createSignal<"session" | "project" | "all">("session")
  const [confirmation, setConfirmation] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [activeSubtab, setActiveSubtab] = createSignal<
    "overview" | "traces" | "timeline" | "comparisons" | "cost" | "events" | "privacy" | "exporters"
  >("overview")

  const [settings, settingsActions] = createResource(() => unwrap(sdk.client.observability.settings()))
  const [exportersConfig] = createResource(() => unwrap(sdk.client.observability.exporters.config()))
  const [health, healthActions] = createResource(() => unwrap(sdk.client.observability.health()))
  const [sessions, sessionsActions] = createResource(() =>
    unwrap(sdk.client.observability.sessions.list({ scope: dashboardScope(), limit: 100 })),
  )
  const [privacySessions] = createResource(() => unwrap(sdk.client.session.list({ limit: 50 })))
  const [events, eventsActions] = createResource(
    () => [sessionId(), dashboardScope()] as const,
    ([id, scope]) =>
      id ? unwrap(sdk.client.observability.events.list({ sessionId: id, scope, limit: 50 })) : Promise.resolve([]),
  )
  const [summary, summaryActions] = createResource(
    () => [sessionId(), dashboardScope()] as const,
    ([id, scope]) =>
      id ? unwrap(sdk.client.observability.summary({ sessionId: id, scope })) : Promise.resolve(undefined),
  )
  const [comparison, comparisonActions] = createResource(activeSubtab, (tab) =>
    tab === "comparisons"
      ? (unwrap(
          sdk.client.observability.compare({ timeWindowMs: 7 * 24 * 60 * 60 * 1000, scope: dashboardScope() }),
        ) as Promise<CompareResult>)
      : Promise.resolve(null),
  )
  const [refreshKey, setRefreshKey] = createSignal(0)

  createEffect(() => {
    const first = sessions.latest?.[0]
    if (!sessionId() && first) setSessionId(first.id)
  })

  const selected = () => sessions.latest?.find((item) => item.id === sessionId())
  const refresh = () => {
    setRefreshKey((value) => value + 1)
    void Promise.all([
      settingsActions.refetch(),
      healthActions.refetch(),
      sessionsActions.refetch(),
      eventsActions.refetch(),
      summaryActions.refetch(),
      comparisonActions.refetch(),
    ])
  }

  createEffect(() => {
    const unsubscribe = sdk.event.on("session.idle", (event) => {
      if (event.properties.sessionID === sessionId() || !sessionId()) refresh()
    })
    onCleanup(unsubscribe)
  })

  const update = async (patch: {
    enabled?: boolean
    captureMode?: "local_metadata" | "local_redacted"
    retentionDays?: number
    maxEvents?: number
  }) => {
    setBusy(true)
    try {
      const config = await unwrap(sdk.client.global.config.get())
      await unwrap(
        sdk.client.global.config.update({
          config: {
            ...config,
            experimental: {
              ...config.experimental,
              observability: { ...config.experimental?.observability, ...patch },
            },
          },
        }),
      )
      await Promise.all([settingsActions.refetch(), healthActions.refetch()])
      showToast({ variant: "success", title: language.t("settings.fork.observability.saveSuccess") })
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("settings.fork.observability.saveError"),
        description: error instanceof Error ? error.message : language.t("settings.fork.observability.requestFailed"),
      })
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    const session = selected()
    if (deleteScope() !== "all" && !session) return
    if (deleteScope() === "project" && !session?.projectID) return
    setBusy(true)
    try {
      const body =
        deleteScope() === "all"
          ? { scope: "all" as const }
          : deleteScope() === "project"
            ? { scope: "project" as const, id: session!.projectID! }
            : { scope: "session" as const, id: session!.id }
      const result = await unwrap(
        sdk.client.observability.data.delete({ body }, { headers: { "X-Confirm-Delete": "yes" } }),
      )
      setConfirmation("")
      refresh()
      showToast({
        variant: "success",
        title: language.t("settings.fork.observability.deleteSuccess", { count: result.deletedCount }),
      })
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("settings.fork.observability.deleteError"),
        description: error instanceof Error ? error.message : language.t("settings.fork.observability.requestFailed"),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsPage
      title={language.t("settings.fork.observability.title")}
      subtitle={language.t("settings.fork.observability.localMetadataNotice")}
      actions={
        <Button size="small" variant="secondary" onClick={refresh}>
          {language.t("settings.fork.observability.refresh")}
        </Button>
      }
      intro={{
        icon: "◉",
        title: language.t("settings.providers.intro.title"),
        text: language.t("settings.observability.intro"),
      }}
    >
      <SettingsList>
        <SettingsRow
          title={language.t("settings.fork.observability.dataScope")}
          description={language.t("settings.fork.observability.dataScopeDescription")}
        >
          <Select
            size="small"
            variant="secondary"
            triggerVariant="settings"
            options={["project", "all"] as const}
            current={dashboardScope()}
            label={(item) =>
              item === "project"
                ? language.t("settings.fork.observability.currentProject")
                : language.t("settings.fork.observability.allProjects")
            }
            onSelect={(item) => item && setDashboardScope(item)}
          />
        </SettingsRow>
      </SettingsList>
      <div>
        {/*
        Plain buttons, not the shared <Tabs> component: this panel already
        lives inside dialog-settings.tsx's outer vertical/"settings"-variant
        Tabs.Content. tabs.css's orientation/variant overrides key off
        [data-orientation="vertical"]/[data-variant="settings"] on the
        nearest [data-component="tabs"] ANCESTOR, but apply via a plain
        descendant combinator on [data-slot="tabs-list"]/[data-slot="tabs-content"]
        with no boundary at the next [data-component="tabs"] — so a second,
        nested <Tabs> here inherited height:100%/width:200px meant for the
        outer sidebar, collapsing this panel's actual content to 0 height
        (invisible, though present in the DOM) every time this tab was opened.
      */}
        <div data-slot="settings-subtabs" role="tablist">
          {(
            [
              ["overview", "sliders", "tabOverview"],
              ["traces", "branch", "tabTraces"],
              ["timeline", "task", "tabTimeline"],
              ["comparisons", "bullet-list", "tabComparisons"],
              ["cost", "checklist", "tabCost"],
              ["events", "bullet-list", "tabEvents"],
              ["privacy", "shield", "tabPrivacy"],
              ["exporters", "cloud-upload", "tabExporters"],
            ] as const
          ).map(([value, , label]) => (
            <button
              type="button"
              role="tab"
              aria-selected={activeSubtab() === value}
              onClick={() => setActiveSubtab(value)}
            >
              {language.t(`settings.fork.observability.${label}` as Parameters<typeof language.t>[0])}
            </button>
          ))}
        </div>

        <Show when={activeSubtab() === "overview"}>
          <div class="no-scrollbar">
            <section>
              <h3>{language.t("settings.fork.observability.capture")}</h3>
              <SettingsList>
                <SettingsRow
                  title={language.t("settings.fork.observability.enable")}
                  description={language.t("settings.fork.observability.captureDescription")}
                >
                  <div data-action="settings-observability-enabled">
                    <SwitchComponent
                      checked={settings.latest?.enabled ?? false}
                      disabled={busy()}
                      onChange={(enabled) => void update({ enabled })}
                    />
                  </div>
                </SettingsRow>
                <SettingsRow
                  title={language.t("settings.fork.observability.captureMode")}
                  description={language.t("settings.fork.observability.captureModeDescription")}
                >
                  <Select
                    size="small"
                    variant="secondary"
                    triggerVariant="settings"
                    options={["local_metadata", "local_redacted"] as const}
                    current={settings.latest?.captureMode ?? "local_metadata"}
                    label={(item) =>
                      item === "local_metadata"
                        ? language.t("settings.fork.observability.metadataOnly")
                        : language.t("settings.fork.observability.metadataRedaction")
                    }
                    onSelect={(item) => item && void update({ captureMode: item })}
                  />
                </SettingsRow>
              </SettingsList>
              <p data-slot="settings-note" data-tone="warning">
                {language.t("settings.fork.observability.sqliteNotice")}{" "}
                {exportersConfig.latest?.exporters.length
                  ? language.t("settings.fork.observability.exportersConfigured", {
                      count: exportersConfig.latest!.exporters.length,
                    })
                  : language.t("settings.fork.observability.noExporter")}
              </p>
            </section>
            <section>
              <h3>{language.t("settings.fork.observability.retention")}</h3>
              <SettingsList>
                <SettingsRow
                  title={language.t("settings.fork.observability.retentionDays")}
                  description={language.t("settings.fork.observability.retentionDescription")}
                >
                  <input
                    type="number"
                    data-slot="settings-number"
                    min={1}
                    placeholder={language.t("settings.fork.observability.retentionPlaceholder")}
                    value={settings.latest?.retentionDays ?? ""}
                    onChange={(event) => {
                      const v = event.currentTarget.value
                      void update({ retentionDays: v ? parseInt(v, 10) : undefined })
                    }}
                  />
                </SettingsRow>
                <SettingsRow
                  title={language.t("settings.fork.observability.maxEvents")}
                  description={language.t("settings.fork.observability.maxEventsDescription")}
                >
                  <input
                    type="number"
                    data-slot="settings-number"
                    min={1}
                    placeholder={language.t("settings.fork.observability.maxEventsPlaceholder")}
                    value={settings.latest?.maxEvents ?? ""}
                    onChange={(event) => {
                      const v = event.currentTarget.value
                      void update({ maxEvents: v ? parseInt(v, 10) : 100000 })
                    }}
                  />
                </SettingsRow>
              </SettingsList>
            </section>
            <section>
              <h3>{language.t("settings.fork.observability.health")}</h3>
              <p data-slot="settings-note" data-flush>
                {language.t("settings.fork.observability.healthDescription")}
              </p>
              <div data-slot="settings-health-grid">
                <Metric
                  label={language.t("settings.fork.observability.metricQueue")}
                  value={String(health.latest?.queueSize ?? 0)}
                />
                <Metric
                  label={language.t("settings.fork.observability.metricQueueBytes")}
                  value={`${((health.latest?.queueBytes ?? 0) / 1024).toFixed(1)} KiB`}
                />
                <Metric
                  label={language.t("settings.fork.observability.metricAccepted")}
                  value={String(health.latest?.eventsAccepted ?? 0)}
                />
                <Metric
                  label={language.t("settings.fork.observability.metricInserted")}
                  value={String(health.latest?.eventsInserted ?? 0)}
                />
                <Metric
                  label={language.t("settings.fork.observability.metricPersisted")}
                  value={String(health.latest?.eventsPersisted ?? 0)}
                />
                <Metric
                  label={language.t("settings.fork.observability.metricRejectedContext")}
                  value={String(health.latest?.eventsRejectedInvalidContext ?? 0)}
                />
                <Metric
                  label={language.t("settings.fork.observability.metricRejectedEvent")}
                  value={String(health.latest?.eventsRejectedInvalidEvent ?? 0)}
                />
                <Metric
                  label={language.t("settings.fork.observability.metricDroppedQueue")}
                  value={String(health.latest?.eventsDroppedQueueFull ?? 0)}
                />
                <Metric
                  label={language.t("settings.fork.observability.metricDroppedCircuit")}
                  value={String(health.latest?.eventsDroppedCircuitOpen ?? 0)}
                />
                <Metric
                  label={language.t("settings.fork.observability.metricDbFailures")}
                  value={String(health.latest?.eventsFailedDb ?? 0)}
                />
                <Metric
                  label={language.t("settings.fork.observability.metricDbBusy")}
                  value={String(health.latest?.eventsFailedBusy ?? 0)}
                />
                <Metric
                  label={language.t("settings.fork.observability.metricDbFull")}
                  value={String(health.latest?.eventsFailedFull ?? 0)}
                />
                <Metric
                  label={language.t("settings.fork.observability.metricDbCorrupt")}
                  value={String(health.latest?.eventsFailedCorrupt ?? 0)}
                />
                <Metric
                  label={language.t("settings.fork.observability.metricSanitizerFailed")}
                  value={String(health.latest?.sanitizerFailed ?? 0)}
                />
                <Metric
                  label={language.t("settings.fork.observability.metricLastError")}
                  value={health.latest?.lastErrorKind ?? "—"}
                />
              </div>
              <Show when={health.latest?.circuitOpen}>
                <p data-slot="settings-note" data-tone="warning">
                  {language.t("settings.fork.observability.circuitOpen")}
                </p>
              </Show>
            </section>
            <section>
              <h3>{language.t("settings.fork.observability.deleteData")}</h3>
              <SettingsList>
                <div data-slot="settings-danger-row">
                  <Select
                    size="small"
                    variant="secondary"
                    triggerVariant="settings"
                    options={["session", "project", "all"] as const}
                    current={deleteScope()}
                    label={(item) =>
                      item === "session"
                        ? language.t("settings.fork.observability.deleteScope")
                        : item === "project"
                          ? language.t("settings.fork.observability.currentProject")
                          : language.t("settings.fork.observability.allProjects")
                    }
                    onSelect={(item) => item && setDeleteScope(item)}
                  />
                  <input
                    type="text"
                    data-slot="settings-text-field"
                    aria-label={language.t("settings.fork.observability.confirmation")}
                    value={confirmation()}
                    placeholder={language.t("settings.fork.observability.confirmPlaceholder")}
                    onInput={(event) => setConfirmation(event.currentTarget.value)}
                  />
                  <Button
                    size="small"
                    data-tone="danger"
                    disabled={busy() || confirmation() !== confirmText || (deleteScope() !== "all" && !selected())}
                    onClick={() => void remove()}
                  >
                    {language.t("settings.fork.observability.deleteButton")}
                  </Button>
                </div>
              </SettingsList>
            </section>
          </div>
        </Show>

        <Show when={activeSubtab() === "traces"}>
          <div class="no-scrollbar">
            <div data-slot="obs-panel-head">
              <span data-slot="obs-session-count">
                {language.t("settings.observability.tracesCount", {
                  sessions: sessions.latest?.length ?? 0,
                  traces: traceCount(events.latest ?? []),
                })}
              </span>
              <Select
                size="small"
                variant="secondary"
                triggerVariant="settings"
                options={sessions.latest ?? []}
                current={selected()}
                value={(item) => item.id}
                label={(item) => item.title || item.id}
                onSelect={(item) => item && setSessionId(item.id)}
              />
            </div>
            <ObservabilityEventTable events={events.latest ?? []} />
          </div>
        </Show>

        <Show when={activeSubtab() === "comparisons"}>
          <div class="no-scrollbar">
            <SettingsObservabilityCompare cohorts={comparison.latest?.cohorts ?? []} />
          </div>
        </Show>

        <Show when={activeSubtab() === "events"}>
          <div class="no-scrollbar">
            <div data-slot="obs-panel-head">
              <h3>{language.t("settings.fork.observability.sessionEvents")}</h3>
              <Select
                size="small"
                variant="secondary"
                triggerVariant="settings"
                options={sessions.latest ?? []}
                current={selected()}
                value={(item) => item.id}
                label={(item) => item.title || item.id}
                onSelect={(item) => item && setSessionId(item.id)}
              />
            </div>
            <Show when={summary.latest}>
              {(value) => (
                <p data-slot="settings-note" data-flush>
                  {language.t("settings.fork.observability.eventsSummary", {
                    count: value().totalEvents,
                    cost: (value().totalCostNanoUsd / 1_000_000_000).toFixed(4),
                  })}
                </p>
              )}
            </Show>
            <ObservabilityEventTable events={events.latest ?? []} />
          </div>
        </Show>

        <Show when={activeSubtab() === "timeline"}>
          <div class="no-scrollbar">
            <SettingsObservabilityTimeline
              refreshKey={refreshKey()}
              sessions={sessions.latest ?? []}
              sessionId={sessionId()}
              scope={dashboardScope()}
              onSelectSession={setSessionId}
            />
          </div>
        </Show>

        <Show when={activeSubtab() === "cost"}>
          <div class="no-scrollbar">
            <SettingsObservabilityCost refreshKey={refreshKey()} scope={dashboardScope()} />
          </div>
        </Show>

        <Show when={activeSubtab() === "privacy"}>
          <div class="no-scrollbar">
            <SettingsObservabilityPrivacy
              sessions={privacySessions.latest ?? []}
              sessionId={
                privacySessions.latest?.some((item) => item.id === sessionId())
                  ? sessionId()
                  : privacySessions.latest?.[0]?.id
              }
              projectId={privacySessions.latest?.find((item) => item.id === sessionId())?.projectID}
              onSelectSession={setSessionId}
            />
          </div>
        </Show>

        <Show when={activeSubtab() === "exporters"}>
          <div class="no-scrollbar">
            <SettingsObservabilityExporters events={events.latest ?? []} />
          </div>
        </Show>
      </div>
    </SettingsPage>
  )
}

const Metric: Component<{ label: string; value: string }> = (props) => (
  <div>
    <b>{props.label}</b>
    <span>{props.value}</span>
  </div>
)
