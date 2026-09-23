/* SPDX-License-Identifier: MIT */

// The reference's settings page skeleton (.settings-page, .settings-page-head,
// h3 + .settings-section): every settings page renders through these so the
// title, spacing and section rhythm are declared once, in v110-settings.css.

import { Show, type JSX, type ParentProps } from "solid-js"
import { SettingsList } from "./settings-list"

export function SettingsPage(
  props: ParentProps<{ title: string; subtitle?: JSX.Element; actions?: JSX.Element; sticky?: boolean }>,
) {
  return (
    <div data-v110="settings-page">
      <div data-slot="settings-page-head" data-sticky={props.sticky ? "" : undefined}>
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
