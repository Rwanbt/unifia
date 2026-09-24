/* SPDX-License-Identifier: MIT */

// The reference's account quick menu (#userQuickMenuV76,
// Unifia-UI-UX-v110-PORT-READY-R1.html ~11195-11210, v84 motion 11455): a
// floating card beside the rail avatar, opened by hovering it. It shows the
// real account identity (useAccount, ADR-051) and only entries that lead
// somewhere real -- the reference's space switcher, "join/create" and
// "lock Unifia" have no backend in this app and are left out.

import { Show, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { useAccount } from "@/components/account/use-account"
import { useLanguage } from "@/context/language"

type Props = {
  open: boolean
  /** The avatar the menu hangs from: 10px to its right, bottom-aligned. */
  anchor: () => HTMLElement | undefined
  onAccount: () => void
  onSettings: () => void
  onPointerEnter: () => void
  onPointerLeave: () => void
}

const GAP = 10

export function AccountQuickMenu(props: Props): JSX.Element {
  const language = useLanguage()
  const account = useAccount()
  const identity = () => account.identity()

  const position = (): JSX.CSSProperties => {
    const rect = props.anchor()?.getBoundingClientRect()
    if (!rect) return {}
    return { left: `${rect.right + GAP}px`, bottom: `${window.innerHeight - rect.bottom}px` }
  }

  const item = (glyph: string, label: string, run: () => void) => (
    <button type="button" role="menuitem" data-slot="account-quick-action" onClick={run}>
      <span aria-hidden="true">{glyph}</span>
      <b>{label}</b>
    </button>
  )

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
                {identity().signedIn
                  ? (identity().email ?? identity().role)
                  : language.t("account.personal.localSummary")}
              </small>
            </span>
          </div>
          <div data-slot="account-quick-sep" />
          {item("◎", language.t("sidebar.account"), props.onAccount)}
          {item("⚙", language.t("sidebar.settings"), props.onSettings)}
        </div>
      </Portal>
    </Show>
  )
}
