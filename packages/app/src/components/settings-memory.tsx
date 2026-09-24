// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// Original work. No upstream derivation.
//
// Memory settings — the vault the agent recalls from and records into.
//
// The feature shipped reachable only through `unifia.json`, which is the same
// failure the whole memory work has been closing: correct, present, and
// findable by nobody. This panel is the surface that makes it real for
// someone who never opens a config file.
//
// Everything here writes through the settings scope: the global config for
// "Moi", the open project's config for "Projet" (ADR-047).
import { type Component, createResource, createSignal, Show } from "solid-js"
import { Switch as SwitchComponent } from "@unifia/ui/switch"
import { TextField } from "@unifia/ui/text-field"
import { showToast } from "@unifia/ui/toast"
import { useSDK } from "@/context/sdk"
import { SettingsPage, SettingsSection } from "./settings-page"
import { SettingsRow } from "./settings-row"
import { useSettingsScope } from "./settings-scope"
import { useLanguage } from "@/context/language"

type MemorySettings = {
  enabled?: boolean
  directory?: string
  remote_recall?: boolean
  max_notes?: number
  deadline_ms?: number
}

/** Mirrors DEFAULT_MEMORY_DIRECTORY in the knowledge core. */
const DEFAULT_SUBDIRECTORY = ".unifia/memory"
const DEFAULT_MAX_NOTES = 5
const DEFAULT_DEADLINE_MS = 1500

/**
 * A blur on the text input.
 *
 * `TextField` forwards unlisted handlers straight to its inner `<input>`, so
 * this is the native event; spelling the type out keeps `currentTarget.value`
 * honest rather than reaching it through `any`.
 */
type InputBlur = FocusEvent & { currentTarget: HTMLInputElement }

/**
 * Join the project path and the default vault subdirectory.
 *
 * The separator is read off the project path rather than off a platform flag:
 * this panel also runs in a browser talking to a server on another machine,
 * where the viewer's platform says nothing about the server's paths.
 */
function defaultVaultPath(directory: string): string {
  // No project open yet: show the relative default rather than joining it to
  // an empty string, which produced a plausible-looking "/.unifia/memory".
  if (directory.trim() === "") return DEFAULT_SUBDIRECTORY
  const separator = directory.includes("\\") ? "\\" : "/"
  const base = directory.replace(/[\\/]+$/, "")
  return `${base}${separator}${DEFAULT_SUBDIRECTORY.replace(/\//g, separator)}`
}

