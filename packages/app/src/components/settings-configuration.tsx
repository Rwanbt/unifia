import { type Component, createSignal, createResource, Show, onCleanup, For } from "solid-js"
import { Switch } from "@unifia/ui/switch"
import { Select } from "@unifia/ui/select"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { SettingsPage, SettingsSection } from "./settings-page"
import { SettingsRow } from "./settings-row"

function invokeTauri(cmd: string, args?: Record<string, unknown>): Promise<any> {
  const tauri = (globalThis as any).__TAURI__
  if (!tauri?.core?.invoke) return Promise.reject("Tauri not available")
  return tauri.core.invoke(cmd, args)
}

export type AcceleratorMode = "auto" | "cpu" | "gpu" | "npu"

export type ModelConfiguration = {
  preset: "custom" | "fast" | "quality" | "eco" | "long-context"
  outputTokensMode: "auto" | "manual"
  outputTokensManual: number
  temperature: number
  topP: number
  topK: number
  contextMode: "auto" | "manual"
  contextManual: number
  kvCacheType: "auto" | "q8_0" | "q4_0" | "f16"
  offloadMode: "auto" | "gpu-max" | "balanced"
  mmapMode: "auto" | "on" | "off"
  draftModel: string
  accelerator: AcceleratorMode
  systemPrompt: string
  // Advanced
  threads: number // 0 = auto-detect big-cores
  flashAttn: boolean
  cacheReuse: boolean
  nBatch: number
}

const PRESETS: Record<string, Omit<ModelConfiguration, "preset" | "accelerator" | "systemPrompt">> = {
  fast: {
    outputTokensMode: "auto",
    outputTokensManual: 4096,
    temperature: 0.5,
    topP: 0.9,
    topK: 40,
    contextMode: "manual",
    contextManual: 8192,
    kvCacheType: "q4_0",
    offloadMode: "gpu-max",
    mmapMode: "auto",
    draftModel: "",
    threads: 0,
    flashAttn: true,
    cacheReuse: true,
    nBatch: 512,
  },
  quality: {
    outputTokensMode: "auto",
    outputTokensManual: 8192,
    temperature: 0.7,
    topP: 0.95,
    topK: 64,
    contextMode: "auto",
    contextManual: 131072,
    kvCacheType: "q8_0",
    offloadMode: "auto",
    mmapMode: "auto",
    draftModel: "",
    threads: 0,
    flashAttn: true,
    cacheReuse: true,
    nBatch: 512,
  },
  eco: {
    outputTokensMode: "manual",
    outputTokensManual: 4096,
    temperature: 0.5,
    topP: 0.9,
    topK: 40,
    contextMode: "manual",
    contextManual: 16384,
    kvCacheType: "q4_0",
    offloadMode: "balanced",
    mmapMode: "on",
    draftModel: "",
    threads: 4,
    flashAttn: true,
    cacheReuse: true,
    nBatch: 256,
  },
  "long-context": {
    outputTokensMode: "auto",
    outputTokensManual: 8192,
    temperature: 0.7,
    topP: 0.95,
    topK: 64,
    contextMode: "auto",
    contextManual: 131072,
    kvCacheType: "q4_0",
    offloadMode: "auto",
    mmapMode: "auto",
    draftModel: "",
    threads: 0,
    flashAttn: true,
    cacheReuse: false,
    nBatch: 1024,
  },
}

const DEFAULT_CONFIG: ModelConfiguration = {
  preset: "quality",
  outputTokensMode: "auto",
  outputTokensManual: 8192,
  temperature: 0.7,
  topP: 0.95,
  topK: 64,
  contextMode: "auto",
  contextManual: 32768,
  kvCacheType: "auto",
  offloadMode: "auto",
  mmapMode: "auto",
  draftModel: "",
  accelerator: "auto",
  systemPrompt: "",
  threads: 0,
  flashAttn: true,
  cacheReuse: true,
  nBatch: 512,
}

const STORAGE_KEY = "opencode-model-config"

export function loadModelConfig(): ModelConfiguration {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
  } catch {}
  return { ...DEFAULT_CONFIG }
}

function saveConfig(c: ModelConfiguration) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(c))
}

