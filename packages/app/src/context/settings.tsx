import { createStore, reconcile } from "solid-js/store"
import { createEffect, createMemo } from "solid-js"
import { createSimpleContext } from "@unifia/ui/context"
import { persisted } from "@/utils/persist"
import {
  OBSERVABILITY_PRESETS,
  type ObservabilityDomain,
  type ObservabilityPreset,
} from "@unifia/ui/chat-observability"

export interface NotificationSettings {
  agent: boolean
  permissions: boolean
  errors: boolean
}

export interface SoundSettings {
  agentEnabled: boolean
  agent: string
  permissionsEnabled: boolean
  permissions: string
  errorsEnabled: boolean
  errors: string
}

export interface Settings {
  general: {
    // FORK: ADR-0005 + PLAN-EDITEUR-IDE-DEFINITIF Phase 3.1 — split `autoSave`
    // (legacy: boolean, semantics = "format on save") into two independent
    // booleans: `autoSave` (autosave with debounce, Phase 3.2) and
    // `formatOnSave` (format on every save). Migration at load:
    //   legacy { autoSave: true } → { autoSave: false, formatOnSave: true }
    // New defaults: both off — users opt in.
    autoSave: boolean
    formatOnSave: boolean
    releaseNotes: boolean
    followup: "queue" | "steer"
    showReasoningSummaries: boolean
    shellToolPartsExpanded: boolean
    editToolPartsExpanded: boolean
    /**
     * v110 Motion contract (INTERACTIONS.md): user-level animations
     * toggle. Persisted, default on (maquette General > Animations);
     * applied to <html data-ui-animations="on|off">.
     */
    uiAnimations: boolean
    /** ADR-046: what the chat shows. Reasoning lives in showReasoningSummaries. */
    observability: {
      preset: ObservabilityPreset
      domains: Partial<Record<ObservabilityDomain, boolean>>
    }
    // FORK: ADR-0005 dual-mode Agent ⇄ IDE
    viewMode: "agent" | "ide"
  }
  updates: {
    startup: boolean
  }
  appearance: {
    fontSize: number
    mono: string
    sans: string
    /**
     * ADR-048: user-selectable accent color. The empty string is the sentinel
     * that means "follow the maquette seed" — when set, a `createEffect` in
     * the provider writes `--accent` on `<html>` (and removes it for the
     * sentinel so the v110-chat.css / v110.css fallbacks take over).
     */
    accent: string
  }
  keybinds: Record<string, string>
  permissions: {
    autoApprove: boolean
  }
  notifications: NotificationSettings
  sounds: SoundSettings
}

export const monoDefault = "System Mono"
export const sansDefault = "System Sans"

// Must match styles/unifia-brand.css's --font-family-mono/--font-family-sans:
// this effect (below) always writes these as an inline style on <html>,
// which wins over any CSS-level value regardless of layers or specificity,
// so the brand stack has to live here too, not only in the stylesheet.
// A previous mismatch (this file held the generic system-font stack while
// the stylesheet held the brand stack) meant the CSS side was silently dead
// and the whole app rendered in the browser's default UI font.
const monoFallback = 'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace'
const sansFallback = 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

const monoBase = monoFallback
const sansBase = sansFallback

function input(font: string | undefined) {
  return font ?? ""
}

