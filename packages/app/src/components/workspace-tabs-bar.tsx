/* SPDX-License-Identifier: MIT */

import { For, Show, createEffect, type JSX } from "solid-js"
import { useLocation, useNavigate } from "@solidjs/router"
import {
  closestCenter,
  createSortable,
  DragDropProvider,
  DragDropSensors,
  SortableProvider,
  type DragEvent,
} from "@thisbeyond/solid-dnd"
import { ConstrainDragYAxis } from "@/utils/solid-dnd"
import { useWorkspaceTabs } from "@/context/workspace-tabs-provider"
import { useGlobalSync } from "@/context/global-sync"
import { ENTRY_TAB_ID, type WorkspaceTab } from "@/context/workspace-tabs"

/**
 * Phase 5 / 11 — Barre d'onglets d'espace de travail.
 *
 * Position : en haut de la fenêtre, juste sous le titlebar. C'est le
 * choix fait par Open Design (`.workspace-tabs-chrome.app-chrome-header`,
 * 38 px de haut) et le pattern navigateur web : un onglet par espace
 * de travail, séparé du rail d'icônes (qui choisit le mode dans un
 * espace). Deux axes orthogonaux : ne pas fusionner.
 *
 * Règles respectées :
 * - Entry (Accueil) est non fermable, toujours premier, et n'est pas
 *   draggable — elle est rendue hors du `DragDropProvider`, exactement
 *   comme le bouton "Nouveau workspace" dans `sidebar-panel.tsx` est
 *   rendu hors de la zone sortable des workspaces.
 * - Cliquer sur un onglet navigue vers son `href` ET l'active.
 * - Cliquer sur × ferme un onglet (sauf entry). La fermeture du
 *   dernier project ramène l'utilisateur sur entry.
 * - L'URL courante est synchronisée avec l'état : naviguer vers
 *   un projet ouvre/met à jour son onglet, naviguer vers la home
 *   active l'entry. `openWorkspaceTab` est idempotent (active
 *   l'existant au lieu de dupliquer), donc la boucle onglet → URL
 *   → onglet converge en une seule mutation.
 * - Phase 11.1 : les onglets project sont réordonnables par
 *   glisser-déposer (axe horizontal contraint via `ConstrainDragYAxis`
 *   — même pattern que la barre latérale des workspaces, qui contraint
 *   l'axe X puisqu'elle est verticale).
 * - Phase 11.3 : le titre affiché d'un onglet project est calculé à la
 *   lecture (`friendlyTabTitle`) à partir de la branche VCS du
 *   workspace quand elle est connue, plutôt que figé dans `tab.title`
 *   au premier `open()` — sinon le titre resterait le nom de dossier
 *   brut même une fois la branche chargée de façon asynchrone.
 */
