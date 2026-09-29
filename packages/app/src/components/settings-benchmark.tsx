/**
 * Benchmark tab — measure local LLM inference speed on this device.
 *
 * MVP: runs a fixed-size prompt (128 prefill + 64 decode) against the
 * currently loaded llama-server and reports tokens/sec for both phases.
 * Results are persisted to localStorage so the user keeps a per-model
 * history without re-running every visit.
 *
 * Why: Google AI Edge Gallery makes the user guess which accelerator to
 * pick. Here we measure on the actual device and surface a verdict.
 *
 * Future: when run_device_backend_benchmark lands in the Rust side, this
 * UI will iterate over CPU / OpenCL / Vulkan / Hexagon and show a table.
 */
import { type Component, createSignal, createResource, createMemo, For, Show } from "solid-js"
import { Button } from "@unifia/ui/button"
import { Select } from "@unifia/ui/select"
import { useLanguage } from "@/context/language"
import { SettingsPage, SettingsSection } from "./settings-page"
import { SettingsRow } from "./settings-row"

function invokeTauri(cmd: string, args?: Record<string, unknown>): Promise<any> {
  const tauri = (globalThis as any).__TAURI__
  if (!tauri?.core?.invoke) return Promise.reject("Tauri not available")
  return tauri.core.invoke(cmd, args)
}

type BenchResult = {
  modelFilename: string
  backend: string
  promptTokens: number
  generatedTokens: number
  prefillMs: number
  decodeMs: number
  prefillTps: number
  decodeTps: number
  peakRamMib?: number
  timestamp: number
  deviceLabel?: string
  error?: string
}

const HISTORY_KEY = "unifia-benchmark-history"
const MAX_HISTORY = 20
const BENCH_PROMPT =
  "Write a short technical paragraph (about 200 words) explaining how a CPU's branch predictor works, focusing on the difference between static and dynamic prediction strategies."
// Target: ~128 input tokens after tokenization, 64 generated tokens.
const BENCH_N_PREDICT = 64

function loadHistory(): BenchResult[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as BenchResult[]
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function saveHistory(history: BenchResult[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)))
  } catch {}
}

