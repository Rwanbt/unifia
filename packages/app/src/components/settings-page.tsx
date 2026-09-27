/* SPDX-License-Identifier: MIT */

// The reference's settings page skeleton (.settings-page, .settings-page-head,
// h3 + .settings-section): every settings page renders through these so the
// title, spacing and section rhythm are declared once, in v110-settings.css.

import { ErrorBoundary, Show, Suspense, type JSX, type ParentProps } from "solid-js"
import { useLanguage } from "@/context/language"
import { SettingsList } from "./settings-list"
import { useSettingsScope } from "./settings-scope"

/** The reference's `.v91-page-intro`: what the page is for, in plain words. */
export type SettingsIntro = { icon: string; title: string; text: string }

export function SettingsPage(
  props: ParentProps<{
    title: string
    subtitle?: JSX.Element
    actions?: JSX.Element
    sticky?: boolean
    /** The reference's catalog pages (MCP, Skills, Hooks) use a larger head. */
    large?: boolean
    intro?: SettingsIntro
  }>,
) {
  const settings = useSettingsScope()
  return (
    <div data-v110="settings-page">
      <div
        data-slot="settings-page-head"
        data-sticky={props.sticky ? "" : undefined}
        data-large={props.large ? "" : undefined}
      >
        <div>
          <h2>{props.title}</h2>
          <Show when={props.subtitle}>
            <div data-slot="settings-muted">{props.subtitle}</div>
          </Show>
        </div>
        <Show when={props.actions}>
          <div data-slot="settings-head-actions">{props.actions}</div>
        </Show>
      </div>
      <Show when={props.intro}>
        {(intro) => (
          // Guided mode adds context; technical details only dim it.
          <div data-slot="settings-page-intro" data-dimmed={settings.detail() === "technical" ? "" : undefined}>
            <div data-slot="settings-page-intro-icon" aria-hidden="true">
              {intro().icon}
            </div>
            <div>
              <b>{intro().title}</b>
              <span>{intro().text}</span>
            </div>
          </div>
        )}
      </Show>
      {props.children}
    </div>
  )
}

/** An `h3` and its `.settings-section` card; without a title, the card alone. */
export function SettingsSection(props: ParentProps<{ title?: string }>) {
  return (
    <>
      <Show when={props.title}>
        <h3>{props.title}</h3>
      </Show>
      <SettingsList>{props.children}</SettingsList>
    </>
  )
}

/**
 * Loads one settings page. WHY a boundary per page: a page whose request
 * throws (a missing endpoint, an offline server) otherwise reaches the app's
 * root boundary and replaces the whole application with the crash screen.
 * The Suspense keeps a loading page from suspending the session around it.
 */
export function SettingsPageBoundary(props: ParentProps) {
  const language = useLanguage()
  return (
    <ErrorBoundary
      fallback={(error: unknown, reset) => (
        <div data-slot="settings-page-error" role="alert">
          <b>{language.t("common.requestFailed")}</b>
          <span>{error instanceof Error ? error.message : String(error)}</span>
          <button type="button" onClick={reset}>
            {language.t("common.retry")}
          </button>
        </div>
      )}
    >
      <Suspense>{props.children}</Suspense>
    </ErrorBoundary>
  )
}
