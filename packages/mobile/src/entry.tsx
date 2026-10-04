/* @refresh reload */
import { createSignal, Show, Switch, Match, onMount, onCleanup } from "solid-js"
import { render } from "solid-js/web"
import { invoke } from "@tauri-apps/api/core"
import { getCurrent as getCurrentDeepLink, onOpenUrl } from "@tauri-apps/plugin-deep-link"
import {
  AppProviders,
  PlatformProvider,
  ServerConnection,
  checkServerReachable,
  normalizeServerUrl,
} from "@unifia/app"
import "@unifia/app/index.css"
import "./mobile.css"
import { mobileStartupMode } from "./startup"
import { ExtractionProgress } from "./components/extraction-progress"
import { ModelManager } from "./components/model-manager"
import { createPlatform, setPrivateServerFp } from "./platform"
import { ensureLocalLLMLoaded } from "./hooks/use-auto-start-llm"
import { initSpeechListeners, cleanupSpeechListeners } from "./hooks/use-speech"
import { MobileConnectionEffects } from "./connection-effects"
import { EmbeddedRuntimeGuardian } from "./embedded-runtime-guardian"
import { parsePairingLink } from "./pairing-link"
import { MobilePairingDialog } from "./pairing-dialog"

const root = document.getElementById("root")

// unifia://open?file=<path>&project=<dir>
// Dispatches `ide-open-file` CustomEvent so the IDE panel can navigate.
// Returns true if the URL was recognized and handled.
function applyOpenDeepLink(raw: string): boolean {
  let parsed: URL
  try { parsed = new URL(raw) } catch { return false }
  if (parsed.protocol !== "unifia:") return false
  const command = parsed.hostname || parsed.pathname.replace(/^\/+/, "")
  if (command !== "open") return false

  const file = parsed.searchParams.get("file")
  const project = parsed.searchParams.get("project")
  if (!file && !project) return false

  window.dispatchEvent(
    new CustomEvent("ide-open-file", {
      detail: {
        file: file ? decodeURIComponent(file) : undefined,
        project: project ? decodeURIComponent(project) : undefined,
      },
    }),
  )
  return true
}

// unifia://session?id=<sessionId>
// Dispatches `navigate-to-session` CustomEvent so the app can jump to a session.
// Returns true if the URL was recognized and handled.
function applySessionDeepLink(raw: string): boolean {
  let parsed: URL
  try { parsed = new URL(raw) } catch { return false }
  if (parsed.protocol !== "unifia:") return false
  const command = parsed.hostname || parsed.pathname.replace(/^\/+/, "")
  if (command !== "session") return false

  const id = parsed.searchParams.get("id")
  if (!id || id.length > 256) return false

  window.dispatchEvent(new CustomEvent("navigate-to-session", { detail: { sessionId: id } }))
  return true
}

// Build marker — visible in chrome://inspect console + logcat (debuggable build).
// The date is baked at COMPILE time so it identifies which dist is running.
const BUILD_STAMP = "__BUILD_2026_07_01_P8__"
console.warn(`[BOOT] frontend=${BUILD_STAMP}`)

// Hide the static loading indicator
const loadingEl = document.getElementById("loading")
if (loadingEl) loadingEl.style.display = "none"

type Mode = "booting" | "error" | "extracting" | "connecting" | "remote-prompt" | "ready"

interface ServerInfo {
  url: string
  username?: string
  password?: string
  variant: "embedded" | "http"
}