export const SettingsConfiguration: Component = () => {
  const language = useLanguage()
  const [config, setConfig] = createStore<ModelConfiguration>(loadModelConfig())
  const [advancedOpen, setAdvancedOpen] = createSignal(false)

  const update = <K extends keyof ModelConfiguration>(key: K, value: ModelConfiguration[K]) => {
    setConfig(key, value as any)
    saveConfig({ ...config })
  }

  const formatTokens = (n: number) => (n >= 1000 ? `${(n / 1024).toFixed(n % 1024 === 0 ? 0 : 1)}K` : String(n))
  const auto = () => language.t("settings.localConfig.optionAuto")
  const acceleratorLabel = (value: AcceleratorMode) =>
    ({
      auto: auto(),
      cpu: language.t("settings.localConfig.optionCpu"),
      gpu: language.t("settings.localConfig.optionGpu"),
      npu: language.t("settings.localConfig.optionNpu"),
    })[value]
  const quantLabel = (value: string) =>
    ({
      auto: language.t("settings.localConfig.quantAuto"),
      q8_0: language.t("settings.localConfig.quantQ8"),
      q4_0: language.t("settings.localConfig.quantQ4"),
      f16: language.t("settings.localConfig.quantF16"),
    })[value] ?? value
  const modeLabel = (value: string) =>
    value === "auto"
      ? language.t("settings.localConfig.optionAutoRecommended")
      : language.t("settings.localConfig.optionManual")

  // The reference's .v93-runtime-summary: the effective runtime at a glance.
  const summary = () => [
    { label: language.t("settings.configuration.summary.accelerator"), value: acceleratorLabel(config.accelerator) },
    {
      label: language.t("settings.configuration.summary.context"),
      value: config.contextMode === "auto" ? auto() : formatTokens(config.contextManual),
    },
    {
      label: language.t("settings.configuration.summary.output"),
      value: config.outputTokensMode === "auto" ? auto() : formatTokens(config.outputTokensManual),
    },
    {
      label: language.t("settings.configuration.summary.kvBatch"),
      value: `${quantLabel(config.kvCacheType)} · ${config.nBatch}`,
    },
  ]

  return (
    <SettingsPage
      title={language.t("settings.localConfig.title")}
      subtitle={language.t("settings.localConfig.description")}
      intro={{
        icon: "›_",
        title: language.t("settings.configuration.intro.title"),
        text: language.t("settings.configuration.intro.text"),
      }}
    >
      <div data-slot="settings-status-grid" data-compact>
        <For each={summary()}>
          {(item) => (
            <div>
              <span>{item.label}</span>
              <b>{item.value}</b>
            </div>
          )}
        </For>
      </div>

      {/* Hardware status */}
      <VramWidget />
      <ThermalWidget />

      <SettingsSection title={language.t("settings.localConfig.accelerator")}>
        <SettingsRow
          title={language.t("settings.localConfig.backend")}
          description={language.t("settings.localConfig.backendDescription")}
        >
          <SegmentedButton<AcceleratorMode>
            options={(["auto", "cpu", "gpu", "npu"] as const).map((value) => ({
              value,
              label: acceleratorLabel(value),
            }))}
            value={config.accelerator}
            onChange={(v) => update("accelerator", v)}
          />
        </SettingsRow>
      </SettingsSection>
      <p data-slot="settings-note">{language.t("settings.localConfig.acceleratorHint")}</p>

      <SettingsSection title={language.t("settings.localConfig.systemPrompt")}>
        <SettingsRow
          title={language.t("settings.localConfig.customPrompt")}
          description={language.t("settings.localConfig.customPromptDescription")}
        >
          <textarea
            data-slot="settings-textarea"
            value={config.systemPrompt}
            onInput={(event) => update("systemPrompt", event.currentTarget.value)}
            placeholder={language.t("settings.localConfig.promptPlaceholder")}
            aria-label={language.t("settings.localConfig.systemPrompt")}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={language.t("settings.localConfig.preset")}>
        <SettingsRow
          title={language.t("settings.localConfig.profile")}
          description={language.t("settings.localConfig.profileDescription")}
        >
          <Select
            {...SELECT}
            options={["custom", "fast", "quality", "eco", "long-context"]}
            current={config.preset}
            label={(x) =>
              ({
                custom: language.t("settings.localConfig.presetCustom"),
                fast: language.t("settings.localConfig.presetFast"),
                quality: language.t("settings.localConfig.presetQuality"),
                eco: language.t("settings.localConfig.presetEco"),
                "long-context": language.t("settings.localConfig.presetLongContext"),
              })[x] ?? x
            }
            onSelect={(v) => {
              if (!v) return
              update("preset", v as any)
              if (v !== "custom" && PRESETS[v]) {
                Object.entries(PRESETS[v]).forEach(([k, val]) => update(k as any, val as any))
              }
            }}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={language.t("settings.localConfig.outputTokens")}>
        <SettingsRow
          title={language.t("settings.localConfig.mode")}
          description={language.t("settings.localConfig.outputModeDescription")}
        >
          <Select
            {...SELECT}
            options={["auto", "manual"]}
            current={config.outputTokensMode}
            label={modeLabel}
            onSelect={(v) => {
              if (v) update("outputTokensMode", v as any)
            }}
          />
        </SettingsRow>
        <Show when={config.outputTokensMode === "manual"}>
          <SettingsRow
            title={language.t("settings.localConfig.maxOutputTokens")}
            description={language.t("settings.localConfig.maxOutputDescription")}
          >
            <SettingsNumber
              value={config.outputTokensManual}
              min={1024}
              max={32768}
              step={512}
              onChange={(v) => update("outputTokensManual", v)}
            />
          </SettingsRow>
        </Show>
      </SettingsSection>
      <p data-slot="settings-note">{language.t("settings.localConfig.outputModeHint")}</p>

      <SettingsSection title={language.t("settings.localConfig.contextWindow")}>
        <SettingsRow
          title={language.t("settings.localConfig.mode")}
          description={language.t("settings.localConfig.contextModeDescription")}
        >
          <Select
            {...SELECT}
            options={["auto", "manual"]}
            current={config.contextMode}
            label={modeLabel}
            onSelect={(v) => {
              if (v) update("contextMode", v as any)
            }}
          />
        </SettingsRow>
        <Show when={config.contextMode === "manual"}>
          <SettingsRow
            title={language.t("settings.localConfig.contextSize")}
            description={language.t("settings.localConfig.contextSizeDescription")}
          >
            <SettingsNumber
              value={config.contextManual}
              min={4096}
              max={131072}
              step={4096}
              onChange={(v) => update("contextManual", v)}
            />
          </SettingsRow>
        </Show>
      </SettingsSection>

      <SettingsSection title={language.t("settings.localConfig.sampling")}>
        <SettingsRow
          title={language.t("settings.localConfig.temperature")}
          description={language.t("settings.localConfig.temperatureDescription")}
        >
          <SettingsNumber
            value={config.temperature}
            min={0}
            max={2}
            step={0.05}
            decimals={2}
            onChange={(v) => update("temperature", v)}
          />
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.localConfig.topP")}
          description={language.t("settings.localConfig.topPDescription")}
        >
          <SettingsNumber
            value={config.topP}
            min={0}
            max={1}
            step={0.01}
            decimals={2}
            onChange={(v) => update("topP", v)}
          />
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.localConfig.topK")}
          description={language.t("settings.localConfig.topKDescription")}
        >
          <SettingsNumber value={config.topK} min={1} max={100} step={1} onChange={(v) => update("topK", v)} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={language.t("settings.localConfig.kvCache")}>
        <SettingsRow
          title={language.t("settings.localConfig.quantization")}
          description={language.t("settings.localConfig.quantizationDescription")}
        >
          <Select
            {...SELECT}
            options={["auto", "q8_0", "q4_0", "f16"]}
            current={config.kvCacheType}
            label={quantLabel}
            onSelect={(v) => {
              if (v) update("kvCacheType", v as any)
            }}
          />
        </SettingsRow>
      </SettingsSection>
      <p data-slot="settings-note">{language.t("settings.localConfig.quantizationHint")}</p>

      <SettingsSection title={language.t("settings.localConfig.offloading")}>
        <SettingsRow
          title={language.t("settings.localConfig.mode")}
          description={language.t("settings.localConfig.offloadDescription")}
        >
          <Select
            {...SELECT}
            options={["auto", "gpu-max", "balanced"]}
            current={config.offloadMode}
            label={(x) =>
              ({
                auto: language.t("settings.localConfig.offloadAuto"),
                "gpu-max": language.t("settings.localConfig.offloadGpuMax"),
                balanced: language.t("settings.localConfig.offloadBalanced"),
              })[x] ?? x
            }
            onSelect={(v) => {
              if (v) update("offloadMode", v as any)
            }}
          />
        </SettingsRow>
      </SettingsSection>
      <p data-slot="settings-note">{language.t("settings.localConfig.offloadHint")}</p>

      <SettingsSection title={language.t("settings.localConfig.memory")}>
        <SettingsRow
          title={language.t("settings.localConfig.mmap")}
          description={language.t("settings.localConfig.mmapDescription")}
        >
          <Select
            {...SELECT}
            options={["auto", "on", "off"]}
            current={config.mmapMode}
            label={(x) =>
              ({
                auto: language.t("settings.localConfig.optionAutoRecommended"),
                on: language.t("settings.localConfig.mmapOn"),
                off: language.t("settings.localConfig.mmapOff"),
              })[x] ?? x
            }
            onSelect={(v) => {
              if (v) update("mmapMode", v as any)
            }}
          />
        </SettingsRow>
      </SettingsSection>
      <p data-slot="settings-note">{language.t("settings.localConfig.mmapHint")}</p>

      <SettingsSection title={language.t("settings.localConfig.speculative")}>
        <SettingsRow
          title={language.t("settings.localConfig.draftModel")}
          description={language.t("settings.localConfig.draftModelDescription")}
        >
          <DraftModelSelect current={config.draftModel} onSelect={(v) => update("draftModel", v)} />
        </SettingsRow>
      </SettingsSection>
      <p data-slot="settings-note">{language.t("settings.localConfig.speculativeHint")}</p>

      <button
        type="button"
        data-slot="settings-advanced-toggle"
        aria-expanded={advancedOpen()}
        onClick={() => setAdvancedOpen(!advancedOpen())}
      >
        {language.t("settings.localConfig.advanced")} <span aria-hidden="true">⌄</span>
      </button>
      <Show when={advancedOpen()}>
        <SettingsSection>
          <SettingsRow
            title={language.t("settings.localConfig.cpuThreads")}
            description={language.t("settings.localConfig.cpuThreadsDescription")}
          >
            <SettingsNumber value={config.threads} min={0} max={16} step={1} onChange={(v) => update("threads", v)} />
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.localConfig.flashAttention")}
            description={language.t("settings.localConfig.flashAttentionDescription")}
          >
            <Switch checked={config.flashAttn} onChange={(v) => update("flashAttn", v)} />
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.localConfig.cacheReuse")}
            description={language.t("settings.localConfig.cacheReuseDescription")}
          >
            <Switch checked={config.cacheReuse} onChange={(v) => update("cacheReuse", v)} />
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.localConfig.batchSize")}
            description={language.t("settings.localConfig.batchSizeDescription")}
          >
            <SettingsNumber value={config.nBatch} min={64} max={2048} step={64} onChange={(v) => update("nBatch", v)} />
          </SettingsRow>
        </SettingsSection>
        <p data-slot="settings-note">{language.t("settings.localConfig.advancedHint")}</p>
      </Show>
    </SettingsPage>
  )
}

