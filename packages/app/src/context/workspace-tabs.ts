/* SPDX-License-Identifier: MIT */

/**
 * Phase 5 — Barre d'onglets d'espace de travail.
 *
 * Open Design expose trois kinds d'onglets : `entry` (accueil permanent),
 * `project` (un workspace ouvert), `marketplace` (équivalent du hub
 * plugins). Unifia n'a pas d'équivalent du `marketplace` dans le scope
 * actuel, donc le modèle est restreint à `entry` et `project`. La
 * généralisation à un troisième kind est triviale (union discriminée) si
 * le besoin émerge plus tard.
 *
 * Un onglet `project` porte une **route complète** (`href` =
 * `/{encodedDir}/session/{sessionId}?` ou `/{encodedDir}/{mode}`), pas
 * juste un identifiant. Conséquence : deux onglets sur deux projets ne
 * partagent jamais la session, et un rechargement de page restaure
 * exactement la navigation de l'utilisateur. C'est l'inverse du pattern
 * « onglet = identifiant seulement, on dérive la route du contexte »,
 * qui force le contexte à rester en mémoire entre les onglets et
 * casse le bouton « retour » du navigateur.
 *
 * L'état est persisté sous la clé `unifia:workspace-tabs:v1` (suffixe
 * `:v1` parce qu'un changement de format de route casse la sérialisation
 * — c'est documenté en ADR à venir). Le store n'écrit pas pendant
 * l'hydratation : on lit la valeur, on la compare, et on n'écrit que
 * si elle change.
 */

export type WorkspaceTabKind = "entry" | "project"

/**
 * Un onglet d'espace de travail.
 *
 * - `kind: "entry"` : l'onglet d'accueil. Permanent, non fermable, id
 *   fixé à `ENTRY_TAB_ID`. Aucun `directory` : la home ne dépend pas
 *   d'un workspace.
 * - `kind: "project"` : un workspace ouvert. `directory` est encodé
 *   en base64 dans le `href` pour préserver l'URL exacte.
 *
 * `closable: false` rend l'onglet permanent ; le réducteur refuse la
 * fermeture (test couvert).
 */
export type WorkspaceTab = {
  id: string
  kind: WorkspaceTabKind
  title: string
  /**
   * Route complète vers laquelle naviguer quand l'onglet est activé.
   * Pour `kind: "entry"`, vaut `"/"`. Pour `kind: "project"`, c'est
   * `/{base64Encode(directory)}/session/{sessionId}` (ou
   * `/{base64Encode(directory)}/{mode}?session=...`).
   */
  href: string
  closable: boolean
  createdAt: number
  lastActiveAt: number
}

export type WorkspaceTabState = {
  tabs: readonly WorkspaceTab[]
  activeId: string
}

export const ENTRY_TAB_ID = "entry"

const ENTRY_TAB: WorkspaceTab = {
  id: ENTRY_TAB_ID,
  kind: "entry",
  title: "Accueil",
  href: "/",
  closable: false,
  createdAt: 0,
  lastActiveAt: 0,
}

export function emptyWorkspaceTabState(): WorkspaceTabState {
  // Toujours inclure l'onglet entry — c'est la racine, pas un état vide.
  return { tabs: [{ ...ENTRY_TAB }], activeId: ENTRY_TAB_ID }
}

/**
 * Rouvre un onglet : s'il existe déjà (même `id`), il est activé et
 * son `lastActiveAt` est mis à jour ; sinon il est ajouté. L'entry
 * reste en première position (règle d'or d'Open Design) ; les autres
 * onglets s'accumulent à la fin, dans l'ordre d'ouverture. C'est le
 * pattern navigateur web : un nouvel onglet apparaît à droite des
 * onglets existants, pas au milieu.
 */
export function openWorkspaceTab(state: WorkspaceTabState, tab: WorkspaceTab, now: number): WorkspaceTabState {
  const existing = state.tabs.find((t) => t.id === tab.id)
  if (existing) {
    return activateWorkspaceTab(state, tab.id, now)
  }
  const newTab: WorkspaceTab = { ...tab, lastActiveAt: now }
  // L'insertion se fait à la fin, après l'entry. Si l'entry est seul,
  // l'insertion après entry = à la fin. Sinon, à la toute fin.
  const hasEntry = state.tabs.some((t) => t.kind === "entry")
  const index = state.tabs.length
  if (!hasEntry) {
    // Cas dégénéré : pas d'entry. On insère en tête pour reproduire
    // une racine plausible.
    const next = [newTab, ...state.tabs]
    return { tabs: next, activeId: tab.id }
  }
  const next = [...state.tabs]
  next.splice(index, 0, newTab)
  return { tabs: next, activeId: tab.id }
}

