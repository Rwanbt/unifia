/* SPDX-License-Identifier: MIT */

import { createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"

// The maquette's accent presets (v110 `presetMap`). Neutral is stored as ""
// so the :root seed (var(--text)) applies and follows the colour scheme.
export const ACCENT_PRESETS = [
  { id: "neutral", value: "" },
  { id: "blue", value: "#5b8cff" },
  { id: "violet", value: "#8b7cff" },
  { id: "cyan", value: "#37b9d5" },
  { id: "green", value: "#48b881" },
  { id: "orange", value: "#d99045" },
  { id: "rose", value: "#d66fa3" },
  { id: "red", value: "#d96868" },
] as const

type AccentPresetId = (typeof ACCENT_PRESETS)[number]["id"]

const CUSTOM_SEED = "#5b8cff"

/** The preset a stored accent matches, or undefined for a custom colour. */
export function accentPreset(value: string): AccentPresetId | undefined {
  const normalized = value.trim().toLowerCase()
  return ACCENT_PRESETS.find((preset) => preset.value === normalized)?.id
}

const dotColor = (value: string) => value || "var(--text)"

/** Maquette `.accent-combobox` (ADR-048): presets plus a custom colour row. */
export function SettingsAccentPicker() {
  const language = useLanguage()
  const settings = useSettings()
  const [open, setOpen] = createSignal(false)
  let root: HTMLDivElement | undefined

  const current = () => settings.appearance.accent()
  const selected = () => accentPreset(current())
  const presetLabel = (id: AccentPresetId) => language.t(`settings.general.row.accent.preset.${id}` as const)
  const triggerLabel = () => {
    const id = selected()
    return id ? presetLabel(id) : language.t("settings.general.row.accent.custom")
  }

  onMount(() => {
    const close = (event: MouseEvent) => {
      if (root && !root.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("click", close)
    onCleanup(() => document.removeEventListener("click", close))
  })

  const choose = (value: string) => {
    settings.appearance.setAccent(value)
    setOpen(false)
  }

  return (
    <div
      ref={root}
      data-v110="accent-combobox"
      data-open={open() ? "" : undefined}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false)
      }}
    >
      <button
        type="button"
        data-slot="accent-trigger"
        data-action="settings-accent-select"
        aria-haspopup="listbox"
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        <span data-slot="accent-dot" style={{ "--combo-accent": dotColor(current()) }} />
        <span data-slot="accent-label">{triggerLabel()}</span>
        <svg data-slot="accent-chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m7 9 5 5 5-5" />
        </svg>
      </button>
      <Show when={open()}>
        <div data-slot="accent-menu" role="listbox" aria-label={language.t("settings.general.row.accent.title")}>
          <For each={ACCENT_PRESETS}>
            {(preset) => (
              <button
                type="button"
                role="option"
                data-slot="accent-option"
                data-accent={preset.id}
                aria-selected={selected() === preset.id}
                onClick={() => choose(preset.value)}
              >
                <span data-slot="accent-dot" style={{ "--combo-accent": dotColor(preset.value) }} />
                <span>{presetLabel(preset.id)}</span>
                <span data-slot="accent-check">{selected() === preset.id ? "✓" : ""}</span>
              </button>
            )}
          </For>
          <div data-slot="accent-custom-row">
            <label data-slot="accent-custom" data-action="settings-accent-custom">
              <span data-slot="accent-dot" style={{ "--combo-accent": selected() ? CUSTOM_SEED : current() }} />
              <span>{language.t("settings.general.row.accent.custom")}</span>
              <input
                type="color"
                data-slot="accent-color"
                value={selected() ? CUSTOM_SEED : current()}
                aria-label={language.t("settings.general.row.accent.custom")}
                onInput={(event) => settings.appearance.setAccent(event.currentTarget.value)}
                onChange={() => setOpen(false)}
              />
            </label>
          </div>
        </div>
      </Show>
    </div>
  )
}
