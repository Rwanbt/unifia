/* SPDX-License-Identifier: MIT */

// Personnel -- the reference's identity page (ADR-051). Signing in or
// creating an account uses the collaborative login of this server; there is
// no cloud account behind it.

import { Show, createSignal } from "solid-js"
import { useDialog } from "@unifia/ui/context/dialog"
import { Dialog } from "@unifia/ui/dialog"
import { Switch } from "@unifia/ui/switch"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { LoginForm } from "@/components/auth/login-form"
import { SettingsSection } from "@/components/settings-page"
import { SettingsRow } from "@/components/settings-row"
import { AccountAction, AccountEyebrow, AccountPageHead } from "./account-parts"
import type { Account } from "./use-account"

export function AccountPersonal(props: { account: Account }) {
  const language = useLanguage()
  const dialog = useDialog()
  const identity = () => props.account.identity()
  const soon = () => language.t("common.comingSoon")

  const openLogin = (mode: "login" | "register") =>
    dialog.show(() => <AccountLoginDialog account={props.account} mode={mode} />)

  return (
    <>
      <AccountPageHead
        title={language.t("account.personal.title")}
        description={language.t("account.personal.description")}
      />

      <div data-slot="account-identity-card">
        <div data-slot="account-identity-avatar">{identity().initials}</div>
        <div data-slot="account-context-main">
          <AccountEyebrow>
            {identity().signedIn
              ? language.t("account.personal.signedInEyebrow")
              : language.t("account.personal.localEyebrow")}
          </AccountEyebrow>
          <b>{identity().name}</b>
          <small>
            {identity().signedIn
              ? [identity().email, identity().role].filter(Boolean).join(" · ")
              : language.t("account.personal.localDetail")}
          </small>
        </div>
        <span data-slot="account-pill">
          {identity().signedIn ? identity().role : language.t("account.personal.local")}
        </span>
      </div>

      <div data-slot="account-identity-actions">
        <Show
          when={identity().signedIn}
          fallback={
            <>
              <div data-slot="account-identity-copy">
                <AccountEyebrow>{language.t("account.personal.optionalEyebrow")}</AccountEyebrow>
                <b>{language.t("account.personal.addIdentity")}</b>
                <p>{language.t("account.personal.addIdentityDetail")}</p>
              </div>
              <div data-slot="account-identity-buttons">
                <AccountAction tone="primary" onClick={() => openLogin("register")}>
                  {language.t("auth.createAccount")}
                </AccountAction>
                <AccountAction onClick={() => openLogin("login")}>{language.t("auth.signIn")}</AccountAction>
              </div>
            </>
          }
        >
          <div data-slot="account-identity-copy">
            <AccountEyebrow>{language.t("account.personal.connectedEyebrow")}</AccountEyebrow>
            <b>{identity().email ?? identity().name}</b>
            <p>{language.t("account.personal.connectedDetail", { server: props.account.device().server })}</p>
          </div>
          <div data-slot="account-identity-buttons">
            <AccountAction onClick={() => void props.account.auth.logout()}>
              {language.t("common.disconnect")}
            </AccountAction>
          </div>
        </Show>
      </div>

      <div data-slot="account-detail-grid">
        <div data-slot="account-detail-card">
          <span>{language.t("account.personal.projects")}</span>
          <b>{props.account.projectCount()}</b>
          <small>{language.t("account.personal.projectsDetail")}</small>
        </div>
        <div data-slot="account-detail-card">
          <span>{language.t("account.personal.sessions")}</span>
          <b>1</b>
          <small>{language.t("account.personal.sessionsDetail")}</small>
        </div>
        <div data-slot="account-detail-card">
          <span>{language.t("account.personal.memory")}</span>
          <b>{language.t("account.personal.memoryLocal")}</b>
          <small>{language.t("account.personal.memoryDetail")}</small>
        </div>
      </div>

      <SettingsSection title={language.t("account.personal.preferences")}>
        <SettingsRow
          title={language.t("account.personal.restore.title")}
          description={language.t("account.personal.restore.description")}
        >
          <span title={soon()}>
            <Switch checked={false} disabled />
          </span>
        </SettingsRow>
        <SettingsRow
          title={language.t("account.personal.sync.title")}
          description={language.t("account.personal.sync.description")}
        >
          <span title={soon()}>
            <Switch checked={false} disabled />
          </span>
        </SettingsRow>
      </SettingsSection>
    </>
  )
}

function AccountLoginDialog(props: { account: Account; mode: "login" | "register" }) {
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const server = useServer()
  const [error, setError] = createSignal<string>()

  async function handleLogin(tokens: Parameters<Account["auth"]["login"]>[0]) {
    try {
      setError(undefined)
      await props.account.auth.login(tokens)
      dialog.close()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : language.t("auth.connectionFailed"))
    }
  }

  return (
    // The form carries its own title, which follows its login/register toggle.
    <Dialog class="w-full max-w-[400px]">
      <div class="flex flex-col gap-3 px-6 py-6">
        <LoginForm
          serverUrl={server.current?.http.url ?? ""}
          fetch={platform.fetch}
          initialMode={props.mode}
          onLogin={(tokens) => void handleLogin(tokens)}
        />
        <Show when={error()}>{(message) => <p class="text-12-regular text-text-danger">{message()}</p>}</Show>
      </div>
    </Dialog>
  )
}