/**
 * Ferme un onglet. Refuse si `closable: false` (entry). Si on ferme
 * l'onglet actif, le suivant à droite devient actif (sinon le dernier
 * de la liste). La règle "entry reste premier" est appliquée après
 * fermeture : si la fermeture rend l'entry dernier, l'entry reste
 * premier et les autres glissent.
 */
export function closeWorkspaceTab(state: WorkspaceTabState, id: string, now: number): WorkspaceTabState {
  const index = state.tabs.findIndex((t) => t.id === id)
  if (index === -1) return state
  const target = state.tabs[index]
  if (!target) return state
  if (!target.closable) return state
  const wasActive = state.activeId === id
  const next = state.tabs.filter((_, i) => i !== index)
  let nextActive = state.activeId
  if (wasActive) {
    if (next.length === 0) {
      // Cas impossible : entry est permanent, donc next ne peut pas être
      // vide si on a fermé autre chose. Garde-fou.
      nextActive = ENTRY_TAB_ID
    } else {
      const newActive = next[index] ?? next[index - 1] ?? next[0]
      nextActive = newActive?.id ?? ENTRY_TAB_ID
      if (newActive) {
        // Touch the new active tab so its lastActiveAt is bumped.
        const updated = next.map((t) => (t.id === nextActive ? { ...t, lastActiveAt: now } : t))
        return { tabs: updated, activeId: nextActive }
      }
    }
  }
  return { tabs: next, activeId: nextActive }
}

/**
 * Active un onglet existant et met à jour son `lastActiveAt`. Si l'id
 * n'existe pas, l'état est inchangé.
 */
export function activateWorkspaceTab(state: WorkspaceTabState, id: string, now: number): WorkspaceTabState {
  const index = state.tabs.findIndex((t) => t.id === id)
  if (index === -1) return state
  const next = state.tabs.map((t, i) => (i === index ? { ...t, lastActiveAt: now } : t))
  return { tabs: next, activeId: id }
}

/**
 * Met à jour le `lastActiveAt` d'un onglet sans changer l'onglet actif.
 * Utile quand l'utilisateur revient sur la même page plus tard (le
 * re-render n'active pas l'onglet mais l'âge doit suivre).
 */
export function touchWorkspaceTab(state: WorkspaceTabState, id: string, now: number): WorkspaceTabState {
  const index = state.tabs.findIndex((t) => t.id === id)
  if (index === -1) return state
  const next = state.tabs.map((t, i) => (i === index ? { ...t, lastActiveAt: now } : t))
  return { tabs: next, activeId: state.activeId }
}

/**
 * Sérialise l'état pour la persistance localStorage. La clé
 * `STORAGE_KEY` est versionnée — un changement de format de route
 * doit incrémenter la version.
 */
export const WORKSPACE_TABS_STORAGE_KEY = "unifia:workspace-tabs:v1"

export function serializeWorkspaceTabState(state: WorkspaceTabState): string {
  return JSON.stringify(state)
}

export function deserializeWorkspaceTabState(raw: string): WorkspaceTabState | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object") return null
    const candidate = parsed as Partial<WorkspaceTabState>
    if (!Array.isArray(candidate.tabs)) return null
    if (typeof candidate.activeId !== "string") return null
    // Sanity: l'entry doit être présent. Si on l'a perdu en
    // sérialisation (par exemple un build futur qui change la forme),
    // on le restaure.
    const hasEntry = candidate.tabs.some((t) => t?.kind === "entry")
    if (!hasEntry) return null
    // Drop tout onglet qui n'a pas la forme attendue.
    const tabs: WorkspaceTab[] = []
    for (const t of candidate.tabs) {
      if (
        t &&
        typeof t === "object" &&
        typeof t.id === "string" &&
        (t.kind === "entry" || t.kind === "project") &&
        typeof t.title === "string" &&
        typeof t.href === "string" &&
        typeof t.closable === "boolean" &&
        typeof t.createdAt === "number" &&
        typeof t.lastActiveAt === "number"
      ) {
        tabs.push(t as WorkspaceTab)
      }
    }
    if (tabs.length === 0) return null
    return { tabs, activeId: candidate.activeId }
  } catch {
    return null
  }
}