export const SettingsMemory: Component = () => {
  const language = useLanguage()
  const sdk = useSDK()
  const scope = useSettingsScope()
  const [busy, setBusy] = createSignal(false)
  // Held separately from the saved value so typing a path does not write on
  // every keystroke; committed on blur, like the other text settings.
  const [draftDirectory, setDraftDirectory] = createSignal<string | null>(null)

  // A rejected resource propagates to the nearest ErrorBoundary, which here
  // is the application root: an unreachable server would replace the whole
  // window with a crash screen instead of one unavailable settings panel.
  // The failure is shown in the panel and the controls stay on their
  // defaults, disabled — visibly not-loaded rather than silently wrong.
  const [config, configActions] = createResource(scope.scope, async () => {
    try {
      return { value: await scope.config.get(), error: undefined }
    } catch (error) {
      return { value: undefined, error: error instanceof Error ? error.message : String(error) }
    }
  })
  const loadError = () => config.latest?.error
  const memory = (): MemorySettings => config.latest?.value?.memory ?? {}
  const enabled = () => memory().enabled !== false
  const defaultPath = () => defaultVaultPath(sdk.directory)
  const resolvedPath = () => {
    const configured = memory().directory?.trim()
    return configured === undefined || configured === "" ? defaultPath() : configured
  }

  const update = async (patch: MemorySettings) => {
    setBusy(true)
    try {
      const current = await scope.config.get()
      await scope.config.update({ ...current, memory: { ...current.memory, ...patch } })
      await configActions.refetch()
      showToast({ variant: "success", title: language.t("settings.fork.memory.saveSuccess") })
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("settings.fork.memory.saveError"),
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }

  /**
   * Clearing the setting writes an empty string, not an absent key.
   *
   * The config endpoint merges rather than replaces, and `JSON.stringify`
   * drops an `undefined` value, so sending `directory: undefined` left the
   * old path in the file and the reset silently did nothing. An empty string
   * survives the merge, and `resolveMemoryRoot` already reads a blank
   * directory as "use the default" — so this is the value that means unset,
   * on both sides.
   */
  const UNSET = ""

  const commitDirectory = (value: string) => {
    const next = value.trim()
    setDraftDirectory(null)
    if (next === (memory().directory ?? UNSET)) return
    void update({ directory: next })
  }

  const numeric = (value: string, fallback: number) => {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }

  const maxNotes = () => memory().max_notes ?? DEFAULT_MAX_NOTES
  const deadline = () => memory().deadline_ms ?? DEFAULT_DEADLINE_MS
  const locked = () => busy() || loadError() !== undefined
  // The path sits in a code chip inside the sentence, wherever the locale
  // puts it: split the translated sentence around a marker.
  const PATH_MARKER = "\u0001"
  const resolvedSentence = () =>
    language.t("settings.fork.memory.directoryResolved", { path: PATH_MARKER }).split(PATH_MARKER)

  return (
    <SettingsPage
      title={language.t("settings.fork.memory.title")}
      subtitle={language.t("settings.fork.memory.description")}
    >
      <Show when={loadError()}>
        {(message) => (
          <p data-slot="settings-note" data-tone="warning">
            {language.t("settings.fork.memory.loadError")} {message()}
          </p>
        )}
      </Show>

      <SettingsSection>
        <SettingsRow
          title={language.t("settings.fork.memory.enableTitle")}
          description={language.t("settings.fork.memory.enableDescription")}
        >
          <div data-action="settings-memory-enabled">
            <SwitchComponent
              checked={enabled()}
              disabled={locked() || config.loading}
              onChange={(value) => void update({ enabled: value })}
            />
          </div>
        </SettingsRow>
      </SettingsSection>

      <div data-slot="settings-group" data-disabled={enabled() ? undefined : ""}>
        <SettingsSection title={language.t("settings.fork.memory.vaultSection")}>
          <SettingsRow
            title={language.t("settings.fork.memory.directoryTitle")}
            description={language.t("settings.fork.memory.directoryDescription")}
          >
            {/* Clearing the field is the reset: a blank directory means the default. */}
            <TextField
              placeholder={DEFAULT_SUBDIRECTORY}
              value={draftDirectory() ?? memory().directory ?? UNSET}
              disabled={locked()}
              onChange={setDraftDirectory}
              onBlur={(event: InputBlur) => commitDirectory(event.currentTarget.value)}
              onKeyDown={(event: KeyboardEvent) => {
                // `onKeyDown` is one of the props TextField splits off to
                // the Kobalte root, so `currentTarget` here is a wrapper
                // element and blurring it does nothing. The draft signal is
                // the value, and reading it needs no DOM at all.
                if (event.key === "Enter") commitDirectory(draftDirectory() ?? memory().directory ?? UNSET)
              }}
            />
          </SettingsRow>
        </SettingsSection>
        <p data-slot="settings-note">
          {resolvedSentence()[0]}
          <code data-slot="settings-code">{resolvedPath()}</code>
          {resolvedSentence()[1]}
        </p>

        <SettingsSection title={language.t("settings.fork.memory.privacySection")}>
          <SettingsRow
            title={language.t("settings.fork.memory.remoteRecallTitle")}
            description={language.t("settings.fork.memory.remoteRecallDescription")}
          >
            <SwitchComponent
              checked={memory().remote_recall === true}
              disabled={locked() || config.loading}
              onChange={(value) => void update({ remote_recall: value })}
            />
          </SettingsRow>
        </SettingsSection>
        {/* Warning styling belongs to the state that widens what may leave
            the machine; the safe default is a plain note. */}
        <p data-slot="settings-note" data-tone={memory().remote_recall === true ? "warning" : undefined}>
          <Show
            when={memory().remote_recall === true}
            fallback={language.t("settings.fork.memory.remoteRecallOffNotice")}
          >
            {language.t("settings.fork.memory.remoteRecallOnNotice")}
          </Show>
        </p>

        <SettingsSection title={language.t("settings.fork.memory.recallSection")}>
          <SettingsRow
            title={language.t("settings.fork.memory.maxNotesTitle")}
            description={language.t("settings.fork.memory.maxNotesDescription")}
          >
            <input
              type="number"
              data-slot="settings-number"
              value={maxNotes()}
              disabled={locked()}
              onBlur={(event) => {
                const next = numeric(event.currentTarget.value.trim(), DEFAULT_MAX_NOTES)
                if (next !== maxNotes()) void update({ max_notes: next })
              }}
            />
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.fork.memory.deadlineTitle")}
            description={language.t("settings.fork.memory.deadlineDescription")}
          >
            <input
              type="number"
              data-slot="settings-number"
              value={deadline()}
              disabled={locked()}
              onBlur={(event) => {
                const next = numeric(event.currentTarget.value.trim(), DEFAULT_DEADLINE_MS)
                if (next !== deadline()) void update({ deadline_ms: next })
              }}
            />
          </SettingsRow>
        </SettingsSection>
      </div>

      <div data-slot="settings-status-grid">
        <div>
          <span>{language.t("settings.fork.memory.statusMode")}</span>
          <b>{language.t(enabled() ? "settings.fork.memory.statusActive" : "settings.fork.memory.statusInactive")}</b>
        </div>
        <div>
          <span>{language.t("settings.fork.memory.statusPath")}</span>
          <b>{resolvedPath()}</b>
        </div>
        <div>
          <span>{language.t("settings.fork.memory.statusInjection")}</span>
          <b>{language.t("settings.fork.memory.statusInjectionValue", { notes: maxNotes(), ms: deadline() })}</b>
        </div>
      </div>
    </SettingsPage>
  )
}