function family(font: string) {
  if (/^[\w-]+$/.test(font)) return font
  return `"${font.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
}

function stack(font: string | undefined, base: string) {
  const value = font?.trim() ?? ""
  if (!value) return base
  return `${family(value)}, ${base}`
}

export function monoInput(font: string | undefined) {
  return input(font)
}

export function sansInput(font: string | undefined) {
  return input(font)
}

export function monoFontFamily(font: string | undefined) {
  return stack(font, monoBase)
}

export function sansFontFamily(font: string | undefined) {
  return stack(font, sansBase)
}

const defaultSettings: Settings = {
  general: {
    autoSave: false,
    formatOnSave: false,
    releaseNotes: true,
    followup: "steer",
    showReasoningSummaries: false,
    shellToolPartsExpanded: false,
    editToolPartsExpanded: false,
    uiAnimations: true,
    observability: { preset: "balanced", domains: {} },
    viewMode: "agent" as "agent" | "ide",
  },
  updates: {
    startup: true,
  },
  appearance: {
    fontSize: 14,
    mono: "",
    sans: "",
    accent: "",
  },
  keybinds: {},
  permissions: {
    autoApprove: false,
  },
  notifications: {
    agent: true,
    permissions: true,
    errors: false,
  },
  sounds: {
    agentEnabled: true,
    agent: "staplebops-01",
    permissionsEnabled: true,
    permissions: "staplebops-02",
    errorsEnabled: true,
    errors: "nope-03",
  },
}

function withFallback<T>(read: () => T | undefined, fallback: T) {
  return createMemo(() => read() ?? fallback)
}

// FORK (Phase 3.1): migrate legacy settings where `autoSave: true` meant
// "format on save" — that semantic moves to `formatOnSave: true`. The new
// `autoSave` (debounced autosave) defaults to false; existing users with
// `autoSave: false` already had no autosave, no change.
//
// Pure function — exported for the migration test (settings.migration.test.ts).
// Idempotent: running twice yields the same result.
export function migrateAutoSave(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw
  const obj = raw as Record<string, unknown>
  const general = obj.general
  if (typeof general !== "object" || general === null) return raw
  const g = general as Record<string, unknown>
  // Already migrated (or fresh install): `formatOnSave` is present.
  // Leave untouched — preserves any user override of `autoSave`.
  if ("formatOnSave" in g) return raw
  // Legacy: `autoSave: true` ⇒ re-interpreted as "format on save".
  if (g.autoSave === true) {
    return {
      ...obj,
      general: { ...g, autoSave: false, formatOnSave: true },
    }
  }
  // Legacy: `autoSave: false` (or absent) ⇒ just add `formatOnSave: false`.
  return {
    ...obj,
    general: { ...g, formatOnSave: false },
  }
}

/** v110 Motion contract: maps the persisted preference to the <html> attribute value. */
export function uiAnimationsValue(enabled: boolean): "on" | "off" {
  return enabled ? "on" : "off"
}

export const { use: useSettings, provider: SettingsProvider } = createSimpleContext({
  name: "Settings",
  init: () => {
    const [store, setStore, _, ready] = persisted(
      { key: "settings.v3", migrate: migrateAutoSave },
      createStore<Settings>(defaultSettings),
    )

    createEffect(() => {
      if (typeof document === "undefined") return
      const root = document.documentElement
      root.style.setProperty("--font-family-mono", monoFontFamily(store.appearance?.mono))
      root.style.setProperty("--font-family-sans", sansFontFamily(store.appearance?.sans))
    })

    // ADR-048: bridge the persisted accent onto the runtime CSS custom
    // property. Sentinel ("") falls back to the maquette seed in v110.css /
    // v110-chat.css; any non-empty value overrides `--accent` on `<html>` so
    // every var(--accent) consumer in the app follows the picker.
    createEffect(() => {
      if (typeof document === "undefined") return
      const value = store.appearance?.accent ?? ""
      if (value) {
        document.documentElement.style.setProperty("--accent", value)
        // Native form controls (range, progress, checkbox) read this; mirror
        // so the picker also retints browser widgets inside the app.
        document.documentElement.style.accentColor = value
      } else {
        document.documentElement.style.removeProperty("--accent")
        document.documentElement.style.removeProperty("accent-color")
      }
    })

    createEffect(() => {
      if (typeof document === "undefined") return
      // v110 Motion contract: the attribute drives the animation-free path
      // in the shell stylesheet (prefers-reduced-motion is handled in CSS).
      document.documentElement.dataset.uiAnimations = uiAnimationsValue(
        store.general?.uiAnimations ?? defaultSettings.general.uiAnimations,
      )
    })

    // Stores saved before ADR-046 have no observability object to write into.
    const writeObservabilityDomain = (domain: ObservabilityDomain, value: boolean) => {
      if (domain === "reasoning") return setStore("general", "showReasoningSummaries", value)
      if (!store.general?.observability) setStore("general", "observability", { preset: "balanced", domains: {} })
      setStore("general", "observability", "domains", domain, value)
    }

    createEffect(() => {
      if (store.general?.followup !== "queue") return
      setStore("general", "followup", "steer")
    })

    return {
      ready,
      get current() {
        return store
      },
      general: {
        autoSave: withFallback(() => store.general?.autoSave, defaultSettings.general.autoSave),
        setAutoSave(value: boolean) {
          setStore("general", "autoSave", value)
        },
        formatOnSave: withFallback(
          () => store.general?.formatOnSave,
          defaultSettings.general.formatOnSave,
        ),
        setFormatOnSave(value: boolean) {
          setStore("general", "formatOnSave", value)
        },
        releaseNotes: withFallback(() => store.general?.releaseNotes, defaultSettings.general.releaseNotes),
        setReleaseNotes(value: boolean) {
          setStore("general", "releaseNotes", value)
        },
        followup: withFallback(
          () => (store.general?.followup === "queue" ? "steer" : store.general?.followup),
          defaultSettings.general.followup,
        ),
        setFollowup(value: "queue" | "steer") {
          setStore("general", "followup", value === "queue" ? "steer" : value)
        },
        showReasoningSummaries: withFallback(
          () => store.general?.showReasoningSummaries,
          defaultSettings.general.showReasoningSummaries,
        ),
        setShowReasoningSummaries(value: boolean) {
          setStore("general", "showReasoningSummaries", value)
        },
        shellToolPartsExpanded: withFallback(
          () => store.general?.shellToolPartsExpanded,
          defaultSettings.general.shellToolPartsExpanded,
        ),
        setShellToolPartsExpanded(value: boolean) {
          setStore("general", "shellToolPartsExpanded", value)
        },
        editToolPartsExpanded: withFallback(
          () => store.general?.editToolPartsExpanded,
          defaultSettings.general.editToolPartsExpanded,
        ),
        setEditToolPartsExpanded(value: boolean) {
          setStore("general", "editToolPartsExpanded", value)
        },
        uiAnimations: withFallback(
          () => store.general?.uiAnimations,
          defaultSettings.general.uiAnimations,
        ),
        setUiAnimations(value: boolean) {
          setStore("general", "uiAnimations", value)
        },
        observabilityPreset: withFallback(
          () => store.general?.observability?.preset,
          defaultSettings.general.observability.preset,
        ),
        observabilityDomain(domain: ObservabilityDomain) {
          if (domain === "reasoning") return store.general?.showReasoningSummaries ?? defaultSettings.general.showReasoningSummaries
          return store.general?.observability?.domains?.[domain] ?? OBSERVABILITY_PRESETS.balanced[domain]
        },
        setObservabilityDomain(domain: ObservabilityDomain, value: boolean) {
          writeObservabilityDomain(domain, value)
          setStore("general", "observability", "preset", "custom")
        },
        setObservabilityPreset(preset: ObservabilityPreset) {
          if (preset !== "custom") {
            const values = OBSERVABILITY_PRESETS[preset]
            for (const domain of Object.keys(values) as ObservabilityDomain[]) writeObservabilityDomain(domain, values[domain])
          }
          setStore("general", "observability", "preset", preset)
        },
        viewMode: withFallback(
          () => store.general?.viewMode,
          defaultSettings.general.viewMode,
        ),
        setViewMode(value: "agent" | "ide") {
          setStore("general", "viewMode", value)
        },
      },
      updates: {
        startup: withFallback(() => store.updates?.startup, defaultSettings.updates.startup),
        setStartup(value: boolean) {
          setStore("updates", "startup", value)
        },
      },
      appearance: {
        fontSize: withFallback(() => store.appearance?.fontSize, defaultSettings.appearance.fontSize),
        setFontSize(value: number) {
          setStore("appearance", "fontSize", value)
        },
        font: withFallback(() => store.appearance?.mono, defaultSettings.appearance.mono),
        setFont(value: string) {
          setStore("appearance", "mono", value.trim() ? value : "")
        },
        uiFont: withFallback(() => store.appearance?.sans, defaultSettings.appearance.sans),
        setUIFont(value: string) {
          setStore("appearance", "sans", value.trim() ? value : "")
        },
        accent: withFallback(() => store.appearance?.accent, defaultSettings.appearance.accent),
        /** "" is Neutral: the :root seed (var(--text)) applies again. */
        setAccent(value: string) {
          setStore("appearance", "accent", value.trim().toLowerCase())
        },
      },
      keybinds: {
        get: (action: string) => store.keybinds?.[action],
        set(action: string, keybind: string) {
          setStore("keybinds", action, keybind)
        },
        reset(action: string) {
          setStore("keybinds", (current) => {
            if (!Object.hasOwn(current, action)) return current
            const next = { ...current }
            delete next[action]
            return next
          })
        },
        resetAll() {
          setStore("keybinds", reconcile({}))
        },
      },
      permissions: {
        autoApprove: withFallback(() => store.permissions?.autoApprove, defaultSettings.permissions.autoApprove),
        setAutoApprove(value: boolean) {
          setStore("permissions", "autoApprove", value)
        },
      },
      notifications: {
        agent: withFallback(() => store.notifications?.agent, defaultSettings.notifications.agent),
        setAgent(value: boolean) {
          setStore("notifications", "agent", value)
        },
        permissions: withFallback(() => store.notifications?.permissions, defaultSettings.notifications.permissions),
        setPermissions(value: boolean) {
          setStore("notifications", "permissions", value)
        },
        errors: withFallback(() => store.notifications?.errors, defaultSettings.notifications.errors),
        setErrors(value: boolean) {
          setStore("notifications", "errors", value)
        },
      },
      sounds: {
        agentEnabled: withFallback(() => store.sounds?.agentEnabled, defaultSettings.sounds.agentEnabled),
        setAgentEnabled(value: boolean) {
          setStore("sounds", "agentEnabled", value)
        },
        agent: withFallback(() => store.sounds?.agent, defaultSettings.sounds.agent),
        setAgent(value: string) {
          setStore("sounds", "agent", value)
        },
        permissionsEnabled: withFallback(
          () => store.sounds?.permissionsEnabled,
          defaultSettings.sounds.permissionsEnabled,
        ),
        setPermissionsEnabled(value: boolean) {
          setStore("sounds", "permissionsEnabled", value)
        },
        permissions: withFallback(() => store.sounds?.permissions, defaultSettings.sounds.permissions),
        setPermissions(value: string) {
          setStore("sounds", "permissions", value)
        },
        errorsEnabled: withFallback(() => store.sounds?.errorsEnabled, defaultSettings.sounds.errorsEnabled),
        setErrorsEnabled(value: boolean) {
          setStore("sounds", "errorsEnabled", value)
        },
        errors: withFallback(() => store.sounds?.errors, defaultSettings.sounds.errors),
        setErrors(value: string) {
          setStore("sounds", "errors", value)
        },
      },
    }
  },
})
