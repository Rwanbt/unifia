/* SPDX-License-Identifier: MIT */

import { createSignal, For, Show } from "solid-js"
import { Icon } from "@unifia/ui/icon"
import {
  OBSERVABILITY_DOMAINS,
  WIRED_DOMAINS,
  type ObservabilityDomain,
  type ObservabilityPreset,
} from "@unifia/ui/chat-observability"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"

// The reference's glyphs for each domain (maquette v110, "Observabilité du chat").
const DOMAIN_GLYPHS: Record<ObservabilityDomain, string> = {
  reasoning: "◇",
  progress: "☑",
  shell: "›_",
  edit: "±",
  artifact: "◇",
  approval: "◆",
  question: "?",
  agents: "◎",
  skills: "✦",
  tools: "⌘",
  context: "⊕",
  memory: "◉",
  browser: "◌",
  sources: "⌕",
  tests: "✓",
  git: "⑂",
  process: "◷",
  errors: "!",
  routing: "↗",
  policy: "⌾",
  hooks: "⛓",
  compaction: "⇣",
  usage: "◫",
  trajectory: "≋",
}

const PRESETS: ObservabilityPreset[] = ["clean", "balanced", "full", "custom"]

/** ADR-046: presets and per-domain switches for what the chat shows. */
export function SettingsChatObservability() {
  const language = useLanguage()
  const settings = useSettings()
  const [open, setOpen] = createSignal(false)

  const choosePreset = (preset: ObservabilityPreset) => {
    settings.general.setObservabilityPreset(preset)
    if (preset === "custom") setOpen(true)
  }

  return (
    <div data-v110="chat-observability" data-open={open() ? "" : undefined}>
      <div data-slot="observability-head">
        <div data-slot="observability-copy">
          <b>{language.t("settings.general.observability.title")}</b>
          <span>{language.t("settings.general.observability.description")}</span>
        </div>
        <div data-slot="observability-presets" role="group" aria-label={language.t("settings.general.observability.presets")}>
          <For each={PRESETS}>
            {(preset) => (
              <button
                type="button"
                data-preset={preset}
                aria-pressed={settings.general.observabilityPreset() === preset}
                onClick={() => choosePreset(preset)}
              >
                {language.t(`settings.general.observability.preset.${preset}` as const)}
              </button>
            )}
          </For>
        </div>
      </div>
      <button
        type="button"
        data-slot="observability-disclosure"
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        <Icon name="chevron-right" size="small" />
        <span>{language.t("settings.general.observability.customize")}</span>
      </button>
      <Show when={open()}>
        <div data-slot="observability-grid">
          <For each={OBSERVABILITY_DOMAINS}>{(domain) => <DomainSwitch domain={domain} />}</For>
        </div>
        <p data-slot="observability-note">{language.t("settings.general.observability.note")}</p>
      </Show>
    </div>
  )
}

function DomainSwitch(props: { domain: ObservabilityDomain }) {
  const language = useLanguage()
  const settings = useSettings()
  const wired = () => WIRED_DOMAINS.has(props.domain)
  const title = () => language.t(`settings.general.observability.domain.${props.domain}.title` as const)
  const description = () => language.t(`settings.general.observability.domain.${props.domain}.description` as const)
  return (
    <div data-slot="observability-item" data-wired={wired() ? "" : undefined}>
      <span data-slot="observability-item-icon" aria-hidden="true">
        {DOMAIN_GLYPHS[props.domain]}
      </span>
      <span data-slot="observability-item-copy">
        <b>{title()}</b>
        <small>{description()}</small>
      </span>
      <button
        type="button"
        role="switch"
        data-slot="observability-switch"
        data-domain={props.domain}
        aria-label={title()}
        aria-checked={wired() && settings.general.observabilityDomain(props.domain)}
        disabled={!wired()}
        title={wired() ? undefined : language.t("settings.general.observability.comingSoon")}
        onClick={() => settings.general.setObservabilityDomain(props.domain, !settings.general.observabilityDomain(props.domain))}
      />
    </div>
  )
}