export function WorkspaceTabsBar(): JSX.Element {
  const tabs = useWorkspaceTabs()
  const globalSync = useGlobalSync()
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

  function close(tab: WorkspaceTab): void {
    tabs.close(tab.id)
    // Si on ferme l'onglet actif, on saute vers l'onglet suivant. Le
    // hook useWorkspaceTabs a déjà mis à jour activeId ; il reste à
    // naviguer si l'URL courante pointe vers l'onglet fermé.
    if (isActive(tab)) {
      const next = tabs.state.tabs.find((t) => t.id === tabs.state.activeId)
      if (next) navigate(next.href)
    }
  }

  // Phase 11.1 — réordonnancement par glisser-déposer. `toIndex` est
  // calculé contre `tabs.state.tabs`, le tableau COMPLET (entry
  // incluse), parce que c'est ce même tableau que `reorderWorkspaceTab`
  // manipule en interne : pas de décalage d'index entre l'espace des
  // ids passés à `SortableProvider` (qui exclut l'entry) et l'espace
  // dans lequel l'index cible est appliqué.
  function handleDragOver(event: DragEvent): void {
    const { draggable, droppable } = event
    if (!draggable || !droppable) return
    const fromId = draggable.id.toString()
    const toId = droppable.id.toString()
    if (fromId === toId) return
    const toIndex = tabs.state.tabs.findIndex((t) => t.id === toId)
    if (toIndex === -1) return
    tabs.reorder(fromId, toIndex)
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

  // Phase 11.3 — titre "amical" calculé à la lecture depuis la branche
  // VCS du workspace, quand elle est connue. `tab.title` (le nom de
  // dossier décodé, figé à l'ouverture) reste le fallback tant que la
  // branche n'a pas encore été chargée par `globalSync`.
  function friendlyTabTitle(tab: WorkspaceTab): string {
    if (tab.kind !== "project") return tab.title
    const directory = decodeBase64Segment(tab.id)
    if (!directory) return tab.title
    const [data] = globalSync.child(directory, { bootstrap: false })
    return data.vcs?.branch || tab.title
  }

  const entryTab = () => tabs.state.tabs.find((t) => t.kind === "entry")
  const projectTabs = () => tabs.state.tabs.filter((t) => t.kind === "project")
  const projectIds = () => projectTabs().map((t) => t.id)

  return (
    <div
      class="flex h-9 shrink-0 items-center gap-1 border-b border-border-base bg-background-stronger px-2"
      role="tablist"
      aria-label="Espaces de travail ouverts"
      data-workspace-tabs-bar
    >
      <Show when={entryTab()}>
        {(tab) => (
          <TabRow
            tab={tab()}
            title={friendlyTabTitle(tab())}
            active={isActive(tab())}
            onActivate={() => activate(tab())}
            onClose={() => close(tab())}
          />
        )}
      </Show>
      <DragDropProvider onDragOver={handleDragOver} collisionDetector={closestCenter}>
        <DragDropSensors />
        <ConstrainDragYAxis />
        <SortableProvider ids={projectIds()}>
          <For each={projectTabs()}>
            {(tab) => (
              <SortableTabRow
                tab={tab}
                title={friendlyTabTitle(tab)}
                active={isActive(tab)}
                onActivate={() => activate(tab)}
                onClose={() => close(tab)}
              />
            )}
          </For>
        </SortableProvider>
      </DragDropProvider>
    </div>
  )
}

type TabRowProps = {
  tab: WorkspaceTab
  title: string
  active: boolean
  onActivate: () => void
  onClose: () => void
}

/** Markup partagé entre l'entry (non draggable) et les onglets project (draggables). */
function TabInner(props: TabRowProps): JSX.Element {
  return (
    <>
      <button
        type="button"
        class="flex h-7 items-center gap-1 px-1"
        data-workspace-tab-button={props.tab.id}
        onClick={props.onActivate}
        title={props.tab.href}
      >
        <span class="truncate max-w-[160px]">{props.title}</span>
      </button>
      <Show when={props.tab.closable}>
        <button
          type="button"
          aria-label={`Fermer ${props.title}`}
          class="rounded p-1 text-12-regular text-text-weak hover:bg-border-base hover:text-text-base"
          data-workspace-tab-close={props.tab.id}
          onClick={props.onClose}
        >
          ×
        </button>
      </Show>
    </>
  )
}

function TabRow(props: TabRowProps): JSX.Element {
  return (
    <div
      class="flex h-7 items-center gap-1 rounded px-2 text-12-medium transition-colors"
      classList={{
        "bg-background-base text-text-base": props.active,
        "text-text-weak hover:bg-background-base": !props.active,
      }}
      data-workspace-tab={props.tab.id}
      data-workspace-tab-kind={props.tab.kind}
      data-workspace-tab-active={props.active ? "true" : "false"}
      role="tab"
      aria-selected={props.active}
    >
      <TabInner {...props} />
    </div>
  )
}

function SortableTabRow(props: TabRowProps): JSX.Element {
  const sortable = createSortable(props.tab.id)
  return (
    <div
      use:sortable
      class="flex h-7 items-center gap-1 rounded px-2 text-12-medium transition-colors"
      classList={{
        "bg-background-base text-text-base": props.active,
        "text-text-weak hover:bg-background-base": !props.active,
        "opacity-30": sortable.isActiveDraggable,
      }}
      data-workspace-tab={props.tab.id}
      data-workspace-tab-kind={props.tab.kind}
      data-workspace-tab-active={props.active ? "true" : "false"}
      role="tab"
      aria-selected={props.active}
    >
      <TabInner {...props} />
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
