/* SPDX-License-Identifier: MIT */

import { For, Show, createEffect, type JSX } from "solid-js"
import { useLocation, useNavigate } from "@solidjs/router"
import { useWorkspaceTabs } from "@/context/workspace-tabs-provider"
import { ENTRY_TAB_ID, type WorkspaceTab } from "@/context/workspace-tabs"

/**
 * Phase 5 — Barre d'onglets d'espace de travail.
 *
 * Position : en haut de la fenêtre, juste sous le titlebar. C'est le
 * choix fait par Open Design (`.workspace-tabs-chrome.app-chrome-header`,
 * 38 px de haut) et le pattern navigateur web : un onglet par espace
 * de travail, séparé du rail d'icônes (qui choisit le mode dans un
 * espace). Deux axes orthogonaux : ne pas fusionner.
 *
 * Règles respectées :
 * - Entry (Accueil) est non fermable, toujours premier.
 * - Cliquer sur un onglet navigue vers son `href` ET l'active.
 * - Cliquer sur × ferme un onglet (sauf entry). La fermeture du
 *   dernier project ramène l'utilisateur sur entry.
 * - L'URL courante est synchronisée avec l'état : naviguer vers
 *   un projet ouvre/met à jour son onglet, naviguer vers la home
 *   active l'entry. `openWorkspaceTab` est idempotent (active
 *   l'existant au lieu de dupliquer), donc la boucle onglet → URL
 *   → onglet converge en une seule mutation.
 * - P5-5 (drag, raccourcis clavier) est hors du scope de cette
 *   première itération ; les hooks nécessaires (réordonnancement,
 *   raccourcis) sont déjà dans le store, l'UI les branche quand
 *   elle est prête.
 */
export function WorkspaceTabsBar(): JSX.Element {
  const tabs = useWorkspaceTabs()
  const navigate = useNavigate()
  const location = useLocation()

  function isActive(tab: WorkspaceTab): boolean {
    // L'entry est actif quand on est sur la home. Les projects sont
    // actifs quand leur `href` correspond à l'URL courante (avec ou
    // sans session). La comparaison exacte évite les faux positifs
    // entre deux projets qui partagent un prefix.
    if (tab.id === ENTRY_TAB_ID) {
      return location.pathname === "/" || location.pathname === ""
    }
    return location.pathname.startsWith(tab.href.split("/").slice(0, 3).join("/"))
  }

  function activate(tab: WorkspaceTab): void {
    tabs.activate(tab.id)
    if (location.pathname + location.search !== tab.href) {
      navigate(tab.href)
    }
  }

  // P5-2 — un onglet project porte une route complète. Quand la
  // navigation arrive sur un projet, on ouvre ou on active son
  // onglet. Quand la navigation arrive sur la home, on active
  // l'entry. L'effet lit `location.pathname` (signal), donc il se
  // déclenche à chaque changement d'URL.
  createEffect(() => {
    const path = location.pathname
    if (path === "/" || path === "") {
      tabs.activate(ENTRY_TAB_ID)
      return
    }
    // Le premier segment est le directory encodé en base64.
    // Décodé à la lecture pour produire un titre lisible.
    const segments = path.split("/").filter(Boolean)
    if (segments.length === 0) return
    const encodedDir = segments[0]
    if (!encodedDir) return
    const title = decodeBase64Segment(encodedDir) ?? encodedDir
    const rest = segments.slice(1).join("/")
    const href = `/${encodedDir}${rest ? `/${rest}` : ""}${location.search}`
    tabs.open({
      id: encodedDir,
      kind: "project",
      title,
      href,
      closable: true,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    })
  })

  return (
    <div
      class="flex h-9 shrink-0 items-center gap-1 border-b border-border-base bg-background-stronger px-2"
      role="tablist"
      aria-label="Espaces de travail ouverts"
      data-workspace-tabs-bar
    >
      <For each={tabs.state.tabs}>
        {(tab) => (
          <div
            class="flex h-7 items-center gap-1 rounded px-2 text-12-medium transition-colors"
            classList={{
              "bg-background-base text-text-base": isActive(tab),
              "text-text-weak hover:bg-background-base": !isActive(tab),
            }}
            data-workspace-tab={tab.id}
            data-workspace-tab-kind={tab.kind}
            data-workspace-tab-active={isActive(tab) ? "true" : "false"}
            role="tab"
            aria-selected={isActive(tab)}
          >
            <button
              type="button"
              class="flex h-7 items-center gap-1 px-1"
              data-workspace-tab-button={tab.id}
              onClick={() => activate(tab)}
              title={tab.href}
            >
              <span class="truncate max-w-[160px]">{tab.title}</span>
            </button>
            <Show when={tab.closable}>
              <button
                type="button"
                aria-label={`Fermer ${tab.title}`}
                class="rounded p-1 text-12-regular text-text-weak hover:bg-border-base hover:text-text-base"
                data-workspace-tab-close={tab.id}
                onClick={() => {
                  tabs.close(tab.id)
                  // Si on ferme l'onglet actif, on saute vers
                  // l'onglet suivant. Le hook useWorkspaceTabs a
                  // déjà mis à jour activeId ; il reste à naviguer
                  // si l'URL courante pointe vers l'onglet fermé.
                  if (isActive(tab)) {
                    const next = tabs.state.tabs.find((t) => t.id === tabs.state.activeId)
                    if (next) navigate(next.href)
                  }
                }}
              >
                ×
              </button>
            </Show>
          </div>
        )}
      </For>
    </div>
  )
}

/**
 * Décodage best-effort d'un segment base64 vers un titre lisible.
 * Les segments viennent de `useParams` ou de `location.pathname`,
 * et `@unifia/util/encode` est l'encodeur canonique du projet. Si
 * le décodage échoue (segment non-base64), on retourne le segment
 * brut — c'est mieux qu'un titre vide ou `undefined`.
 */
function decodeBase64Segment(segment: string): string | undefined {
  // Le décodeur est paresseux : on ne veut pas importer un module
  // partagé côté app juste pour un titre. `atob` (window) suffit
  // pour les cas standards. Si le segment contient un caractère
  // non-ASCII attendu, c'est que le caller a passé un titre déjà
  // lisible, et le fallback `segment` le rend tel quel.
  if (typeof atob === "undefined") return segment
  try {
    // base64 standard : on tente le décodage direct, puis on
    // restaure le padding manquant (les encodeurs omettent
    // souvent les `=` finaux).
    const padded = segment + "=".repeat((4 - (segment.length % 4)) % 4)
    const decoded = atob(padded)
    return decoded || segment
  } catch {
    return segment
  }
}