// ─── Helper components ─────────────────────────────────────────────────

// Every select on this page takes the reference's settings trigger.
const SELECT = { variant: "secondary", size: "small", triggerVariant: "settings" } as const

/** The reference's `.number-input`, clamped to its range on commit. */
function SettingsNumber(props: {
  value: number
  min: number
  max: number
  step: number
  decimals?: number
  onChange: (v: number) => void
}) {
  const commit = (raw: string) => {
    const parsed = Number.parseFloat(raw.replace(",", "."))
    if (!Number.isFinite(parsed)) return
    const clamped = Math.min(props.max, Math.max(props.min, parsed))
    const factor = 10 ** (props.decimals ?? 0)
    const next = Math.round(clamped * factor) / factor
    if (next !== props.value) props.onChange(next)
  }
  return (
    <input
      type="number"
      data-slot="settings-number"
      value={props.value}
      min={props.min}
      max={props.max}
      step={props.step}
      onChange={(event) => commit(event.currentTarget.value)}
    />
  )
}

/** The reference's `.segmented`: one bordered strip of options. */
function SegmentedButton<T extends string>(props: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div data-slot="settings-segmented" role="group">
      <For each={props.options}>
        {(opt) => (
          <button type="button" aria-pressed={props.value === opt.value} onClick={() => props.onChange(opt.value)}>
            {opt.label}
          </button>
        )}
      </For>
    </div>
  )
}

