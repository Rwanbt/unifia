/* SPDX-License-Identifier: MIT */

// Organisations & Teams -- the reference's teams page (ADR-051). The
// organisations are the Console orgs of the signed-in Console accounts;
// joining or creating one has no backend yet.

import { For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { initials } from "./account-identity"
import { AccountAction, AccountEyebrow, AccountPageHead, SoonAction } from "./account-parts"
import type { Account } from "./use-account"

const GOVERNANCE = ["members", "providers", "memory", "automations", "sso", "audit"] as const

export function AccountOrganisations(props: { account: Account }) {
  const language = useLanguage()

  return (
    <>
      <AccountPageHead title={language.t("account.org.title")} description={language.t("account.org.description")}>
        <div data-slot="account-org-head-actions">
          <SoonAction locked>{language.t("account.org.joinShort")}</SoonAction>
          <SoonAction locked tone="primary">
            {language.t("account.org.create")}
          </SoonAction>
        </div>
      </AccountPageHead>

      <div data-slot="account-org-list">
        <Show
          when={props.account.orgs().length > 0}
          fallback={
            <div data-slot="account-org-empty">
              <span>{language.t("account.org.empty")}</span>
              <span>{language.t("account.org.emptyHint")}</span>
            </div>
          }
        >
          <For each={props.account.orgs()}>
            {(org) => (
              <div data-slot="account-org-card">
                <span data-slot="account-space-avatar">{initials(org.orgName)}</span>
                <div data-slot="account-context-main">
                  <AccountEyebrow>{language.t("account.org.eyebrow")}</AccountEyebrow>
                  <b>{org.orgName}</b>
                  <small>{org.accountEmail}</small>
                </div>
                <Show
                  when={!org.active}
                  fallback={<span data-slot="account-pill">{language.t("account.space.active")}</span>}
                >
                  <AccountAction
                    tone="primary"
                    disabled={!!props.account.switching()}
                    onClick={() => void props.account.switchOrg(org)}
                  >
                    {language.t("account.space.switch")}
                  </AccountAction>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </div>

      <h3>{language.t("account.org.governance")}</h3>
      <div data-slot="account-capability-list">
        <For each={GOVERNANCE}>
          {(item) => (
            <div>
              <b>{language.t(`account.org.gov.${item}.title`)}</b>
              <span>{language.t(`account.org.gov.${item}.description`)}</span>
            </div>
          )}
        </For>
      </div>
    </>
  )
}
