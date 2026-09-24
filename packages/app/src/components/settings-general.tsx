import { type Component, Show, createMemo, createResource, createSignal, onMount } from "solid-js"
import { Button } from "@unifia/ui/button"
import { Icon } from "@unifia/ui/icon"
import { Select } from "@unifia/ui/select"
import { Switch } from "@unifia/ui/switch"
import { TextField } from "@unifia/ui/text-field"
import { Tooltip } from "@unifia/ui/tooltip"
import { useTheme, type ColorScheme } from "@unifia/ui/theme/context"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import {
  monoDefault,
  monoFontFamily,
  monoInput,
  sansDefault,
  sansFontFamily,
  sansInput,
  useSettings,
} from "@/context/settings"
import { playSoundById, SOUND_OPTIONS } from "@/utils/sound"
import { Link } from "./link"
import { SettingsPage, SettingsSection } from "./settings-page"
import { SettingsComputeLink } from "./settings-compute-link"
import { SettingsRow } from "./settings-row"
import { SettingsChatObservability } from "./settings-chat-observability"
import { SettingsAccentPicker } from "./settings-accent-picker"
import { SettingsGithubAuth } from "./settings-github-auth"
import { SettingsGitAuth } from "./settings-git-auth"
import { SettingsDiskQuota } from "./settings-disk-quota"

let demoSoundState = {
  cleanup: undefined as (() => void) | undefined,
  timeout: undefined as NodeJS.Timeout | undefined,
  run: 0,
}

type ThemeOption = {
  id: string
  name: string
}

// To prevent audio from overlapping/playing very quickly when navigating the settings menus,
// delay the playback by 100ms during quick selection changes and pause existing sounds.
const stopDemoSound = () => {
  demoSoundState.run += 1
  if (demoSoundState.cleanup) {
    demoSoundState.cleanup()
  }
  clearTimeout(demoSoundState.timeout)
  demoSoundState.cleanup = undefined
}

const playDemoSound = (id: string | undefined) => {
  stopDemoSound()
  if (!id) return

  const run = ++demoSoundState.run
  demoSoundState.timeout = setTimeout(() => {
    void playSoundById(id).then((cleanup) => {
      if (demoSoundState.run !== run) {
        cleanup?.()
        return
      }
      demoSoundState.cleanup = cleanup
    })
  }, 100)
}

