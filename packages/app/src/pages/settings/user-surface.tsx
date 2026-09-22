/* SPDX-License-Identifier: MIT */

import { For, Show, createSignal, type JSX } from "solid-js"
import { IconButton } from "@unifia/ui/icon-button"
import { useLanguage } from "@/context/language"

const pages = [
  { id: "overview", label: "Vue d’ensemble", icon: "dashboard" },
  { id: "personal", label: "Personnel", icon: "user" },
  { id: "teams", label: "Organisations", icon: "users" },
  { id: "security", label: "Sécurité", icon: "shield" },
] as const

export function UserSurface(props: { onClose: () => void }) {
  const language = useLanguage()
  const [page, setPage] = createSignal<(typeof pages)[number]["id"]>("overview")

  return (
    <main data-v110="mode-main" data-component="workbench-mode-main" class="min-w-0 min-h-0 flex-1 flex">
      <section data-v110="surface-card" data-component="workbench-user-surface" class="relative min-w-0 min-h-0 flex-1 flex flex-col">
        <div data-workbench-surface="user" data-parity="user.surface" class="flex size-full min-h-0 overflow-hidden bg-background-base">
          <aside class="w-[220px] shrink-0 border-r border-border-weak-base p-3 flex flex-col gap-4">
            <div class="flex items-center gap-2 px-2">
              <div class="size-9 rounded-full bg-surface-raised-base-active grid place-items-center text-text-strong">U</div>
              <div class="min-w-0 flex flex-col">
                <strong class="text-13-medium truncate">User</strong>
                <span class="text-11-regular text-text-weak truncate">Profil local anonyme</span>
              </div>
            </div>
            <nav aria-label="Centre de compte" class="flex flex-col gap-1">
              <For each={pages}>
                {(item) => (
                  <button
                    type="button"
                    class="min-h-9 rounded-lg px-3 flex items-center gap-2 text-left text-12-regular text-text-weak hover:bg-surface-raised-base-hover"
                    classList={{ "bg-surface-raised-base-active text-text-strong": page() === item.id }}
                    aria-current={page() === item.id ? "page" : undefined}
                    onClick={() => setPage(item.id)}
                  >
                    <span aria-hidden="true">{item.icon === "dashboard" ? "⌘" : item.icon === "user" ? "◯" : item.icon === "users" ? "♙" : "◇"}</span>
                    <span>{item.label}</span>
                  </button>
                )}
              </For>
            </nav>
            <div class="mt-auto px-2 text-10-regular text-text-weak">Unifia Desktop · v1.3.15</div>
          </aside>
          <main class="min-w-0 min-h-0 flex-1 overflow-auto p-6 relative">
            <IconButton icon="close" variant="ghost" class="absolute right-3 top-3" aria-label={language.t("ui.common.close")} onClick={props.onClose} />
            <Show when={page() === "overview"}>
              <UserPage title="Compte & espaces" description="Ton identité locale reste souveraine. Les organisations appliquent leurs propres ressources et politiques sans mélanger les données personnelles.">
                <div class="rounded-xl border border-border-weak-base bg-surface-raised-base p-4 flex items-center gap-3">
                  <div class="size-10 rounded-xl bg-surface-raised-base-active grid place-items-center">U</div>
                  <div class="flex flex-col gap-1"><span class="text-10-regular text-text-weak">ESPACE ACTIF · FRONTIÈRE DE DONNÉES</span><strong>Personnel</strong><span class="text-11-regular text-text-weak">Projets privés · Memory privée · providers personnels</span></div>
                </div>
                <h3 class="mt-6 text-13-medium">Vos espaces</h3>
                <InfoRow title="Personnel" detail="Profil local anonyme · environnement privé" />
              </UserPage>
            </Show>
            <Show when={page() === "personal"}>
              <UserPage title="Personnel" description="Unifia fonctionne sans compte cloud obligatoire. Tu peux rester 100 % local ou synchroniser volontairement ton identité et tes préférences.">
                <InfoRow title="Profil local anonyme" detail="Aucune donnée personnelle · aucune connexion distante" />
                <InfoRow title="Préférences personnelles" detail="Restaurer la dernière session et synchroniser les préférences" />
              </UserPage>
            </Show>
            <Show when={page() === "teams"}>
              <UserPage title="Organisations & Teams" description="Les organisations définissent la frontière administrative, la sécurité et la gouvernance.">
                <InfoRow title="Aucune organisation connectée" detail="Tu peux rejoindre une organisation depuis cette page." />
              </UserPage>
            </Show>
            <Show when={page() === "security"}>
              <UserPage title="Sécurité & appareils" description="Gère la protection de l’identité locale et les sessions actives.">
                <InfoRow title="Validation renforcée" detail="Réauthentification pour les opérations sensibles" />
                <InfoRow title="Authentification multifacteur" detail="Protection de l’identité synchronisée" />
              </UserPage>
            </Show>
          </main>
        </div>
      </section>
    </main>
  )
}

function UserPage(props: { title: string; description: string; children: JSX.Element }) {
  return <div class="mx-auto w-full max-w-[860px] pb-10 pt-2"><h2 class="text-18-medium text-text-strong">{props.title}</h2><p class="mt-1 text-12-regular text-text-weak">{props.description}</p><div class="mt-5 flex flex-col gap-3">{props.children}</div></div>
}

function InfoRow(props: { title: string; detail: string }) {
  return <div class="rounded-xl border border-border-weak-base bg-surface-raised-base p-4 flex flex-col gap-1"><strong class="text-13-medium">{props.title}</strong><span class="text-11-regular text-text-weak">{props.detail}</span></div>
}
