import { Config } from "effect"

function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

function falsy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "false" || value === "0"
}

export namespace Flag {
  export const OPENCODE_AUTO_SHARE = truthy("OPENCODE_AUTO_SHARE")
  export const OPENCODE_AUTO_HEAP_SNAPSHOT = truthy("OPENCODE_AUTO_HEAP_SNAPSHOT")
  export const OPENCODE_GIT_BASH_PATH = process.env["OPENCODE_GIT_BASH_PATH"]
  export const OPENCODE_CONFIG = process.env["OPENCODE_CONFIG"]
  export declare const OPENCODE_PURE: boolean
  export declare const OPENCODE_TUI_CONFIG: string | undefined
  export declare const OPENCODE_CONFIG_DIR: string | undefined
  export declare const OPENCODE_PLUGIN_META_FILE: string | undefined
  export const OPENCODE_CONFIG_CONTENT = process.env["OPENCODE_CONFIG_CONTENT"]
  export const OPENCODE_DISABLE_AUTOUPDATE = truthy("OPENCODE_DISABLE_AUTOUPDATE")
  export const OPENCODE_ALWAYS_NOTIFY_UPDATE = truthy("OPENCODE_ALWAYS_NOTIFY_UPDATE")
  export const OPENCODE_DISABLE_PRUNE = truthy("OPENCODE_DISABLE_PRUNE")
  export const OPENCODE_DISABLE_TERMINAL_TITLE = truthy("OPENCODE_DISABLE_TERMINAL_TITLE")
  export const OPENCODE_SHOW_TTFD = truthy("OPENCODE_SHOW_TTFD")
  export const OPENCODE_PERMISSION = process.env["OPENCODE_PERMISSION"]
  export const OPENCODE_DISABLE_DEFAULT_PLUGINS = truthy("OPENCODE_DISABLE_DEFAULT_PLUGINS")
  export const OPENCODE_DISABLE_LSP_DOWNLOAD = truthy("OPENCODE_DISABLE_LSP_DOWNLOAD")
  export const OPENCODE_ENABLE_EXPERIMENTAL_MODELS = truthy("OPENCODE_ENABLE_EXPERIMENTAL_MODELS")
  export const OPENCODE_DISABLE_AUTOCOMPACT = truthy("OPENCODE_DISABLE_AUTOCOMPACT")
  export const OPENCODE_DISABLE_MODELS_FETCH = truthy("OPENCODE_DISABLE_MODELS_FETCH")
  export const OPENCODE_DISABLE_CLAUDE_CODE = truthy("OPENCODE_DISABLE_CLAUDE_CODE")
  export const OPENCODE_DISABLE_CLAUDE_CODE_PROMPT =
    OPENCODE_DISABLE_CLAUDE_CODE || truthy("OPENCODE_DISABLE_CLAUDE_CODE_PROMPT")
  export const OPENCODE_DISABLE_CLAUDE_CODE_SKILLS =
    OPENCODE_DISABLE_CLAUDE_CODE || truthy("OPENCODE_DISABLE_CLAUDE_CODE_SKILLS")
  export const OPENCODE_DISABLE_EXTERNAL_SKILLS =
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS || truthy("OPENCODE_DISABLE_EXTERNAL_SKILLS")
  export declare const OPENCODE_DISABLE_PROJECT_CONFIG: boolean
  export const OPENCODE_FAKE_VCS = process.env["OPENCODE_FAKE_VCS"]
  export declare const OPENCODE_CLIENT: string
  export const OPENCODE_SERVER_PASSWORD = process.env["OPENCODE_SERVER_PASSWORD"]
  export const OPENCODE_SERVER_USERNAME = process.env["OPENCODE_SERVER_USERNAME"]
  export const OPENCODE_ENABLE_QUESTION_TOOL = truthy("OPENCODE_ENABLE_QUESTION_TOOL")

