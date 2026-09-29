/* SPDX-License-Identifier: MIT */

// Building blocks shared by the account centre's pages (ADR-051): the page
// head, the soon-disabled action, and this device's session row.

import { Show, type JSX, type ParentProps } from "solid-js"
import { useLanguage } from "@/context/language"
import type { Account } from "./use-account"

export function AccountPageHead(props: ParentProps<{ title: string; description: string }>) {
  return (
    <div data-slot="account-page-head">
      <div>
        <h2>{props.title}</h2>
        <p>{props.description}</p>
      </div>
      <Show when={props.children}>
        <div data-slot="account-head-actions">{props.children}</div>
      </Show>
    </div>
  )
}

export function AccountAction(
  props: ParentProps<{ tone?: "primary" | "danger"; disabled?: boolean; title?: string; onClick?: () => void }>,
) {
  return (
    <button
      type="button"
      data-slot="account-action"
      data-tone={props.tone}
      disabled={props.disabled}
      title={props.title}
      onClick={() => props.onClick?.()}
    >
      {props.children}
    </button>
  )
}

/** A control with no backend yet (ADR-047): shown, disabled, "Coming soon". */
export function SoonAction(props: ParentProps<{ tone?: "primary" | "danger"; locked?: boolean }>) {
  const language = useLanguage()
  return (
    <AccountAction tone={props.tone} disabled title={language.t("common.comingSoon")}>
      <Show when={props.locked}>
        <span aria-hidden="true">🔒</span>
      </Show>
      {props.children}
    </AccountAction>
  )
}

export function AccountEyebrow(props: { children: JSX.Element }) {
  return <span data-slot="account-eyebrow">{props.children}</span>
}

const DEVICE_LABEL = {
  desktop: "account.device.desktop",
  web: "account.device.web",
  mobile: "account.device.mobile",
} as const

/** This device's connection to its server, the only session the app knows. */
export function DeviceSessionRow(props: { account: Account }) {
  const language = useLanguage()
  const device = () => props.account.device()
  const space = () => props.account.activeOrg()?.orgName ?? language.t("account.space.personal")
  const detail = () => [space(), device().os, device().server].filter((part): part is string => !!part).join(" · ")

  return (
    <div data-slot="account-session-list">
      <div data-slot="account-session-row">
        <span data-slot="account-session-dot" />
        <div>
          <b>{language.t(DEVICE_LABEL[device().kind])}</b>
          <small>{detail()}</small>
        </div>
        <span data-slot="account-session-trust">
          <Show when={props.account.identity().signedIn}>
            <i>{language.t("account.session.verified")}</i>
          </Show>
          <span data-slot="account-session-state">{language.t("account.session.current")}</span>
        </span>
      </div>
    </div>
  )
}