const NO_DRAFT = "none"

function DraftModelSelect(props: { current: string; onSelect: (v: string) => void }) {
  const language = useLanguage()
  const [tick, setTick] = createSignal(0)
  const [models] = createResource(tick, async () => {
    try {
      const all: { filename: string; size: number }[] = await invokeTauri("list_models")
      // Only show small models suitable as drafts (< 4 GB)
      return all.filter((m) => m.size < 4_000_000_000)
    } catch {
      return []
    }
  })
  // Re-scan models directory when window regains focus
  // (covers: new file added while settings open, alt-tabbed back)
  const onVisible = () => {
    if (document.visibilityState === "visible") setTick((t) => t + 1)
  }
  document.addEventListener("visibilitychange", onVisible)
  onCleanup(() => document.removeEventListener("visibilitychange", onVisible))

  const formatSize = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`

  return (
    <Select
      {...SELECT}
      // The select cannot hold an empty value: "none" stands for no draft model.
      options={[NO_DRAFT, ...(models() ?? []).map((m) => m.filename)]}
      current={props.current || NO_DRAFT}
      label={(x) => {
        if (x === NO_DRAFT) return language.t("settings.localConfig.draftNone")
        const m = models()?.find((m) => m.filename === x)
        const name = x.replace(/\.gguf$/i, "")
        return m ? `${name} (${formatSize(m.size)})` : name
      }}
      onSelect={(v) => {
        if (v !== undefined) props.onSelect(v === NO_DRAFT ? "" : v)
      }}
    />
  )
}

function VramWidget() {
  const language = useLanguage()
  const [vram, setVram] = createSignal<{
    total_mib: number
    used_mib: number
    free_mib: number
    gpu_name: string
    isDeviceRam?: boolean
  } | null>(null)

  ;(async () => {
    try {
      // Try desktop GPU VRAM first (nvidia-smi)
      const info = await invokeTauri("get_vram_info")
      setVram(info)
    } catch {
      // Fallback to mobile RAM info (/proc/meminfo)
      try {
        const mem: { total_mb: number; available_mb: number; used_mb: number } = await invokeTauri("get_memory_info")
        setVram({
          total_mib: mem.total_mb,
          used_mib: mem.used_mb,
          free_mib: mem.available_mb,
          gpu_name: "Device RAM",
          isDeviceRam: true,
        })
      } catch {
        /* no memory info available */
      }
    }
  })()

  return (
    <Show when={vram()}>
      {(info) => {
        const pct = () => Math.round((info().used_mib / info().total_mib) * 100)
        return (
          <div data-slot="gpu-card">
            <div>
              <b>{info().isDeviceRam ? language.t("settings.localConfig.deviceRam") : info().gpu_name}</b>
              <span>
                {info().used_mib} / {info().total_mib} MiB ({pct()}%)
              </span>
            </div>
            {/* Past 90 % the bar turns critical; below it follows the accent. */}
            <div data-slot="gpu-bar" data-critical={pct() >= 90 ? "" : undefined}>
              <i style={{ width: `${pct()}%` }} />
            </div>
            <div>
              <b>{language.t("settings.localConfig.freeSpace", { free: info().free_mib })}</b>
              <span>{info().isDeviceRam ? "RAM" : "VRAM"}</span>
            </div>
          </div>
        )
      }}
    </Show>
  )
}

function ThermalWidget() {
  const language = useLanguage()
  const THERMAL_MSG: Record<string, string> = {
    fair: language.t("settings.localConfig.thermalFair"),
    serious: language.t("settings.localConfig.thermalSerious"),
    critical: language.t("settings.localConfig.thermalCritical"),
  }
  const [thermal, setThermal] = createSignal<"nominal" | "fair" | "serious" | "critical">("nominal")

  const poll = async () => {
    try {
      const state = await invokeTauri("get_thermal_state")
      setThermal(state as "nominal" | "fair" | "serious" | "critical")
    } catch {
      /* unavailable on Windows */
    }
  }

  poll()
  const id = setInterval(poll, 10_000)
  onCleanup(() => clearInterval(id))

  return (
    <Show when={thermal() !== "nominal"}>
      <p data-slot="settings-note" data-tone="warning" data-thermal={thermal()}>
        {THERMAL_MSG[thermal()] ?? ""}
      </p>
    </Show>
  )
}