function App() {
  const [mode, setMode] = createSignal<Mode>("booting")
  const [error, setError] = createSignal("")
  const [serverInfo, setServerInfo] = createSignal<ServerInfo | null>(null)
  const [platform, setPlatform] = createSignal<Awaited<ReturnType<typeof createPlatform>> | null>(null)
  const [remoteUrl, setRemoteUrl] = createSignal("")
  const [remoteUsername, setRemoteUsername] = createSignal("unifia")
  const [remotePassword, setRemotePassword] = createSignal("")
  const [remoteChecking, setRemoteChecking] = createSignal(false)
  const [connectStatus, setConnectStatus] = createSignal("Starting local server...")
  const [showModelManager, setShowModelManager] = createSignal(false)
  const [modelConnection, setModelConnection] = createSignal<ServerConnection.Any>()
  const [pendingPairing, setPendingPairing] = createSignal<ServerConnection.HttpBase | null>(null)

  // Lazy-init platform
  async function ensurePlatform() {
    let p = platform()
    if (!p) {
      p = await createPlatform()
      setPlatform(p)
    }
    return p
  }

  onMount(() => {
    void ensurePlatform().then((p) => {
      // Android always starts locally; saved remote servers remain in Device.
      if (mode() === "booting") setMode(mobileStartupMode(p.os))
    }).catch((err) => {
      setError(err instanceof Error ? err.message : String(err))
      setMode("error")
    })
  })

  // Handle local mode: extract → connect
  async function handleLocalConnect() {
    setMode("connecting")
    setConnectStatus("Starting local server...")
    try {
      const p = await ensurePlatform()
      const result = await p.startLocalServer?.()
      if (result) {
        setServerInfo({
          url: result.url,
          username: result.username,
          password: result.password,
          variant: "embedded",
        })
        setMode("ready")
      } else {
        setError("Server started but health check timed out after 30s.")
        setMode("error")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setMode("error")
    }
  }

  // Handle remote mode: prompt for URL
  function handleRemotePrompt() {
    setMode("remote-prompt")
  }

  async function handleRemoteConnect() {
    const url = remoteUrl().trim()
    if (!url) return
    // WHY the shared helper rather than the same two lines inline: this was a
    // verbatim copy of normalizeServerUrl, and its trailing-slash trim carried
    // the quadratic regex CodeQL reported on the desktop path (js/polynomial-redos).
    // One owner means the next fix does not have to be found twice.
    const normalized = normalizeServerUrl(url)
    if (!normalized) return
    const p = await ensurePlatform()
    const username = remoteUsername().trim() || undefined
    const password = remotePassword() || undefined
    setError("")
    setRemoteChecking(true)
    const check = await checkServerReachable(p, normalized, username, password)
    setRemoteChecking(false)
    if (!check.ok) {
      setError(check.message)
      return
    }
    await p.setDefaultServer?.(normalized as any)
    setServerInfo({ url: normalized, variant: "http", username, password })
    setMode("ready")
  }

  function applyPairingDeepLink(raw: string): boolean {
    const pairing = parsePairingLink(raw)
    if (!pairing) return false
    setPrivateServerFp(pairing.fingerprint)
    setPendingPairing(pairing.http)
    // Keep Android's local bootstrap running; the existing form opens once ready.
    setRemoteUrl(pairing.http.url)
    setRemoteUsername(pairing.http.username)
    setRemotePassword(pairing.http.password)
    return true
  }

  onMount(() => {
    // A.4-part1: pause/resume detection via visibilitychange.
    // On background: notify Rust (placeholder for foreground-service keepalive).
    // On resume: health-check and emit reload event if server died.
    let wasHidden = false
    const visibilityHandler = async () => {
      if (document.hidden) {
        wasHidden = true
        try { await invoke("llm_idle_tick") } catch {}
      } else if (wasHidden) {
        wasHidden = false
        try {
          const ok = await invoke<boolean>("check_llm_health", { port: null })
          if (!ok) {
            window.dispatchEvent(new CustomEvent("llm-needs-reload"))
          }
        } catch {}
      }
    }
    document.addEventListener("visibilitychange", visibilityHandler)
    onCleanup(() => document.removeEventListener("visibilitychange", visibilityHandler))
  })

  onMount(() => {
    // Keyboard-aware viewport: expose `--vvh` (visual viewport height) as
    // a CSS custom property so `#root` never exceeds the actually-visible
    // area when the Android softkeyboard is open. Chromium WebView's `dvh`
    // unit is unreliable on MIUI (doesn't always update on IME toggle, or
    // updates with lag when the user refocuses an input), which leaves
    // flex children at the bottom of the root — like the TerminalPanel —
    // partially or fully hidden under the keyboard. `visualViewport` is
    // the authoritative source and fires `resize` reliably on all touch
    // flows we care about.
    //
    // `--vv-top` (visualViewport.offsetTop) is exposed for the same reason:
    // on this WebView the visible viewport can shift down relative to the
    // layout viewport (confirmed on-device: offsetTop reaching 127px while
    // focusing the terminal's hidden IME textarea) without #root moving
    // with it — height alone shrinks correctly, but #root stays anchored
    // at the old top, pushing its top content off-screen above the visible
    // area and leaving a gap of exactly `offsetTop` px above the keyboard.
    // #root's `transform` (mobile.css) reads this to track the shift.
    if (typeof window === "undefined") return
    const vp = window.visualViewport
    const sync = () => {
      const h = vp?.height ?? window.innerHeight
      const top = vp?.offsetTop ?? 0
      document.documentElement.style.setProperty("--vvh", `${h}px`)
      document.documentElement.style.setProperty("--vv-top", `${top}px`)
    }
    sync()
    if (vp) {
      vp.addEventListener("resize", sync)
      vp.addEventListener("scroll", sync)
    }
    window.addEventListener("resize", sync)
    onCleanup(() => {
      if (vp) {
        vp.removeEventListener("resize", sync)
        vp.removeEventListener("scroll", sync)
      }
      window.removeEventListener("resize", sync)
    })
  })

  onMount(() => {
    // Try handlers in priority order; stop at the first recognized command.
    function handleDeepLink(url: string) {
      if (applyPairingDeepLink(url)) return
      if (applyOpenDeepLink(url)) return
      applySessionDeepLink(url)
    }

    // Cold-start: the app may have been launched *by* a deep link intent.
    void getCurrentDeepLink()
      .then((urls) => {
        if (!urls) return
        for (const u of urls) { handleDeepLink(u); break }
      })
      .catch(() => undefined)

    // Warm-start: the app was already running when the intent fired.
    let unlisten: (() => void) | undefined
    void onOpenUrl((urls) => {
      for (const u of urls) { handleDeepLink(u); break }
    })
      .then((fn) => { unlisten = fn })
      .catch(() => undefined)
    onCleanup(() => unlisten?.())
  })

  return (
    <>
    <Show when={showModelManager()}>
      <ModelManager
        onClose={() => setShowModelManager(false)}
        serverUrl={modelConnection()?.http.url}
        serverAuth={modelConnection()?.http.username ? { username: modelConnection()!.http.username!, password: modelConnection()!.http.password! } : undefined}
      />
    </Show>
    <Switch>
      <Match when={mode() === "error"}>
        <div class="h-dvh flex flex-col items-center justify-center gap-4 bg-background-base text-text-base p-6">
          <h1>Unable to start the local runtime</h1>
          <button onClick={() => { setError(""); setMode("extracting") }}>Retry local startup</button>
          <button onClick={handleRemotePrompt}>Connect to a server</button>
        </div>
        <Show when={error()}>
          <div style={{
            position: "fixed", bottom: "24px", left: "24px", right: "24px",
            padding: "12px 16px", "border-radius": "8px",
            background: "#7f1d1d", color: "#fca5a5", "font-size": "14px",
            "text-align": "center",
          }}>
            {error()}
          </div>
        </Show>
      </Match>

      <Match when={mode() === "extracting"}>
        <ExtractionProgress
          onComplete={() => handleLocalConnect()}
          onError={(msg) => { setError(msg); setMode("error") }}
        />
      </Match>

      <Match when={mode() === "booting" || mode() === "connecting"}>
        <div style={{
          display: "flex", "flex-direction": "column", "align-items": "center",
          "justify-content": "center", height: "100vh", gap: "16px",
          background: "#0a0a0a", color: "#e5e5e5",
          "font-family": "system-ui, -apple-system, sans-serif",
        }}>
          <div style={{ "font-size": "18px", "font-weight": "600" }}>{connectStatus()}</div>
          <div style={{ color: "#888", "font-size": "14px" }}>Waiting for health check...</div>
          {/* Simple spinner */}
          <div style={{
            width: "32px", height: "32px", border: "3px solid #333",
            "border-top-color": "#3b82f6", "border-radius": "50%",
            animation: "spin 1s linear infinite",
          }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      </Match>

      <Match when={mode() === "remote-prompt"}>
        <div style={{
          display: "flex", "flex-direction": "column", "align-items": "center",
          "justify-content": "center", height: "100vh", padding: "24px", gap: "24px",
          background: "#0a0a0a", color: "#e5e5e5",
          "font-family": "system-ui, -apple-system, sans-serif",
        }}>
          <h1 style={{ "font-size": "24px", "font-weight": "700", margin: "0" }}>
            Connect to Server
          </h1>
          <p style={{ color: "#888", "font-size": "14px", margin: "0", "text-align": "center", "max-width": "320px" }}>
            Enter the URL of your Unifia server running on your PC
          </p>
          <input
            type="url"
            placeholder="192.168.1.100:3000"
            value={remoteUrl()}
            onInput={(e) => setRemoteUrl(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && handleRemoteConnect()}
            style={{
              width: "100%", "max-width": "320px", padding: "14px 16px",
              "border-radius": "10px", border: "1px solid #333",
              background: "#1a1a1a", color: "#e5e5e5", "font-size": "16px",
              outline: "none",
            }}
          />
          <input
            type="text"
            autocapitalize="none"
            autocomplete="username"
            placeholder="Username"
            value={remoteUsername()}
            onInput={(e) => setRemoteUsername(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && handleRemoteConnect()}
            style={{
              width: "100%", "max-width": "320px", padding: "14px 16px",
              "border-radius": "10px", border: "1px solid #333",
              background: "#1a1a1a", color: "#e5e5e5", "font-size": "16px",
              outline: "none",
            }}
          />
          <input
            type="password"
            autocapitalize="none"
            autocomplete="current-password"
            placeholder="Password"
            value={remotePassword()}
            onInput={(e) => setRemotePassword(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && handleRemoteConnect()}
            style={{
              width: "100%", "max-width": "320px", padding: "14px 16px",
              "border-radius": "10px", border: "1px solid #333",
              background: "#1a1a1a", color: "#e5e5e5", "font-size": "16px",
              outline: "none",
            }}
          />
          <Show when={error()}>
            <div style={{
              width: "100%", "max-width": "320px",
              padding: "10px 14px", "border-radius": "8px",
              background: "#7f1d1d", color: "#fca5a5",
              "font-size": "14px", "text-align": "center",
            }}>
              {error()}
            </div>
          </Show>
          <div style={{ display: "flex", gap: "12px", width: "100%", "max-width": "320px" }}>
            <button
              onClick={() => setMode(platform()?.os === "android" ? "extracting" : "remote-prompt")}
              disabled={remoteChecking()}
              style={{
                flex: "1", padding: "14px", "border-radius": "10px",
                border: "1px solid #333", background: "#1a1a1a",
                color: "#888", "font-size": "15px", cursor: remoteChecking() ? "not-allowed" : "pointer",
                opacity: remoteChecking() ? "0.5" : "1",
              }}
            >
              Back
            </button>
            <button
              onClick={handleRemoteConnect}
              disabled={remoteChecking()}
              style={{
                flex: "1", padding: "14px", "border-radius": "10px",
                border: "1px solid #3b82f6", background: "#1e3a5f",
                color: "#e5e5e5", "font-size": "15px", cursor: remoteChecking() ? "wait" : "pointer",
                "font-weight": "600",
                opacity: remoteChecking() ? "0.7" : "1",
              }}
            >
              {remoteChecking() ? "Connecting..." : "Connect"}
            </button>
          </div>
        </div>
      </Match>

      <Match when={mode() === "ready" && serverInfo() && platform()}>
        <FullApp
          platform={platform()!}
          serverInfo={serverInfo()!}
          onOpenModelManager={(connection) => { setModelConnection(connection); setShowModelManager(true) }}
          pendingPairing={pendingPairing()}
          onPairingConsumed={() => setPendingPairing(null)}
        />
      </Match>
    </Switch>
    </>
  )
}

interface LLMLoadingState {
  loading: boolean
  elapsed_secs?: number
  max_secs?: number
  filename?: string
}

function FullApp(props: {
  platform: Awaited<ReturnType<typeof createPlatform>>;
  serverInfo: ServerInfo;
  onOpenModelManager?: (connection: ServerConnection.Any) => void;
  pendingPairing: ServerConnection.HttpBase | null;
  onPairingConsumed: () => void;
}) {
  const [llmLoading, setLlmLoading] = createSignal<LLMLoadingState>({ loading: false })
  const [noModelBanner, setNoModelBanner] = createSignal(false)
  const [blockedModelBanner, setBlockedModelBanner] = createSignal<string | null>(null)
  const [activeConnection, setActiveConnection] = createSignal<ServerConnection.Any>()
  const openModelManager = () => {
    const connection = activeConnection()
    if (connection) props.onOpenModelManager?.(connection)
  }

  // Listen for "open-model-manager" custom event from the model selector
  onMount(() => {
    const handler = openModelManager
    window.addEventListener("open-model-manager", handler)
    onCleanup(() => window.removeEventListener("open-model-manager", handler))
  })

  // Track model loading progress to show a status banner
  onMount(() => {
    const handler = (e: CustomEvent<LLMLoadingState>) => setLlmLoading(e.detail)
    window.addEventListener("llm-loading-progress" as any, handler as any)
    onCleanup(() => window.removeEventListener("llm-loading-progress" as any, handler as any))
  })

  // Show onboarding banner when local-llm is selected but no model is installed
  onMount(() => {
    const handler = () => setNoModelBanner(true)
    window.addEventListener("no-model-found" as any, handler as any)
    onCleanup(() => window.removeEventListener("no-model-found" as any, handler as any))
  })

  // Circuit breaker (use-auto-start-llm.ts) gave up auto-retrying a model
  // that OOM-crashed the app twice in a row — surface it instead of
  // silently looping forever.
  onMount(() => {
    const handler = (e: CustomEvent<{ filename: string }>) => setBlockedModelBanner(e.detail.filename)
    window.addEventListener("llm-load-blocked" as any, handler as any)
    onCleanup(() => window.removeEventListener("llm-load-blocked" as any, handler as any))
  })

  // Auto-start local LLM when model is selected
  onMount(() => {
    const handler = (e: CustomEvent) => {
      const { providerID, modelID } = e.detail ?? {}
      const connection = activeConnection()
      if (connection?.type !== "sidecar" || connection.variant !== "embedded") return
      ensureLocalLLMLoaded(providerID, modelID)
    }
    window.addEventListener("model-selected" as any, handler as any)
    onCleanup(() => window.removeEventListener("model-selected" as any, handler as any))
  })

  // Wire STT/TTS listeners — mic button dispatches `stt-start`/`stt-stop`,
  // copy button dispatches `tts-toggle`. See packages/app/src/components/
  // prompt-input.tsx for the UI side.
  onMount(() => {
    initSpeechListeners()
    onCleanup(cleanupSpeechListeners)
  })

  // Notify the user when the local model finishes loading while backgrounded.
  onMount(() => {
    let wasLoading = false
    const handler = (e: CustomEvent<LLMLoadingState>) => {
      const { loading, filename } = e.detail
      if (loading) {
        wasLoading = true
      } else if (wasLoading && filename) {
        wasLoading = false
        void props.platform.notify?.("Model Ready", `${filename} loaded and ready.`)
      }
    }
    window.addEventListener("llm-loading-progress" as any, handler as any)
    onCleanup(() => window.removeEventListener("llm-loading-progress" as any, handler as any))
  })

  const connection = (): ServerConnection.Any => {
    if (props.serverInfo.variant === "embedded") {
      return {
        type: "sidecar",
        variant: "embedded",
        http: {
          url: props.serverInfo.url,
          username: props.serverInfo.username,
          password: props.serverInfo.password,
        },
      }
    }
    return {
      type: "http",
      http: {
        url: props.serverInfo.url,
        username: props.serverInfo.username,
        password: props.serverInfo.password,
      },
    }
  }

  const defaultKey = () => ServerConnection.key(connection())
  const servers = () => [connection()]

  return (
    <PlatformProvider value={props.platform}>
      <EmbeddedRuntimeGuardian platform={props.platform} connection={connection()} />
      <AppProviders
        defaultServer={defaultKey()}
        servers={servers()}
      >
        <MobileConnectionEffects onConnection={setActiveConnection} />
        <MobilePairingDialog pairing={props.pendingPairing} onConsumed={props.onPairingConsumed} />
        <Show when={llmLoading().loading}>
          <div style={{
            position: "fixed", bottom: "0", left: "0", right: "0",
            padding: "10px 16px",
            background: "rgba(15, 23, 42, 0.95)",
            "border-top": "1px solid #1e3a5f",
            display: "flex", "align-items": "center", gap: "10px",
            "z-index": "9999",
            "font-family": "system-ui, -apple-system, sans-serif",
          }}>
            <div style={{
              width: "14px", height: "14px", "border": "2px solid #334155",
              "border-top-color": "#3b82f6", "border-radius": "50%",
              animation: "spin 1s linear infinite", "flex-shrink": "0",
            }} />
            <span style={{ color: "#94a3b8", "font-size": "13px" }}>
              Loading model
              {llmLoading().filename ? ` ${llmLoading().filename}` : ""}
              {llmLoading().elapsed_secs ? `… ${llmLoading().elapsed_secs}s` : "…"}
            </span>
          </div>
        </Show>
        <Show when={noModelBanner()}>
          <div style={{
            position: "fixed", bottom: "0", left: "0", right: "0",
            padding: "14px 16px",
            background: "rgba(15, 23, 42, 0.97)",
            "border-top": "1px solid #334155",
            display: "flex", "align-items": "center", "justify-content": "space-between",
            gap: "12px", "z-index": "9999",
            "font-family": "system-ui, -apple-system, sans-serif",
          }}>
            <span style={{ color: "#94a3b8", "font-size": "13px", flex: "1" }}>
              No local model installed. Download one to use on-device AI.
            </span>
            <button
              onClick={() => { setNoModelBanner(false); openModelManager() }}
              style={{
                padding: "8px 14px", "border-radius": "8px",
                border: "1px solid #3b82f6", background: "#1e3a5f",
                color: "#e5e5e5", "font-size": "13px", cursor: "pointer",
                "white-space": "nowrap", "flex-shrink": "0",
              }}
            >
              Add model
            </button>
            <button
              onClick={() => setNoModelBanner(false)}
              style={{
                padding: "8px", "border-radius": "6px",
                border: "none", background: "transparent",
                color: "#64748b", "font-size": "16px", cursor: "pointer",
                "flex-shrink": "0", "line-height": "1",
              }}
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </Show>
        <Show when={blockedModelBanner()}>
          <div style={{
            position: "fixed", bottom: "0", left: "0", right: "0",
            padding: "14px 16px",
            background: "rgba(15, 23, 42, 0.97)",
            "border-top": "1px solid #7f1d1d",
            display: "flex", "align-items": "center", "justify-content": "space-between",
            gap: "12px", "z-index": "9999",
            "font-family": "system-ui, -apple-system, sans-serif",
          }}>
            <span style={{ color: "#94a3b8", "font-size": "13px", flex: "1" }}>
              {blockedModelBanner()} crashed the app repeatedly while loading — likely not enough free RAM. Try a smaller model.
            </span>
            <button
              onClick={() => { setBlockedModelBanner(null); openModelManager() }}
              style={{
                padding: "8px 14px", "border-radius": "8px",
                border: "1px solid #ef4444", background: "#3f1414",
                color: "#e5e5e5", "font-size": "13px", cursor: "pointer",
                "white-space": "nowrap", "flex-shrink": "0",
              }}
            >
              Choose another model
            </button>
            <button
              onClick={() => setBlockedModelBanner(null)}
              style={{
                padding: "8px", "border-radius": "6px",
                border: "none", background: "transparent",
                color: "#64748b", "font-size": "16px", cursor: "pointer",
                "flex-shrink": "0", "line-height": "1",
              }}
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </Show>
      </AppProviders>
    </PlatformProvider>
  )
}

render(() => <App />, root!)
