/* SPDX-License-Identifier: MIT */

// Sécurité & appareils -- the reference's security page (ADR-051). The app
// has no MFA, passkeys or recovery codes yet, and knows one session: this
// device's connection. Those controls are shown disabled as Coming soon.

import { Switch } from "@unifia/ui/switch"
import { useLanguage } from "@/context/language"
import { SettingsSection } from "@/components/settings-page"
import { SettingsRow } from "@/components/settings-row"
import { AccountPageHead, DeviceSessionRow, SoonAction } from "./account-parts"
import type { Account } from "./use-account"

export function AccountSecurity(props: { account: Account }) {
  const language = useLanguage()
  const soon = () => language.t("common.comingSoon")

  return (
    <>
      <AccountPageHead
        title={language.t("account.security.title")}
        description={language.t("account.security.description")}
      />

      <SettingsSection>
        <SettingsRow
          title={language.t("account.security.validation.title")}
          description={language.t("account.security.validation.description")}
        >
          <span title={soon()}>
            <Switch checked={false} disabled />
          </span>
        </SettingsRow>
        <SettingsRow
          title={language.t("account.security.mfa.title")}
          description={language.t("account.security.mfa.description")}
        >
          <span title={soon()}>
            <Switch checked={false} disabled />
          </span>
        </SettingsRow>
        <SettingsRow
          title={language.t("account.security.passkeys.title")}
          description={language.t("account.security.passkeys.description")}
        >
          <SoonAction>{language.t("account.security.passkeys.action")}</SoonAction>
        </SettingsRow>
        <SettingsRow
          title={language.t("account.security.recovery.title")}
          description={language.t("account.security.recovery.description")}
        >
          <SoonAction>{language.t("account.security.recovery.action")}</SoonAction>
        </SettingsRow>
      </SettingsSection>

      <div data-slot="account-security-head">
        <h3>{language.t("account.security.sessions")}</h3>
        <div data-slot="account-security-actions">
          <span>
            {language.t("account.security.sessionCount", {
              space: props.account.activeOrg()?.orgName ?? language.t("account.space.personal"),
            })}
          </span>
          <SoonAction tone="danger">{language.t("account.security.revokeOthers")}</SoonAction>
        </div>
      </div>
      <DeviceSessionRow account={props.account} />

      <h3>{language.t("account.security.policy")}</h3>
      <div data-slot="account-note">{language.t("account.security.policyNote")}</div>
    </>
  )
}
