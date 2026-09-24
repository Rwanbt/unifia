/* SPDX-License-Identifier: MIT */

// Vue d'ensemble -- the reference's "Compte & espaces" (ADR-051): the active
// space, the spaces this identity can use, and this device's session.

import { For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { initials } from "./account-identity"
import { AccountAction, AccountEyebrow, AccountPageHead, DeviceSessionRow, SoonAction } from "./account-parts"
import type { Account, ConsoleOrg } from "./use-account"

export function AccountOverview(props: { account: Account; onManageIdentity: () => void }) {
  const language = useLanguage()
  const identity = () => props.account.identity()
  const active = () => props.account.activeOrg()

  return (
    <>
      <AccountPageHead
        title={language.t("account.overview.title")}
        description={language.t("account.overview.description")}
      >
        <span data-slot="account-state" data-signed-in={identity().signedIn ? "" : undefined}>
          <span data-slot="account-state-dot" />
          {identity().name} ·{" "}
          {identity().signedIn ? language.t("account.state.signedIn") : language.t("account.state.local")}
        </span>
        <AccountAction onClick={props.onManageIdentity}>{language.t("account.overview.manageIdentity")}</AccountAction>
      </AccountPageHead>

      <div data-slot="account-context">
        <div data-slot="account-context-icon">{active() ? initials(active()!.orgName) : identity().initials}</div>
        <div data-slot="account-context-main">
          <AccountEyebrow>{language.t("account.overview.activeSpace")}</AccountEyebrow>
          <b>{active()?.orgName ?? language.t("account.space.personal")}</b>
          <small>{active() ? language.t("account.space.orgDetail") : language.t("account.space.personalDetail")}</small>
        </div>
        <span data-slot="account-pill">
          {active() ? language.t("account.space.organisation") : language.t("account.space.private")}
        </span>
      </div>
      <div data-slot="account-scope-impact">
        <b>{language.t("account.overview.isolation")}</b>{" "}
        {active()
          ? language.t("account.overview.isolationOrg", { org: active()!.orgName })
          : language.t("account.overview.isolationPersonal")}
      </div>

      <h3>{language.t("account.overview.spaces")}</h3>
      <div data-slot="account-space-list">
        <SpaceRow
          avatar={identity().initials}
          name={language.t("account.space.personal")}
          detail={language.t("account.space.personalDetail")}
          active={!active()}
        />
        <For each={props.account.orgs()}>{(org) => <OrgSpaceRow account={props.account} org={org} />}</For>
      </div>
      <div data-slot="account-space-actions">
        <SoonAction locked>{language.t("account.org.join")}</SoonAction>
        <SoonAction locked>{language.t("account.org.create")}</SoonAction>
      </div>

      <h3>{language.t("account.overview.sessions")}</h3>
      <DeviceSessionRow account={props.account} />
    </>
  )
}

function SpaceRow(props: { avatar: string; name: string; detail: string; active: boolean; onSelect?: () => void }) {
  const language = useLanguage()
  return (
    <button
      type="button"
      data-slot="account-space"
      data-active={props.active ? "" : undefined}
      disabled={props.active || !props.onSelect}
      onClick={() => props.onSelect?.()}
    >
      <span data-slot="account-space-avatar">{props.avatar}</span>
      <span data-slot="account-space-copy">
        <b>{props.name}</b>
        <span>{props.detail}</span>
      </span>
      <span data-slot="account-space-meta">
        {/* This device's session always belongs to the active space. */}
        <Show when={props.active}>
          <span>{language.t("account.space.sessionCount")}</span>
        </Show>
        <Show
          when={props.active}
          fallback={
            <Show when={props.onSelect}>
              <i>{language.t("account.space.switch")}</i>
            </Show>
          }
        >
          <i>{language.t("account.space.active")}</i>
        </Show>
      </span>
    </button>
  )
}

function OrgSpaceRow(props: { account: Account; org: ConsoleOrg }) {
  const language = useLanguage()
  return (
    <SpaceRow
      avatar={initials(props.org.orgName)}
      name={props.org.orgName}
      detail={language.t("account.space.orgAccount", { email: props.org.accountEmail })}
      active={props.org.active}
      onSelect={props.account.switching() ? undefined : () => void props.account.switchOrg(props.org)}
    />
  )
}
