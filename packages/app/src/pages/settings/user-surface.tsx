/* SPDX-License-Identifier: MIT */

// The account centre -- the reference's `user` destination (ADR-051): a
// sidebar with the identity and four pages. The pages live in
// components/account/ and read one shared useAccount().

import { For, Match, Suspense, Switch, createSignal, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { AccountOrganisations } from "@/components/account/account-organisations"
import { AccountOverview } from "@/components/account/account-overview"
import { AccountPersonal } from "@/components/account/account-personal"
import { AccountSecurity } from "@/components/account/account-security"
import { useAccount } from "@/components/account/use-account"

type AccountPage = "overview" | "personal" | "teams" | "security"

// The reference's nav glyphs (#userContentV76 .user-nav).
const ICONS: Record<AccountPage, JSX.Element> = {
  overview: <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />,
  personal: (
    <>
      <circle cx="12" cy="8" r="3" />
      <path d="M5 20c.7-4 3.1-6 7-6s6.3 2 7 6" />
    </>
  ),
  teams: (
    <>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="10" r="2.5" />
      <path d="M3.5 20c.6-4 2.7-6 5.5-6 3.1 0 5.3 2 5.8 6M14 15c3.4-.4 5.5 1.2 6 5" />
    </>
  ),
  security: <path d="M12 3 5 6v5c0 4.4 2.7 8 7 10 4.3-2 7-5.6 7-10V6zM9.5 12l1.7 1.7 3.5-3.7" />,
}

const PAGES: { id: AccountPage; label: string }[] = [
  { id: "overview", label: "account.nav.overview" },
  { id: "personal", label: "account.nav.personal" },
  { id: "teams", label: "account.nav.teams" },
  { id: "security", label: "account.nav.security" },
]

export function UserSurface() {
  const language = useLanguage()
  const account = useAccount()
  const [page, setPage] = createSignal<AccountPage>("overview")
  const identity = () => account.identity()

  return (
    <main data-v110="mode-main" data-component="workbench-mode-main" class="min-w-0 min-h-0 flex-1 flex">
      <section
        data-v110="surface-card"
        data-component="workbench-user-surface"
        class="relative min-w-0 min-h-0 flex-1 flex flex-col"
      >
        <div
          data-v110="account-frame"
          data-workbench-surface="user"
          data-parity="user.surface"
          class="w-full flex-1 min-h-0"
        >
          <aside data-slot="account-sidebar">
            <div data-slot="account-profile">
              <div data-slot="account-profile-avatar">{identity().initials}</div>
              <div>
                <b>{identity().name}</b>
                <span>
                  {identity().signedIn
                    ? (identity().email ?? identity().role)
                    : language.t("account.personal.localSummary")}
                </span>
              </div>
            </div>
            <nav data-slot="account-nav" aria-label={language.t("account.nav.label")}>
              <For each={PAGES}>
                {(item) => (
                  <button
                    type="button"
                    aria-current={page() === item.id ? "page" : undefined}
                    onClick={() => setPage(item.id)}
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24">
                      {ICONS[item.id]}
                    </svg>
                    <span>{language.t(item.label)}</span>
                  </button>
                )}
              </For>
            </nav>
          </aside>
          <div data-slot="account-content">
            <section data-slot="account-page">
              {/* WHY: the org list is a resource; without a local boundary it
                  would suspend the app-level Suspense and blank the session. */}
              <Suspense>
                <Switch>
                  <Match when={page() === "overview"}>
                    <AccountOverview account={account} onManageIdentity={() => setPage("personal")} />
                  </Match>
                  <Match when={page() === "personal"}>
                    <AccountPersonal account={account} />
                  </Match>
                  <Match when={page() === "teams"}>
                    <AccountOrganisations account={account} />
                  </Match>
                  <Match when={page() === "security"}>
                    <AccountSecurity account={account} />
                  </Match>
                </Switch>
              </Suspense>
            </section>
          </div>
        </div>
      </section>
    </main>
  )
}
