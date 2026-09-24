/* SPDX-License-Identifier: MIT */

// The reference's account quick menu (#userQuickMenuV76,
// Unifia-UI-UX-v110-PORT-READY-R1.html renderQuick ~25364, styles ~11199,
// v84 motion 11455): a floating card beside the rail avatar, opened by
// hovering it. Same sections as the reference, each wired to the real
// account centre (useAccount, ADR-051): identity, sign-in prompt, active
// space with the Console organisations, join/create, account pages and
// sign-out. Only "lock Unifia" is left out -- the app has no lock screen.

import { For, Show, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { type ConsoleOrg, useAccount } from "@/components/account/use-account"
import { useLanguage } from "@/context/language"
import type { AccountPage } from "@/pages/settings/user-surface"

type Props = {
  open: boolean
  /** The avatar the menu hangs from: 10px to its right, bottom-aligned. */
  anchor: () => HTMLElement | undefined
  onAccount: (page: AccountPage) => void
  onPointerEnter: () => void
  onPointerLeave: () => void
}

const GAP = 10

export function AccountQuickMenu(props: Props): JSX.Element {
  const language = useLanguage()
  const account = useAccount()
  const identity = () => account.identity()
  const signedIn = () => identity().signedIn

  const position = (): JSX.CSSProperties => {
    const rect = props.anchor()?.getBoundingClientRect()
    if (!rect) return {}
    return { left: `${rect.right + GAP}px`, bottom: `${window.innerHeight - rect.bottom}px` }
  }

  const action = (glyph: string, label: string, run: () => void, tone?: "danger") => (
    <button type="button" role="menuitem" data-slot="account-quick-action" data-tone={tone} onClick={run}>
      <span aria-hidden="true">{glyph}</span>
      <b>{label}</b>
    </button>
  )

  // Organisation work needs an identity first, as in the reference.
  const orgAction = (glyph: string, label: string) =>
    action(signedIn() ? glyph : "🔒", label, () => props.onAccount(signedIn() ? "teams" : "personal"))

  const scope = (label: string, active: boolean, run: () => void, busy = false) => (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      data-slot="account-quick-scope"
      data-active={active ? "" : undefined}
      disabled={busy}
      onClick={run}
    >
      <span aria-hidden="true">{active ? "●" : "◉"}</span>
      <b>{label}</b>
      <i>{active ? "✓" : ""}</i>
    </button>
  )

  const switchTo = (org: ConsoleOrg) => {
    if (!org.active) void account.switchOrg(org)
  }

  return (
    <Show when={props.open}>
      <Portal>
        <div
          role="menu"
          aria-label={language.t("sidebar.account")}
          data-v110="account-quick-menu"
          style={position()}
          onPointerEnter={props.onPointerEnter}
          onPointerLeave={props.onPointerLeave}
        >
          <div data-slot="account-quick-profile">
            <span data-slot="account-quick-avatar">{identity().initials}</span>
            <span>
              <b>{identity().name}</b>
              <small>
                {signedIn() ? (identity().email ?? identity().role) : language.t("account.quick.localProfile")}
              </small>
            </span>
            <i data-slot="account-quick-chip">
              {signedIn() ? language.t("sidebar.account") : language.t("account.quick.anonymous")}
            </i>
          </div>

          <Show when={!signedIn()}>
            <div data-slot="account-quick-identity">
              <button type="button" role="menuitem" onClick={() => props.onAccount("personal")}>
                <span aria-hidden="true">◎</span>
                <span>
                  <b>{language.t("account.quick.identity")}</b>
                  <small>{language.t("account.quick.identityDetail")}</small>
                </span>
                <i aria-hidden="true">›</i>
              </button>
            </div>
          </Show>

          <div data-slot="account-quick-label">{language.t("account.quick.activeSpace")}</div>
          {scope(language.t("account.space.personal"), !account.activeOrg(), () => props.onAccount("overview"))}
          <For each={account.orgs()}>
            {(org) => scope(org.orgName, org.active, () => switchTo(org), account.switching() === org.orgID)}
          </For>
          <div data-slot="account-quick-createjoin" data-locked={signedIn() ? undefined : ""}>
            {orgAction("＋", language.t("account.org.joinShort"))}
            {orgAction("◇", language.t("account.quick.create"))}
          </div>

          <div data-slot="account-quick-sep" />
          {action("◎", language.t("account.quick.manage"), () => props.onAccount("overview"))}
          {action("◇", language.t("account.security.title"), () => props.onAccount("security"))}
          <Show when={signedIn()}>
            <div data-slot="account-quick-sep" />
            {action("↪", language.t("account.quick.signOut"), () => void account.auth.logout(), "danger")}
          </Show>
        </div>
      </Portal>
    </Show>
  )
}