  // Experimental
  export const OPENCODE_EXPERIMENTAL = truthy("OPENCODE_EXPERIMENTAL")
  export const OPENCODE_EXPERIMENTAL_FILEWATCHER = Config.boolean("OPENCODE_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  )
  export const OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER = Config.boolean(
    "OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER",
  ).pipe(Config.withDefault(false))
  export const OPENCODE_EXPERIMENTAL_ICON_DISCOVERY =
    OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_ICON_DISCOVERY")

  const copy = process.env["OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
  export const OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT =
    copy === undefined ? process.platform === "win32" : truthy("OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export const OPENCODE_ENABLE_EXA =
    truthy("OPENCODE_ENABLE_EXA") || OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_EXA")
  export const OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")
  export const OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX")
  export const OPENCODE_EXPERIMENTAL_OXFMT = OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_OXFMT")
  export const OPENCODE_EXPERIMENTAL_LSP_TY = truthy("OPENCODE_EXPERIMENTAL_LSP_TY")
  export const OPENCODE_EXPERIMENTAL_LSP_TOOL = OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_LSP_TOOL")
  export const OPENCODE_DISABLE_FILETIME_CHECK = Config.boolean("OPENCODE_DISABLE_FILETIME_CHECK").pipe(
    Config.withDefault(false),
  )
  // Deferred prompt-cache-after-compaction chantier (plan v3.1). Off by default:
  // flag off must reproduce ProviderTransform's legacy applyCaching() bit-for-bit.
  // Declared here (dynamic getter defined below) so tests can toggle it per-call.
  export declare const OPENCODE_EXPERIMENTAL_PROMPT_CACHE_ANCHORING: boolean
  export const OPENCODE_EXPERIMENTAL_PLAN_MODE = OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_PLAN_MODE")
  export const OPENCODE_EXPERIMENTAL_WORKSPACES = OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_WORKSPACES")
  export const OPENCODE_EXPERIMENTAL_MARKDOWN = !falsy("OPENCODE_EXPERIMENTAL_MARKDOWN")
  export const OPENCODE_MODELS_URL = process.env["OPENCODE_MODELS_URL"]
  export const OPENCODE_MODELS_PATH = process.env["OPENCODE_MODELS_PATH"]
  export const OPENCODE_DISABLE_EMBEDDED_WEB_UI = truthy("OPENCODE_DISABLE_EMBEDDED_WEB_UI")
  export const OPENCODE_DB = process.env["OPENCODE_DB"]
  export const OPENCODE_DISABLE_CHANNEL_DB = truthy("OPENCODE_DISABLE_CHANNEL_DB")
  export const OPENCODE_SKIP_MIGRATIONS = truthy("OPENCODE_SKIP_MIGRATIONS")
  export const OPENCODE_STRICT_CONFIG_DEPS = truthy("OPENCODE_STRICT_CONFIG_DEPS")

  function number(key: string) {
    const value = process.env[key]
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
}


// Unifia compatibility flags: prefer the rebranded environment variable and fall back to OPENCODE during migration.
function unifiaTruthy(name: string, legacy: boolean): boolean { return truthy(`UNIFIA_${name}`) || legacy }
function unifiaValue(name: string, legacy: string | undefined): string | undefined { return process.env[`UNIFIA_${name}`] ?? legacy }

/**
 * Reads a variable that must never fall back to its `OPENCODE_*` spelling.
 *
 * These are the `isolated` class in config/identity.json: ports, credential
 * storage, profile locations, server identity. Accepting the legacy name for
 * them lets an environment set up for one product reach into the other's
 * keychain, port or profile — the exact cross-product leak the coexistence plan
 * exists to prevent. Preferences are a different matter and keep dual-reading
 * through `unifiaValue`.
 *
 * A legacy value that is present but ignored is reported once, because the
 * failure it causes otherwise is silent: the feature simply behaves as if
 * unconfigured.
 */
function isolatedValue(name: string): string | undefined {
  const value = process.env[`UNIFIA_${name}`]
  if (value === undefined && process.env[`OPENCODE_${name}`] !== undefined) {
    console.warn(
      `[flag] ignoring OPENCODE_${name}: this setting is per-product and is only read as UNIFIA_${name}. ` +
        `Whatever set it needs updating.`,
    )
  }
  return value
}
export namespace Flag {
  export const UNIFIA_AUTO_SHARE = unifiaTruthy("AUTO_SHARE", OPENCODE_AUTO_SHARE)
  export const UNIFIA_AUTO_HEAP_SNAPSHOT = unifiaTruthy("AUTO_HEAP_SNAPSHOT", OPENCODE_AUTO_HEAP_SNAPSHOT)
  export const UNIFIA_GIT_BASH_PATH = unifiaValue("GIT_BASH_PATH", OPENCODE_GIT_BASH_PATH)
  export const UNIFIA_CONFIG = unifiaValue("CONFIG", OPENCODE_CONFIG)
  export const UNIFIA_CONFIG_CONTENT = unifiaValue("CONFIG_CONTENT", OPENCODE_CONFIG_CONTENT)
  export const UNIFIA_DISABLE_AUTOUPDATE = unifiaTruthy("DISABLE_AUTOUPDATE", OPENCODE_DISABLE_AUTOUPDATE)
  export const UNIFIA_ALWAYS_NOTIFY_UPDATE = unifiaTruthy("ALWAYS_NOTIFY_UPDATE", OPENCODE_ALWAYS_NOTIFY_UPDATE)
  export const UNIFIA_DISABLE_PRUNE = unifiaTruthy("DISABLE_PRUNE", OPENCODE_DISABLE_PRUNE)
  export const UNIFIA_DISABLE_TERMINAL_TITLE = unifiaTruthy("DISABLE_TERMINAL_TITLE", OPENCODE_DISABLE_TERMINAL_TITLE)
  export const UNIFIA_SHOW_TTFD = unifiaTruthy("SHOW_TTFD", OPENCODE_SHOW_TTFD)
  export const UNIFIA_PERMISSION = unifiaValue("PERMISSION", OPENCODE_PERMISSION)
  export declare const UNIFIA_PURE: boolean
  export declare const UNIFIA_CLIENT: string
  export const UNIFIA_SERVER_PASSWORD = isolatedValue("SERVER_PASSWORD")
  export const UNIFIA_SERVER_USERNAME = isolatedValue("SERVER_USERNAME")
  export const UNIFIA_EXPERIMENTAL = unifiaTruthy("EXPERIMENTAL", OPENCODE_EXPERIMENTAL)
  export const UNIFIA_EXPERIMENTAL_DISABLE_COPY_ON_SELECT = unifiaTruthy("EXPERIMENTAL_DISABLE_COPY_ON_SELECT", OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT)
  export const UNIFIA_EXPERIMENTAL_ICON_DISCOVERY = unifiaTruthy("EXPERIMENTAL_ICON_DISCOVERY", OPENCODE_EXPERIMENTAL_ICON_DISCOVERY)
  export const UNIFIA_EXPERIMENTAL_OUTPUT_TOKEN_MAX = Number(unifiaValue("EXPERIMENTAL_OUTPUT_TOKEN_MAX", OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX?.toString())) || undefined
  export declare const UNIFIA_EXPERIMENTAL_PROMPT_CACHE_ANCHORING: boolean
  export const UNIFIA_EXPERIMENTAL_PLAN_MODE = unifiaTruthy("EXPERIMENTAL_PLAN_MODE", OPENCODE_EXPERIMENTAL_PLAN_MODE)
  export const UNIFIA_EXPERIMENTAL_WORKSPACES = unifiaTruthy("EXPERIMENTAL_WORKSPACES", OPENCODE_EXPERIMENTAL_WORKSPACES)
  export const UNIFIA_EXPERIMENTAL_MARKDOWN = !falsy(unifiaValue("EXPERIMENTAL_MARKDOWN", undefined) ?? "")
  export const UNIFIA_MODELS_URL = unifiaValue("MODELS_URL", OPENCODE_MODELS_URL)
  export const UNIFIA_MODELS_PATH = unifiaValue("MODELS_PATH", OPENCODE_MODELS_PATH)
  export const UNIFIA_DISABLE_MODELS_FETCH = unifiaTruthy("DISABLE_MODELS_FETCH", OPENCODE_DISABLE_MODELS_FETCH)
  export const UNIFIA_DISABLE_EMBEDDED_WEB_UI = unifiaTruthy("DISABLE_EMBEDDED_WEB_UI", OPENCODE_DISABLE_EMBEDDED_WEB_UI)
  export declare const UNIFIA_DISABLE_PROJECT_CONFIG: boolean
  export declare const UNIFIA_CONFIG_DIR: string | undefined
  export declare const UNIFIA_TUI_CONFIG: string | undefined
  export declare const UNIFIA_PLUGIN_META_FILE: string | undefined
  export const UNIFIA_DISABLE_AUTOCOMPACT = unifiaTruthy("DISABLE_AUTOCOMPACT", OPENCODE_DISABLE_AUTOCOMPACT)
  export const UNIFIA_DISABLE_CLAUDE_CODE_PROMPT = unifiaTruthy("DISABLE_CLAUDE_CODE_PROMPT", OPENCODE_DISABLE_CLAUDE_CODE_PROMPT)
  export const UNIFIA_ENABLE_EXPERIMENTAL_MODELS = unifiaTruthy("ENABLE_EXPERIMENTAL_MODELS", OPENCODE_ENABLE_EXPERIMENTAL_MODELS)
  export const UNIFIA_FAKE_VCS = unifiaValue("FAKE_VCS", OPENCODE_FAKE_VCS)

  // These four were read straight from process.env at their call sites, which
  // meant the rebranded name was silently ignored there: setting UNIFIA_CALLER
  // did nothing because the caller looked only at OPENCODE_CALLER. Routing them
  // through the shim is what makes the rebranded name actually work.
  export const UNIFIA_CALLER = unifiaValue("CALLER", process.env["OPENCODE_CALLER"])
  export const UNIFIA_DISABLE_SHARE = unifiaTruthy("DISABLE_SHARE", truthy("OPENCODE_DISABLE_SHARE"))
  export const UNIFIA_CARGO_PROXY = unifiaTruthy("CARGO_PROXY", truthy("OPENCODE_CARGO_PROXY"))
  export const UNIFIA_CARGO_PROXY_URL = unifiaValue("CARGO_PROXY_URL", process.env["OPENCODE_CARGO_PROXY_URL"])

  /**
   * Credential storage backend.
   *
   * WHY this is here rather than read at the call site: `auth/index.ts` read
   * `process.env.UNIFIA_AUTH_STORAGE` directly, while the desktop and mobile
   * shells both emit `OPENCODE_AUTH_STORAGE`. The rebrand had moved the reader
   * to the new name and left the writers on the old one, so neither value ever
   * arrived and the backend silently fell back to plaintext `auth.json` — on a
   * device this was verified by reading the file, which began with `{`.
   */
  export const UNIFIA_AUTH_STORAGE = isolatedValue("AUTH_STORAGE")
  export const UNIFIA_PTY_PORT = isolatedValue("PTY_PORT")
  // Read here rather than at the call site for the reason the comment above
  // gives: auth/index.ts reached for process.env directly, so when the shell
  // still emitted the OPENCODE_* spelling the endpoint never arrived and the
  // keychain silently reported itself unavailable.
  //
  // Declared, not assigned: the getters below read at access time. KeychainStorage
  // used to read process.env in its constructor, and the desktop shell injects
  // the endpoint at sidecar spawn, so a value captured at module load would be a
  // behaviour change — one that tests setting the endpoint after import notice
  // immediately.
  export declare const UNIFIA_KEYCHAIN_URL: string | undefined
  export declare const UNIFIA_KEYCHAIN_TOKEN: string | undefined
  export const UNIFIA_DISABLE_LSP_DOWNLOAD = unifiaTruthy("DISABLE_LSP_DOWNLOAD", OPENCODE_DISABLE_LSP_DOWNLOAD)
}
// Dynamic getter for OPENCODE_DISABLE_PROJECT_CONFIG
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "OPENCODE_DISABLE_PROJECT_CONFIG", {
  get() {
    return truthy("OPENCODE_DISABLE_PROJECT_CONFIG")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for OPENCODE_TUI_CONFIG
// This must be evaluated at access time, not module load time,
// because tests and external tooling may set this env var at runtime
Object.defineProperty(Flag, "OPENCODE_TUI_CONFIG", {
  get() {
    return process.env["OPENCODE_TUI_CONFIG"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for OPENCODE_CONFIG_DIR
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "OPENCODE_CONFIG_DIR", {
  get() {
    return process.env["OPENCODE_CONFIG_DIR"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for OPENCODE_PURE
// This must be evaluated at access time, not module load time,
// because the CLI can set this flag at runtime
Object.defineProperty(Flag, "OPENCODE_PURE", {
  get() {
    return truthy("OPENCODE_PURE")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for OPENCODE_PLUGIN_META_FILE
// This must be evaluated at access time, not module load time,
// because tests and external tooling may set this env var at runtime
Object.defineProperty(Flag, "OPENCODE_PLUGIN_META_FILE", {
  get() {
    return process.env["OPENCODE_PLUGIN_META_FILE"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for OPENCODE_CLIENT
// This must be evaluated at access time, not module load time,
// because some commands override the client at runtime
Object.defineProperty(Flag, "OPENCODE_CLIENT", {
  get() {
    return process.env["OPENCODE_CLIENT"] ?? "cli"
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for OPENCODE_EXPERIMENTAL_PROMPT_CACHE_ANCHORING
// This must be evaluated at access time, not module load time, so tests can
// exercise the flag-on path without needing a fresh process (bun test shares
// one module registry — and therefore one process.env — across test files).
Object.defineProperty(Flag, "OPENCODE_EXPERIMENTAL_PROMPT_CACHE_ANCHORING", {
  get() {
    return truthy("OPENCODE_EXPERIMENTAL_PROMPT_CACHE_ANCHORING")
  },
  enumerable: true,
  configurable: false,
})

// Access-time getters.
//
// Every OPENCODE_* name in this group already had one, for the reason the
// comments above give: tests and external tooling set these after the module has
// loaded. The rebrand re-exposed them as `const UNIFIA_X = ...`, which reads
// once at import and freezes whatever the environment happened to be — that is
// what left eight config and tui tests failing, and it would equally ignore an
// endpoint the desktop shell injects at sidecar spawn.
function defineDynamic(name: string, read: () => unknown) {
  Object.defineProperty(Flag, name, { get: read, enumerable: true, configurable: false })
}

// Isolated class: the OPENCODE_* spelling must not satisfy these.
defineDynamic("UNIFIA_KEYCHAIN_URL", () => isolatedValue("KEYCHAIN_URL"))
defineDynamic("UNIFIA_KEYCHAIN_TOKEN", () => isolatedValue("KEYCHAIN_TOKEN"))
defineDynamic("UNIFIA_CONFIG_DIR", () => isolatedValue("CONFIG_DIR"))
defineDynamic("UNIFIA_CLIENT", () => isolatedValue("CLIENT") ?? "cli")

// Preferences: these keep reading the legacy spelling as a fallback.
defineDynamic("UNIFIA_PURE", () => truthy("UNIFIA_PURE") || Flag.OPENCODE_PURE)
defineDynamic("UNIFIA_TUI_CONFIG", () => process.env["UNIFIA_TUI_CONFIG"] ?? Flag.OPENCODE_TUI_CONFIG)
defineDynamic("UNIFIA_PLUGIN_META_FILE", () => process.env["UNIFIA_PLUGIN_META_FILE"] ?? Flag.OPENCODE_PLUGIN_META_FILE)
defineDynamic(
  "UNIFIA_DISABLE_PROJECT_CONFIG",
  () => truthy("UNIFIA_DISABLE_PROJECT_CONFIG") || Flag.OPENCODE_DISABLE_PROJECT_CONFIG,
)
defineDynamic("UNIFIA_EXPERIMENTAL_PROMPT_CACHE_ANCHORING", () =>
  truthy("UNIFIA_EXPERIMENTAL_PROMPT_CACHE_ANCHORING"),
)