export const SettingsBenchmark: Component = () => {
  const language = useLanguage()
  const [history, setHistory] = createSignal<BenchResult[]>(loadHistory())
  const [running, setRunning] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [selectedModel, setSelectedModel] = createSignal<string>("")
  const [progressMessage, setProgressMessage] = createSignal<string>("")

  // List the user's downloaded models so they can bench any of them.
  const [models] = createResource(async () => {
    try {
      const all: { filename: string; size: number }[] = await invokeTauri("list_models")
      if (all.length > 0 && !selectedModel()) setSelectedModel(all[0].filename)
      return all
    } catch {
      return []
    }
  })

  // Detected backend (best-effort; UI label only — backend is whichever
  // llama-server was launched with). On mobile this could call into
  // LlamaEngine.detectBestBackend(); on desktop it's typically CUDA/Vulkan.
  const [backend] = createResource(async () => {
    try {
      const b: string = await invokeTauri("detect_active_backend")
      return b
    } catch {
      return "auto"
    }
  })

  async function runBenchmark() {
    const modelFilename = selectedModel()
    if (!modelFilename) {
      setError(language.t("settings.fork.benchmark.noModelSelected"))
      return
    }
    setRunning(true)
    setError(null)
    setProgressMessage(language.t("settings.fork.benchmark.loadingModel"))

    try {
      // Make sure the chosen model is loaded (no-op if already current).
      try {
        await invokeTauri("load_llm_model", { filename: modelFilename, draftModel: null })
      } catch (e) {
        // Loading errors are surfaced here but don't stop the bench attempt:
        // the model may already be the active one and the command may have
        // refused on that basis.
        console.warn("[Benchmark] load_llm_model returned:", e)
      }

      setProgressMessage(language.t("settings.fork.benchmark.runningInference"))

      const result: {
        prompt_tokens: number
        generated_tokens: number
        prefill_ms: number
        decode_ms: number
        prefill_tps: number
        decode_tps: number
        peak_ram_mib?: number
        device_label?: string
      } = await invokeTauri("run_inference_benchmark", {
        prompt: BENCH_PROMPT,
        nPredict: BENCH_N_PREDICT,
      })

      const entry: BenchResult = {
        modelFilename,
        backend: backend() ?? "auto",
        promptTokens: result.prompt_tokens,
        generatedTokens: result.generated_tokens,
        prefillMs: result.prefill_ms,
        decodeMs: result.decode_ms,
        prefillTps: result.prefill_tps,
        decodeTps: result.decode_tps,
        peakRamMib: result.peak_ram_mib,
        deviceLabel: result.device_label,
        timestamp: Date.now(),
      }

      const next = [entry, ...history()].slice(0, MAX_HISTORY)
      setHistory(next)
      saveHistory(next)
      setProgressMessage("")
    } catch (e: any) {
      const msg = e?.message ? String(e.message) : e ? String(e) : language.t("settings.fork.benchmark.unknownError")
      setError(msg)
      setProgressMessage("")
    } finally {
      setRunning(false)
    }
  }

  function clearHistory() {
    setHistory([])
    saveHistory([])
  }

  const bestEntry = createMemo(() => {
    // Per-model winner = highest decode tok/s seen.
    const grouped = new Map<string, BenchResult>()
    for (const e of history()) {
      if (e.error) continue
      const key = `${e.modelFilename}|${e.backend}`
      const prev = grouped.get(key)
      if (!prev || e.decodeTps > prev.decodeTps) grouped.set(key, e)
    }
    return [...grouped.values()].sort((a, b) => b.decodeTps - a.decodeTps)
  })

  return (
    <SettingsPage
      title={language.t("settings.fork.benchmark.title")}
      subtitle={language.t("settings.fork.benchmark.description")}
      intro={{
        icon: "⌁",
        title: language.t("settings.providers.intro.title"),
        text: language.t("settings.benchmark.intro"),
      }}
    >
      <SettingsSection title={language.t("settings.fork.benchmark.run")}>
        <SettingsRow
          title={language.t("settings.fork.benchmark.targetModel")}
          description={language.t("settings.fork.benchmark.targetModelDescription")}
        >
          <Select
            options={(models() ?? []).map((m) => m.filename)}
            current={selectedModel()}
            label={(x) => x.replace(/\.gguf$/i, "")}
            onSelect={(v) => {
              if (v) setSelectedModel(v)
            }}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.fork.benchmark.activeBackend")}
          description={language.t("settings.fork.benchmark.activeBackendDescription")}
        >
          <span data-slot="settings-value">{backend() ?? language.t("settings.fork.benchmark.backendAuto")}</span>
        </SettingsRow>
      </SettingsSection>

      {/* .benchmark-run: the action beside a progress bar that fills while it runs. */}
      <div data-slot="benchmark-run">
        <Button
          data-action="settings-benchmark-run"
          onClick={runBenchmark}
          disabled={running() || !selectedModel()}
          variant="primary"
        >
          {running()
            ? language.t("settings.fork.benchmark.running")
            : history().length > 0
              ? language.t("settings.fork.benchmark.rerun")
              : language.t("settings.fork.benchmark.run")}
        </Button>
        <Show when={history().length > 0}>
          <Button data-action="settings-benchmark-clear" onClick={clearHistory} disabled={running()}>
            {language.t("settings.fork.benchmark.clearHistory")}
          </Button>
        </Show>
        <div data-slot="benchmark-progress" data-running={running() ? "" : undefined}>
          <i />
        </div>
      </div>
      <Show when={progressMessage()}>
        <p data-slot="settings-note">{progressMessage()}</p>
      </Show>
      <Show when={error()}>
        <p data-slot="settings-note" data-tone="warning">
          {error()}
        </p>
      </Show>
      <p data-slot="settings-note">{language.t("settings.fork.benchmark.workload")}</p>

      {/* Best per (model, backend) */}
      <Show when={bestEntry().length > 0}>
        <h3>{language.t("settings.fork.benchmark.bestResult")}</h3>
        <div data-slot="settings-table">
          <div data-slot="settings-table-head">
            <span>{language.t("settings.fork.benchmark.model")}</span>
            <span>{language.t("settings.fork.benchmark.backend")}</span>
            <span>{language.t("settings.fork.benchmark.prefill")}</span>
            <span>{language.t("settings.fork.benchmark.decode")}</span>
            <span>{language.t("settings.fork.benchmark.ram")}</span>
          </div>
          <For each={bestEntry()}>
            {(r) => (
              <div data-slot="settings-table-row">
                <span title={r.modelFilename}>{r.modelFilename.replace(/\.gguf$/i, "")}</span>
                <span>{r.backend}</span>
                <span>{r.prefillTps.toFixed(1)}</span>
                <span>{r.decodeTps.toFixed(2)}</span>
                <span>{r.peakRamMib ? `${r.peakRamMib} MiB` : "—"}</span>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* Full history */}
      <Show when={history().length > 0}>
        <h3>{language.t("settings.fork.benchmark.history")}</h3>
        <div data-slot="settings-table">
          <div data-slot="settings-table-head">
            <span>{language.t("settings.fork.benchmark.modelTime")}</span>
            <span>{language.t("settings.fork.benchmark.backend")}</span>
            <span>{language.t("settings.fork.benchmark.prefill")}</span>
            <span>{language.t("settings.fork.benchmark.decode")}</span>
            <span>{language.t("settings.fork.benchmark.generated")}</span>
          </div>
          <For each={history()}>
            {(r) => (
              <div data-slot="settings-table-row">
                <span title={r.modelFilename}>
                  {r.modelFilename.replace(/\.gguf$/i, "")}
                  <small>{new Date(r.timestamp).toLocaleString()}</small>
                </span>
                <span>{r.backend}</span>
                <span>{r.prefillTps.toFixed(1)}</span>
                <span>{r.decodeTps.toFixed(2)}</span>
                <span>
                  {r.generatedTokens} {language.t("settings.fork.benchmark.tokens")}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={history().length === 0 && !running()}>
        <div data-action="settings-benchmark-empty" data-slot="benchmark-empty">
          {language.t("settings.fork.benchmark.empty")}
        </div>
      </Show>
    </SettingsPage>
  )
}