export const SettingsGeneral: Component = () => {
  const theme = useTheme()
  const language = useLanguage()
  const platform = usePlatform()
  const settings = useSettings()

  onMount(() => {
    void theme.loadThemes()
  })

  const linux = createMemo(() => platform.platform === "desktop" && platform.os === "linux")

  const themeOptions = createMemo<ThemeOption[]>(() => theme.ids().map((id) => ({ id, name: theme.name(id) })))

  const colorSchemeOptions = createMemo((): { value: ColorScheme; label: string }[] => [
    { value: "system", label: language.t("theme.scheme.system") },
    { value: "light", label: language.t("theme.scheme.light") },
    { value: "dark", label: language.t("theme.scheme.dark") },
  ])

  const languageOptions = createMemo(() =>
    language.locales.map((locale) => ({
      value: locale,
      label: language.label(locale),
    })),
  )

  const noneSound = { id: "none", label: "sound.option.none" } as const
  const soundOptions = [noneSound, ...SOUND_OPTIONS]
  const mono = () => monoInput(settings.appearance.font())
  const sans = () => sansInput(settings.appearance.uiFont())

  const soundSelectProps = (
    enabled: () => boolean,
    current: () => string,
    setEnabled: (value: boolean) => void,
    set: (id: string) => void,
  ) => ({
    options: soundOptions,
    current: enabled() ? (soundOptions.find((o) => o.id === current()) ?? noneSound) : noneSound,
    value: (o: (typeof soundOptions)[number]) => o.id,
    label: (o: (typeof soundOptions)[number]) => language.t(o.label),
    onHighlight: (option: (typeof soundOptions)[number] | undefined) => {
      if (!option) return
      playDemoSound(option.id === "none" ? undefined : option.id)
    },
    onSelect: (option: (typeof soundOptions)[number] | undefined) => {
      if (!option) return
      if (option.id === "none") {
        setEnabled(false)
        stopDemoSound()
        return
      }
      setEnabled(true)
      set(option.id)
      playDemoSound(option.id)
    },
    variant: "secondary" as const,
    size: "small" as const,
    triggerVariant: "settings" as const,
  })

  const GeneralSection = () => (
    <SettingsSection>
      <SettingsRow
        title={language.t("settings.general.row.language.title")}
        description={language.t("settings.general.row.language.description")}
      >
        <Select
          data-action="settings-language"
          options={languageOptions()}
          current={languageOptions().find((o) => o.value === language.locale())}
          value={(o) => o.value}
          label={(o) => o.label}
          onSelect={(option) => option && language.setLocale(option.value)}
          variant="secondary"
          size="small"
          triggerVariant="settings"
        />
      </SettingsRow>

      <SettingsRow
        title={language.t("settings.general.row.shellToolPartsExpanded.title")}
        description={language.t("settings.general.row.shellToolPartsExpanded.description")}
      >
        <div data-action="settings-feed-shell-tool-parts-expanded">
          <Switch
            checked={settings.general.shellToolPartsExpanded()}
            onChange={(checked) => settings.general.setShellToolPartsExpanded(checked)}
          />
        </div>
      </SettingsRow>

      <SettingsRow
        title={language.t("settings.general.row.editToolPartsExpanded.title")}
        description={language.t("settings.general.row.editToolPartsExpanded.description")}
      >
        <div data-action="settings-feed-edit-tool-parts-expanded">
          <Switch
            checked={settings.general.editToolPartsExpanded()}
            onChange={(checked) => settings.general.setEditToolPartsExpanded(checked)}
          />
        </div>
      </SettingsRow>

      <SettingsChatObservability />
    </SettingsSection>
  )

  const AppearanceSection = () => (
    <SettingsSection title={language.t("settings.general.section.appearance")}>
      <SettingsRow
        title={language.t("settings.general.row.colorScheme.title")}
        description={language.t("settings.general.row.colorScheme.description")}
      >
        <Select
          data-action="settings-color-scheme"
          options={colorSchemeOptions()}
          current={colorSchemeOptions().find((o) => o.value === theme.colorScheme())}
          value={(o) => o.value}
          label={(o) => o.label}
          onSelect={(option) => option && theme.setColorScheme(option.value)}
          onHighlight={(option) => {
            if (!option) return
            theme.previewColorScheme(option.value)
            return () => theme.cancelPreview()
          }}
          variant="secondary"
          size="small"
          triggerVariant="settings"
        />
      </SettingsRow>

      <SettingsRow
        title={language.t("settings.general.row.accent.title")}
        description={language.t("settings.general.row.accent.description")}
      >
        <SettingsAccentPicker />
      </SettingsRow>

      <SettingsRow
        title={language.t("settings.general.row.uiAnimations.title")}
        description={language.t("settings.general.row.uiAnimations.description")}
      >
        <div data-action="settings-general-ui-animations">
          <Switch
            checked={settings.general.uiAnimations()}
            onChange={(checked) => settings.general.setUiAnimations(checked)}
          />
        </div>
      </SettingsRow>

      <SettingsRow
        title={language.t("settings.general.row.theme.title")}
        description={
          <>
            {language.t("settings.general.row.theme.description")}{" "}
            <Link href="https://opencode.ai/docs/themes/">{language.t("common.learnMore")}</Link>
          </>
        }
      >
        <Select
          data-action="settings-theme"
          options={themeOptions()}
          current={themeOptions().find((o) => o.id === theme.themeId())}
          value={(o) => o.id}
          label={(o) => o.name}
          onSelect={(option) => {
            if (!option) return
            theme.setTheme(option.id)
          }}
          onHighlight={(option) => {
            if (!option) return
            theme.previewTheme(option.id)
            return () => theme.cancelPreview()
          }}
          variant="secondary"
          size="small"
          triggerVariant="settings"
        />
      </SettingsRow>

      <SettingsRow
        title={language.t("settings.general.row.uiFont.title")}
        description={language.t("settings.general.row.uiFont.description")}
      >
        <div class="w-full sm:w-[210px]">
          <TextField
            data-action="settings-ui-font"
            label={language.t("settings.general.row.uiFont.title")}
            hideLabel
            type="text"
            value={sans()}
            onChange={(value) => settings.appearance.setUIFont(value)}
            placeholder={sansDefault}
            spellcheck={false}
            autocorrect="off"
            autocomplete="off"
            autocapitalize="off"
            class="text-12-regular"
            style={{ "font-family": sansFontFamily(settings.appearance.uiFont()) }}
          />
        </div>
      </SettingsRow>

      <SettingsRow
        title={language.t("settings.general.row.font.title")}
        description={language.t("settings.general.row.font.description")}
      >
        <div class="w-full sm:w-[210px]">
          <TextField
            data-action="settings-code-font"
            label={language.t("settings.general.row.font.title")}
            hideLabel
            type="text"
            value={mono()}
            onChange={(value) => settings.appearance.setFont(value)}
            placeholder={monoDefault}
            spellcheck={false}
            autocorrect="off"
            autocomplete="off"
            autocapitalize="off"
            class="text-12-regular"
            style={{ "font-family": monoFontFamily(settings.appearance.font()) }}
          />
        </div>
      </SettingsRow>
    </SettingsSection>
  )

  const NotificationsSection = () => (
    <SettingsSection title={language.t("settings.general.section.notifications")}>
      <SettingsRow
        title={language.t("settings.general.notifications.agent.title")}
        description={language.t("settings.general.notifications.agent.description")}
      >
        <div data-action="settings-notifications-agent">
          <Switch
            checked={settings.notifications.agent()}
            onChange={(checked) => settings.notifications.setAgent(checked)}
          />
        </div>
      </SettingsRow>

      <SettingsRow
        title={language.t("settings.general.notifications.permissions.title")}
        description={language.t("settings.general.notifications.permissions.description")}
      >
        <div data-action="settings-notifications-permissions">
          <Switch
            checked={settings.notifications.permissions()}
            onChange={(checked) => settings.notifications.setPermissions(checked)}
          />
        </div>
      </SettingsRow>

      <SettingsRow
        title={language.t("settings.general.notifications.errors.title")}
        description={language.t("settings.general.notifications.errors.description")}
      >
        <div data-action="settings-notifications-errors">
          <Switch
            checked={settings.notifications.errors()}
            onChange={(checked) => settings.notifications.setErrors(checked)}
          />
        </div>
      </SettingsRow>
      <div data-slot="settings-row-actions">
        <Button
          size="small"
          onClick={() =>
            void platform.notify(
              language.t("settings.general.notifications.testTitle"),
              language.t("settings.general.notifications.testDescription"),
            )
          }
        >
          {language.t("settings.general.notifications.test")}
        </Button>
      </div>
    </SettingsSection>
  )

  const SoundsSection = () => (
    <SettingsSection title={language.t("settings.general.section.sounds")}>
      <SettingsRow
        title={language.t("settings.general.sounds.agent.title")}
        description={language.t("settings.general.sounds.agent.description")}
      >
        {
          // @ts-expect-error -- data-action is valid HTML but not reflected in Kobalte's SelectRootProps tsgo types
          <Select
            data-action="settings-sounds-agent"
            {...soundSelectProps(
              () => settings.sounds.agentEnabled(),
              () => settings.sounds.agent(),
              (value) => settings.sounds.setAgentEnabled(value),
              (id) => settings.sounds.setAgent(id),
            )}
          />
        }
      </SettingsRow>

      <SettingsRow
        title={language.t("settings.general.sounds.permissions.title")}
        description={language.t("settings.general.sounds.permissions.description")}
      >
        {
          // @ts-expect-error -- data-action is valid HTML but not reflected in Kobalte's SelectRootProps tsgo types
          <Select
            data-action="settings-sounds-permissions"
            {...soundSelectProps(
              () => settings.sounds.permissionsEnabled(),
              () => settings.sounds.permissions(),
              (value) => settings.sounds.setPermissionsEnabled(value),
              (id) => settings.sounds.setPermissions(id),
            )}
          />
        }
      </SettingsRow>

      <SettingsRow
        title={language.t("settings.general.sounds.errors.title")}
        description={language.t("settings.general.sounds.errors.description")}
      >
        {
          // @ts-expect-error -- data-action is valid HTML but not reflected in Kobalte's SelectRootProps tsgo types
          <Select
            data-action="settings-sounds-errors"
            {...soundSelectProps(
              () => settings.sounds.errorsEnabled(),
              () => settings.sounds.errors(),
              (value) => settings.sounds.setErrorsEnabled(value),
              (id) => settings.sounds.setErrors(id),
            )}
          />
        }
      </SettingsRow>
    </SettingsSection>
  )

  // Open by default, as the reference ships it.
  const [advanced, setAdvanced] = createSignal(true)
  const openAdvanced = () => {
    setAdvanced(true)
    requestAnimationFrame(() => advancedRef?.scrollIntoView({ block: "start", behavior: "smooth" }))
  }
  let advancedRef: HTMLDivElement | undefined

  return (
    <SettingsPage title={language.t("settings.tab.general")}>
      <GeneralSection />

      <AppearanceSection />

      <NotificationsSection />

      <SoundsSection />

      {/* FORK: GitHub account connection — OAuth Device Flow. "Se connecter
            avec GitHub" is the only primary action; manual git credentials
            (SSH key / PAT) stay under the "Advanced options" disclosure. */}
      <SettingsGithubAuth onConfigure={openAdvanced} />

      <button
        type="button"
        data-slot="settings-advanced-toggle"
        aria-expanded={advanced()}
        onClick={() => setAdvanced(!advanced())}
      >
        {language.t("settings.fork.githubAuth.advancedOptions")}
        <span aria-hidden="true">⌄</span>
      </button>
      <Show when={advanced()}>
        <div ref={advancedRef} data-slot="settings-advanced">
          <SettingsComputeLink />
          {/* FORK: Stretch — disk quota warning (hidden on Windows where statfs is unavailable) */}
          <SettingsDiskQuota />
          <h3>{language.t("settings.general.section.gitCredentials")}</h3>
          <p data-slot="settings-note">{language.t("settings.fork.githubAuth.advancedOptionsWarning")}</p>
          {/* FORK: Stretch — git push/pull auth (any host, manual token/SSH key) */}
          <SettingsGitAuth />
        </div>
      </Show>

      <Show when={linux()}>
        {(_) => {
          const [valueResource, actions] = createResource(() => platform.getDisplayBackend?.())
          const value = () => (valueResource.state === "pending" ? undefined : valueResource.latest)

          const onChange = (checked: boolean) =>
            platform.setDisplayBackend?.(checked ? "wayland" : "auto").finally(() => actions.refetch())

          return (
            <SettingsSection title={language.t("settings.general.section.display")}>
              <SettingsRow
                title={
                  <div class="flex items-center gap-2">
                    <span>{language.t("settings.general.row.wayland.title")}</span>
                    <Tooltip value={language.t("settings.general.row.wayland.tooltip")} placement="top">
                      <span class="text-text-weak">
                        <Icon name="help" size="small" />
                      </span>
                    </Tooltip>
                  </div>
                }
                description={language.t("settings.general.row.wayland.description")}
              >
                <div data-action="settings-wayland">
                  <Switch checked={value() === "wayland"} onChange={onChange} />
                </div>
              </SettingsRow>
            </SettingsSection>
          )
        }}
      </Show>
    </SettingsPage>
  )
}
